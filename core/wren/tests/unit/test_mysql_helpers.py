"""Unit tests for native MySQL connector helpers.

These tests cover the pure helpers in ``wren.connector.mysql`` — limit
sanitisation, SQL composition, decimal type derivation — without requiring
a live MySQL server.
"""

from __future__ import annotations

import pyarrow as pa
import pytest

from wren.connector.mysql import (
    _apply_limit,
    _arrow_decimal_from_mysql_field,
    _coerce_limit,
)

pytestmark = pytest.mark.unit


# ── _coerce_limit ─────────────────────────────────────────────────────────


def test_coerce_limit_none_passthrough() -> None:
    assert _coerce_limit(None) is None


def test_coerce_limit_accepts_int() -> None:
    assert _coerce_limit(10) == 10


def test_coerce_limit_accepts_numeric_string() -> None:
    # ``int()`` accepts numeric strings — keep that contract.
    assert _coerce_limit("25") == 25


def test_coerce_limit_rejects_injection_string() -> None:
    """A crafted limit value must not survive ``int()`` coercion."""
    with pytest.raises(ValueError):
        _coerce_limit("1; DROP TABLE foo")


def test_coerce_limit_rejects_negative() -> None:
    with pytest.raises(ValueError):
        _coerce_limit(-1)


# ── _apply_limit ──────────────────────────────────────────────────────────


def test_apply_limit_appends_clause() -> None:
    out = _apply_limit("SELECT a FROM t", 5)
    assert out.endswith("LIMIT 5")
    assert "SELECT a FROM t" in out


def test_apply_limit_strips_trailing_semicolon() -> None:
    out = _apply_limit("SELECT a FROM t;", 3)
    assert "; " not in out
    assert out.endswith("LIMIT 3")
    assert ";" not in out.split("LIMIT")[0]


def test_apply_limit_zero() -> None:
    out = _apply_limit("SELECT a FROM t", 0)
    assert out.endswith("LIMIT 0")


# ── _arrow_decimal_from_mysql_field ──────────────────────────────────────


def test_decimal_type_passthrough() -> None:
    # DECIMAL(12, 4) signed → MySQLdb description length = 12 + 1 (sign) + 1
    # (decimal point) = 14.
    t = _arrow_decimal_from_mysql_field(14, 4, is_unsigned=False)
    assert pa.types.is_decimal(t)
    assert t.precision == 12
    assert t.scale == 4


def test_decimal_type_unsigned_recovers_precision() -> None:
    # DECIMAL(12, 4) UNSIGNED → length = 12 + 0 (no sign) + 1 (point) = 13.
    t = _arrow_decimal_from_mysql_field(13, 4, is_unsigned=True)
    assert t.precision == 12
    assert t.scale == 4


def test_decimal_type_zero_scale() -> None:
    # DECIMAL(10, 0) signed → length = 10 + 1 (sign) + 0 (no point) = 11.
    t = _arrow_decimal_from_mysql_field(11, 0, is_unsigned=False)
    assert t.precision == 10
    assert t.scale == 0


def test_decimal_type_high_scale() -> None:
    """MySQL allows scale up to 30 — we must not clamp below that for
    precision >= 30."""
    # DECIMAL(38, 30) signed → length = 38 + 1 + 1 = 40.
    t = _arrow_decimal_from_mysql_field(40, 30, is_unsigned=False)
    assert t.precision == 38
    assert t.scale == 30


def test_decimal_type_clamps_above_arrow_max_precision() -> None:
    """MySQL precision tops at 65; Arrow decimal128 tops at 38. We clamp."""
    # DECIMAL(65, 30) signed → length = 65 + 1 + 1 = 67.
    t = _arrow_decimal_from_mysql_field(67, 30, is_unsigned=False)
    assert t.precision == 38
    assert t.scale == 30


def test_decimal_type_none_uses_fallback() -> None:
    t = _arrow_decimal_from_mysql_field(None, None)
    assert t.precision == 38
    assert t.scale == 9


def test_decimal_type_scale_not_greater_than_precision() -> None:
    # Pathological case: length implies tiny precision but scale is huge.
    # Result must keep scale <= precision so PyArrow accepts the type.
    t = _arrow_decimal_from_mysql_field(7, 30, is_unsigned=False)
    assert t.scale <= t.precision
