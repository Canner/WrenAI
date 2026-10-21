"""Unit tests for ``wren query --output json``.

Uses typer's CliRunner with a mocked WrenEngine so no real database is needed.
"""

from __future__ import annotations

import datetime
import decimal
import json
from unittest.mock import MagicMock, patch

import pyarrow as pa
import pytest
from typer.testing import CliRunner

from wren.cli import app

pytestmark = pytest.mark.unit

runner = CliRunner()


def _query_json(table: pa.Table) -> list[dict]:
    engine = MagicMock()
    engine.__enter__ = MagicMock(return_value=engine)
    engine.__exit__ = MagicMock(return_value=False)
    engine.query.return_value = table
    with patch("wren.cli._build_engine", return_value=engine):
        result = runner.invoke(
            app, ["query", "--sql", "SELECT 1", "--output", "json", "--quiet"]
        )
    assert result.exit_code == 0, result.output
    return [json.loads(line) for line in result.stdout.splitlines() if line]


def test_json_output_keeps_dates_and_timestamps_as_iso_strings():
    table = pa.table(
        {
            "order_date": pa.array([datetime.date(2024, 1, 15)]),
            "created_at": pa.array(
                [datetime.datetime(2024, 1, 15, 10, 30)], pa.timestamp("us")
            ),
            "paid_at": pa.array(
                [datetime.datetime(2024, 1, 15, 10, 30, tzinfo=datetime.UTC)],
                pa.timestamp("us", tz="UTC"),
            ),
            "opens_at": pa.array([datetime.time(9, 0)]),
        }
    )

    assert _query_json(table) == [
        {
            "order_date": "2024-01-15",
            "created_at": "2024-01-15T10:30:00",
            "paid_at": "2024-01-15T10:30:00+00:00",
            "opens_at": "09:00:00",
        }
    ]


def test_json_output_keeps_integers_in_a_column_with_nulls():
    table = pa.table({"discount": pa.array([5, None], pa.int64())})

    rows = _query_json(table)

    assert rows == [{"discount": 5}, {"discount": None}]
    assert isinstance(rows[0]["discount"], int)


def test_json_output_writes_valid_json_for_decimals_nan_and_nested_values():
    table = pa.table(
        {
            "amount": pa.array([decimal.Decimal("12.34")], pa.decimal128(10, 2)),
            "ratio": pa.array([float("nan")]),
            "dates": pa.array([[datetime.date(2024, 1, 15)]]),
        }
    )

    assert _query_json(table) == [
        {"amount": 12.34, "ratio": None, "dates": ["2024-01-15"]}
    ]


def test_json_output_writes_one_object_per_row():
    table = pa.table({"id": [1, 2, 3]})

    assert _query_json(table) == [{"id": 1}, {"id": 2}, {"id": 3}]


def test_json_output_keeps_scale_zero_decimals_as_integers():
    # SUM(<integer column>) is decimal128(38, 0) on DuckDB and MySQL; only the
    # scale decides, so SUM(<NUMERIC(10,2) column>) = 15.00 stays a float.
    table = pa.table(
        {
            "sum_qty": pa.array([decimal.Decimal("15")], pa.decimal128(38, 0)),
            "big": pa.array(
                [decimal.Decimal("9007199254740993")], pa.decimal128(20, 0)
            ),
            "sum_price": pa.array([decimal.Decimal("15.00")], pa.decimal128(10, 2)),
        }
    )

    rows = _query_json(table)

    assert rows == [{"sum_qty": 15, "big": 9007199254740993, "sum_price": 15.0}]
    assert isinstance(rows[0]["sum_qty"], int)
    assert isinstance(rows[0]["sum_price"], float)
