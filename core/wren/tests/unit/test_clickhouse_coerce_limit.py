"""ClickHouse query must coerce LIMIT before SQL interpolation."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from wren.connector import clickhouse as ch_mod


def _connector():
    c = object.__new__(ch_mod.ClickHouseConnector)
    c.connection = MagicMock()
    c._closed = False
    return c


def test_reject_negative_limit():
    c = _connector()
    with pytest.raises(ValueError, match="non-negative"):
        c.query("SELECT 1", limit=-1)


def test_reject_fractional_negative_limit():
    # ``int(-0.5)`` truncates to ``0``; ensure the fractional negative is
    # rejected before truncation rather than silently becoming ``LIMIT 0``.
    c = _connector()
    with pytest.raises(ValueError, match="non-negative"):
        c.query("SELECT 1", limit=-0.5)


def test_reject_negative_decimal_limit():
    # ``Decimal`` and ``Fraction`` are ``numbers.Number`` too; a negative
    # fractional value must be rejected before ``int()`` truncation.
    from decimal import Decimal

    c = _connector()
    with pytest.raises(ValueError, match="non-negative"):
        c.query("SELECT 1", limit=Decimal("-0.5"))


def test_reject_negative_fraction_limit():
    from fractions import Fraction

    c = _connector()
    with pytest.raises(ValueError, match="non-negative"):
        c.query("SELECT 1", limit=Fraction(-1, 2))


def test_reject_injection_string():
    c = _connector()
    with pytest.raises(ValueError):
        c.query("SELECT 1", limit="1; DROP TABLE t")


def test_numeric_string_limit_interpolated():
    c = _connector()
    with patch.object(ch_mod, "_build_clickhouse_arrow_table", return_value="tbl"):
        out = c.query("SELECT 1", limit="7")
    assert out == "tbl"
    statement = c.connection.query.call_args[0][0]
    assert "LIMIT 7" in statement
    assert "DROP" not in statement
