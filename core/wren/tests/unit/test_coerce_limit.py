"""Unit tests for wren.connector.base.coerce_limit."""

from __future__ import annotations

from decimal import Decimal
from fractions import Fraction

import pytest

from wren.connector.base import coerce_limit


def test_none_passthrough() -> None:
    assert coerce_limit(None) is None


def test_accepts_int() -> None:
    assert coerce_limit(10) == 10
    assert coerce_limit(0) == 0


def test_rejects_bool() -> None:
    with pytest.raises(ValueError, match="bool"):
        coerce_limit(True)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="bool"):
        coerce_limit(False)  # type: ignore[arg-type]


def test_rejects_non_integral_float() -> None:
    with pytest.raises(ValueError, match="integral"):
        coerce_limit(-0.5)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="integral"):
        coerce_limit(1.5)  # type: ignore[arg-type]


def test_accepts_integral_float() -> None:
    assert coerce_limit(2.0) == 2  # type: ignore[arg-type]


def test_rejects_injection_string() -> None:
    with pytest.raises(ValueError):
        coerce_limit("1; DROP TABLE foo")  # type: ignore[arg-type]


def test_rejects_negative() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        coerce_limit(-3)


def test_rejects_non_numeric() -> None:
    with pytest.raises(ValueError):
        coerce_limit(object())  # type: ignore[arg-type]


def test_rejects_non_integral_decimal_and_fraction() -> None:
    with pytest.raises(ValueError, match="integral"):
        coerce_limit(Decimal("1.5"))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="integral"):
        coerce_limit(Fraction(3, 2))  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        coerce_limit(Decimal("-0.5"))  # type: ignore[arg-type]


def test_accepts_integral_decimal() -> None:
    assert coerce_limit(Decimal("2.0")) == 2  # type: ignore[arg-type]


def test_preserves_oversized_int_without_float_overflow() -> None:
    huge = 10**400
    # Preserve arbitrary-size integers without converting through float.
    assert coerce_limit(huge) == huge
