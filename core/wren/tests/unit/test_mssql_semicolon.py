"""MSSQL trailing-semicolon strip before sqlglot LIMIT rewrite."""

from wren.connector.mssql import MSSqlConnector, _strip_trailing_semicolon


def test_helper_strips_multi_semicolon():
    assert _strip_trailing_semicolon("SELECT 1;;") == "SELECT 1"
    assert _strip_trailing_semicolon("SELECT 1; ;") == "SELECT 1"


def test_raw_cursor_sql_injects_limit_after_multi_semicolon():
    out = MSSqlConnector._raw_cursor_sql("SELECT 1;;", 5)
    # MSSQL paginates via OFFSET 0 ROWS FETCH NEXT n ROWS ONLY — assert the
    # limit-injection marker directly rather than a weak catch-all.
    assert "FETCH NEXT" in out.upper()
    # Must not leave the double terminator which becomes a Block parse
    assert ";;" not in out


def test_raw_cursor_sql_no_limit_unchanged_except_strip_not_required():
    # limit None returns original (including trailing ;) — execute path allows it
    assert MSSqlConnector._raw_cursor_sql("SELECT 1;", None) == "SELECT 1;"
