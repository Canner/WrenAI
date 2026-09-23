"""Shared strip_trailing_semicolon helper (connector base)."""

import pytest

from wren.connector.base import strip_trailing_semicolon


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("SELECT 1", "SELECT 1"),
        ("SELECT 1;", "SELECT 1"),
        ("SELECT 1;  \n", "SELECT 1"),
        ("SELECT 1 ; ;", "SELECT 1"),
        ("SELECT 1;;\n\t", "SELECT 1"),
        ("SELECT 'a;b' AS x", "SELECT 'a;b' AS x"),
        ("SELECT 'a;b' AS x;", "SELECT 'a;b' AS x"),
        ("SELECT 'a;b' AS x ; ;  ", "SELECT 'a;b' AS x"),
        ("SELECT 1 AS x; -- pick", "SELECT 1 AS x"),
        ("SELECT 1 AS x; /* b */", "SELECT 1 AS x"),
        ("SELECT 1 AS x ;  --c\n", "SELECT 1 AS x"),
        ("SELECT 1 AS x;; -- final", "SELECT 1 AS x"),
        ("SELECT 1 AS x;\n-- a\n-- b", "SELECT 1 AS x"),
        ("SELECT 'a;b' AS x; -- q", "SELECT 'a;b' AS x"),
        ("SELECT 1 -- keep me", "SELECT 1 -- keep me"),
        ("SELECT 1 -- no semicolon ;\n-- keep", "SELECT 1 -- no semicolon ;\n-- keep"),
    ],
)
def test_strip_trailing_semicolon(raw: str, expected: str) -> None:
    assert strip_trailing_semicolon(raw) == expected


@pytest.mark.parametrize(
    ("raw", "dialect", "expected"),
    [
        # Which escapes / quote forms are lexical differs per dialect, and an
        # end-anchored regex cannot see any of them. Each row is the input plus
        # the dialect that legitimately accepts that spelling.
        (r"SELECT 'it\'s' AS x;", "mysql", r"SELECT 'it\'s' AS x"),
        (r"SELECT 'it\'s' AS x;", "bigquery", r"SELECT 'it\'s' AS x"),
        (r"SELECT 'it\'s' AS x;", "spark", r"SELECT 'it\'s' AS x"),
        (r"SELECT 'it\'s' AS x;", "databricks", r"SELECT 'it\'s' AS x"),
        (r"SELECT 'it\'s' AS x;", "clickhouse", r"SELECT 'it\'s' AS x"),
        (r"SELECT E'it\'s' AS x;", "postgres", r"SELECT E'it\'s' AS x"),
        ("SELECT $$it's$$ AS x;", "postgres", "SELECT $$it's$$ AS x"),
        ("SELECT $$it's$$ AS x;", "duckdb", "SELECT $$it's$$ AS x"),
        ("SELECT `a--b` FROM t;", "mysql", "SELECT `a--b` FROM t"),
        ("SELECT [a--b] FROM t;", "tsql", "SELECT [a--b] FROM t"),
        # A quote *after* the terminating `;` must not swallow the rest: SQL that
        # does not end in a comment after the `;` is returned untouched.
        ("SELECT 1; 'x'", "mysql", "SELECT 1; 'x'"),
        ("SELECT 1; 'x'", None, "SELECT 1; 'x'"),
    ],
)
def test_dialect_specific_lexical_forms(raw: str, dialect: str | None, expected: str) -> None:
    assert strip_trailing_semicolon(raw, dialect) == expected


def test_an_unterminated_block_comment_falls_back_and_keeps_the_semicolon() -> None:
    """Documented limit of the tokenizer approach, pinned deliberately.

    sqlglot raises ``TokenError`` on a block comment that never closes, and the
    fallback is the previous end-anchored regex — which cannot reach a `;` that
    is followed by text. So this input keeps its semicolon. It is malformed SQL
    that the engine would reject regardless, and the alternative (guessing where
    the comment ends) is what this function stopped doing.
    """
    raw = "SELECT 1; /* unterminated"
    assert strip_trailing_semicolon(raw, "mysql") == raw


def test_a_closed_block_comment_after_the_semicolon_is_dropped() -> None:
    """Contrast with the case above: lexically complete comments are handled."""
    assert strip_trailing_semicolon("SELECT 1 AS x; /* b */", "mysql") == "SELECT 1 AS x"
