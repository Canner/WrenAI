"""Trino query must coerce LIMIT before SQL interpolation."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from wren.connector import trino as trino_mod


def _connector():
    c = object.__new__(trino_mod.TrinoConnector)
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
    c.connection.cursor.return_value = cursor
    with patch.object(trino_mod, "_import_trino") as imp, patch.object(
        trino_mod, "_build_trino_arrow_table", return_value="tbl"
    ):
        trino_pkg = MagicMock()
        trino_pkg.exceptions.TrinoQueryError = type("TrinoQueryError", (Exception,), {})
        imp.return_value = trino_pkg
        out = c.query("SELECT 1", limit="4")
    assert out == "tbl"
    executed = cursor.execute.call_args[0][0]
    assert "LIMIT 4" in executed
    assert "DROP" not in executed
