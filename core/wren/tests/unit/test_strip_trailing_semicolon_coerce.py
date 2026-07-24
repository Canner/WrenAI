from wren.connector.base import strip_trailing_semicolon


def test_strips_string():
    assert strip_trailing_semicolon("SELECT 1;") == "SELECT 1"
    assert strip_trailing_semicolon("SELECT 1 ; \n") == "SELECT 1"


def test_none_becomes_empty():
    assert strip_trailing_semicolon(None) == ""


def test_non_string_coerced():
    assert strip_trailing_semicolon(42) == "42"
