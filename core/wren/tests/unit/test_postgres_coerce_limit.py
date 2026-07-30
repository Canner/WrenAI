"""Postgres query must coerce LIMIT before SQL interpolation."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from wren.connector import postgres as pg_mod


def _connector():
    c = object.__new__(pg_mod.PostgresConnector)
    c.connection = MagicMock()
    c._closed = False
    return c


def test_reject_negative_limit():
    c = _connector()
    with pytest.raises(ValueError, match="non-negative"):
        c.query("SELECT 1", limit=-1)


def test_reject_injection_string():
    c = _connector()
    with pytest.raises(ValueError):
        c.query("SELECT 1", limit="1; DROP TABLE t")


def test_numeric_string_limit_interpolated():
    c = _connector()
    cursor = MagicMock()
    cursor.__enter__ = MagicMock(return_value=cursor)
    cursor.__exit__ = MagicMock(return_value=False)
    c.connection.cursor.return_value = cursor
    with patch.object(pg_mod, "_build_pg_arrow_table", return_value="tbl"):
        out = c.query("SELECT 1", limit="3")
    assert out == "tbl"
    executed = cursor.execute.call_args[0][0]
    assert "LIMIT 3" in executed
    assert "DROP" not in executed
