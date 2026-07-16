"""strip_trailing_semicolon must not TypeError on non-string SQL."""

from wren.connector.base import strip_trailing_semicolon


def test_none_returns_empty():
    assert strip_trailing_semicolon(None) == ""  # type: ignore[arg-type]


def test_bytes_returns_empty():
    assert strip_trailing_semicolon(b"SELECT 1;") == ""  # type: ignore[arg-type]


def test_string_still_strips():
    assert strip_trailing_semicolon("SELECT 1;") == "SELECT 1"
