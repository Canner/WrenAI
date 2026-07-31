"""BigQuery limit coercion helpers."""

from __future__ import annotations

import pytest

from wren.connector.bigquery import _apply_limit, _coerce_limit

pytestmark = pytest.mark.unit


def test_coerce_limit_none() -> None:
    assert _coerce_limit(None) is None


def test_coerce_limit_rejects_negative() -> None:
    with pytest.raises(ValueError):
        _coerce_limit(-1)


def test_coerce_limit_rejects_injection() -> None:
    with pytest.raises(ValueError):
        _coerce_limit("1 OR 1=1")


def test_apply_limit_uses_int() -> None:
    assert _apply_limit("SELECT 1;", 2) == "SELECT * FROM (SELECT 1) AS _sub LIMIT 2"
