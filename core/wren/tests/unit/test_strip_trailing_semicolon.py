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
