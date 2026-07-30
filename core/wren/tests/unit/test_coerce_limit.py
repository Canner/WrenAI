"""Unit tests for wren.connector.base.coerce_limit."""

from __future__ import annotations

import pytest

from wren.connector.base import coerce_limit


def test_none_passthrough() -> None:
    assert coerce_limit(None) is None


def test_accepts_int() -> None:
    assert coerce_limit(10) == 10


def test_accepts_numeric_string() -> None:
    assert coerce_limit("25") == 25


def test_rejects_injection_string() -> None:
    with pytest.raises(ValueError):
        coerce_limit("1; DROP TABLE foo")


def test_rejects_negative() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        coerce_limit(-3)
