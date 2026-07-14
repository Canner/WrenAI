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
    ],
)
def test_strip_trailing_semicolon(raw: str, expected: str) -> None:
    assert strip_trailing_semicolon(raw) == expected
