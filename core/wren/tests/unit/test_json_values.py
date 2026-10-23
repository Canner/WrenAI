"""Unit tests for the value coercion shared by CLI JSON output and MCP ``query``."""

from __future__ import annotations

import decimal

import numpy as np
import pytest

from wren._json_values import normalize_value, unique_column_names

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (decimal.Decimal("15"), 15),
        (decimal.Decimal("9007199254740993"), 9007199254740993),
        (decimal.Decimal("15.00"), 15.0),
        (decimal.Decimal("12.34"), 12.34),
        (decimal.Decimal("NaN"), None),
    ],
)
def test_decimal_scale_decides_int_or_float(value, expected):
    result = normalize_value(value)

    assert result == expected
    assert type(result) is type(expected)


def test_numpy_scalars_become_python_values():
    assert normalize_value({"n": np.int64(7), "x": np.float64("nan")}) == {
        "n": 7,
        "x": None,
    }


@pytest.mark.parametrize(
    ("names", "expected"),
    [
        (["id", "name"], ["id", "name"]),
        (["id", "id", "id"], ["id", "id_1", "id_2"]),
        (["id", "id", "id_1"], ["id", "id_2", "id_1"]),
        (["ID", "id"], ["ID", "id"]),
    ],
)
def test_unique_column_names_never_reuse_a_name(names, expected):
    assert unique_column_names(names) == expected
