"""DuckDBConnector limit coercion."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from wren.connector.duckdb import DuckDBConnector, _coerce_limit

pytestmark = pytest.mark.unit


def test_coerce_limit_rejects_injection() -> None:
    with pytest.raises(ValueError):
        _coerce_limit("1 OR 1=1")


def test_coerce_limit_rejects_negative() -> None:
    with pytest.raises(ValueError):
        _coerce_limit(-2)


def test_query_interpolates_coerced_limit() -> None:
    c = DuckDBConnector.__new__(DuckDBConnector)
    conn = MagicMock()
    result = MagicMock()
    conn.execute.return_value = result
    result.fetch_arrow_table.return_value = MagicMock()
    c.connection = conn
    c.query("SELECT 1;", limit="4")
    (sent,), _ = conn.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _q LIMIT 4"
