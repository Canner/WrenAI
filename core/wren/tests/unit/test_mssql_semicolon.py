"""MSSQL trailing-semicolon strip before sqlglot LIMIT rewrite."""

from wren.connector.base import strip_trailing_semicolon
from wren.connector.mssql import MSSqlConnector


def test_helper_strips_multi_semicolon():
    assert strip_trailing_semicolon("SELECT 1;;") == "SELECT 1"
    assert strip_trailing_semicolon("SELECT 1; ;") == "SELECT 1"


def test_raw_cursor_sql_injects_limit_after_multi_semicolon():
    out = MSSqlConnector._raw_cursor_sql("SELECT 1;;", 5)
    # sqlglot tsql may emit TOP n for simple Select (e.g. "SELECT TOP 5 1")
    # or OFFSET/FETCH for paginated shapes. Either limits correctly after
    # multi-semicolon strip (without TOP/FETCH, LIMIT injection failed).
    upper = out.upper()
    assert "TOP" in upper or "FETCH NEXT" in upper, upper
    assert "5" in out
    # Must not leave the double terminator which becomes a Block parse
    assert ";;" not in out


def test_raw_cursor_sql_no_limit_strips_trailing_semicolon():
    # Unlimited path still strips a terminating ``;`` so paste/execute matches
    # limited / dry_run composition (multi-statement terminator surprises).
    assert MSSqlConnector._raw_cursor_sql("SELECT 1;", None) == "SELECT 1"
    assert MSSqlConnector._raw_cursor_sql("SELECT 1;;", None) == "SELECT 1"
