"""OracleConnector must coerce limit before ROWNUM interpolation."""

from __future__ import annotations

import pyarrow as pa
import pytest

from wren.connector.oracle import OracleConnector, _coerce_limit

pytestmark = pytest.mark.unit


def test_coerce_limit_none() -> None:
    assert _coerce_limit(None) is None


def test_coerce_limit_rejects_injection() -> None:
    with pytest.raises(ValueError):
        _coerce_limit("1 OR 1=1")


def test_coerce_limit_rejects_negative() -> None:
    with pytest.raises(ValueError):
        _coerce_limit(-3)


class _Cursor:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql):
        self.sql = sql

    @property
    def description(self):
        return None

    def fetchall(self):
        return []


class _Conn:
    def __init__(self):
        self.cursor_obj = _Cursor()

    def cursor(self):
        return self.cursor_obj


def test_query_interpolates_coerced_int(monkeypatch) -> None:
    # Avoid real oracledb connect
    conn = _Conn()
    connector = OracleConnector.__new__(OracleConnector)
    connector.connection = conn
    # patch arrow builder to avoid oracledb dependency on description
    import wren.connector.oracle as oracle_mod

    monkeypatch.setattr(
        oracle_mod, "_build_oracle_arrow_table", lambda c: pa.table({})
    )
    connector.query("SELECT 1;", "5")
    assert "ROWNUM <= 5" in conn.cursor_obj.sql
    assert "SELECT 1;" not in conn.cursor_obj.sql
