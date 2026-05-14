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
    _build_mysql_column,
    _coerce_limit,
    _mysql_blob_codes,
    _mysql_decimal_codes,
    _mysql_field_type_map,
    _mysql_string_codes,
    _mysql_unsigned_variant_map,
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


# ── TIME → duration round-trip ────────────────────────────────────────────


def test_time_column_preserves_negative_and_over_24h() -> None:
    """MySQL ``TIME`` ranges ``-838:59:59`` to ``838:59:59`` and can be
    negative. The Arrow type must be ``duration("us")``, not ``time64("us")``
    (which only accepts 0-24h positive values), and the conversion must
    preserve the sign and magnitude of MySQLdb's ``datetime.timedelta``
    values.
    """
    import datetime  # noqa: PLC0415

    values = [
        datetime.timedelta(hours=-100),
        datetime.timedelta(0),
        datetime.timedelta(hours=838, minutes=59, seconds=59),
        -datetime.timedelta(hours=838, minutes=59, seconds=59),
        None,
    ]
    arr = _build_mysql_column(values, pa.duration("us"))
    assert pa.types.is_duration(arr.type)
    out = arr.to_pylist()
    assert out[0] == datetime.timedelta(hours=-100)
    assert out[1] == datetime.timedelta(0)
    assert out[2] == datetime.timedelta(hours=838, minutes=59, seconds=59)
    assert out[3] == -datetime.timedelta(hours=838, minutes=59, seconds=59)
    assert out[4] is None


# ── Thread-safe lazy init ────────────────────────────────────────────────


def test_lazy_init_thread_safe() -> None:
    """The cached FIELD_TYPE accessors must publish fully-populated results
    even when many threads hit them concurrently on a cold cache.

    The previous in-place dict/set mutation pattern could expose a partially
    populated map to a thread that raced the initializer. ``functools.cache``
    guarantees the initializer body runs to completion before the result is
    visible to any caller.
    """
    pytest.importorskip("MySQLdb")
    from concurrent.futures import ThreadPoolExecutor  # noqa: PLC0415

    accessors = (
        _mysql_field_type_map,
        _mysql_unsigned_variant_map,
        _mysql_blob_codes,
        _mysql_string_codes,
        _mysql_decimal_codes,
    )
    for fn in accessors:
        fn.cache_clear()

    # Capture the expected fully-populated reference values once, single-
    # threaded, so the assertions below have a definitive ground truth.
    expected = {fn: fn() for fn in accessors}
    for fn in accessors:
        fn.cache_clear()

    def hit_all() -> tuple:
        return tuple(fn() for fn in accessors)

    with ThreadPoolExecutor(max_workers=16) as ex:
        results = list(ex.map(lambda _: hit_all(), range(64)))

    for row in results:
        for fn, got in zip(accessors, row, strict=True):
            # Every thread sees the same fully-populated object.
            assert got == expected[fn]
            # Sanity: the field-type map is non-empty (MySQLdb constants exist).
            if fn is _mysql_field_type_map:
                assert len(got) > 0
