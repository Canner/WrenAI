"""Trailing-semicolon stripping for MySQL LIMIT/EXPLAIN builders."""

from wren.connector.mysql import _apply_limit, _strip_trailing_semicolon


def test_apply_limit_strips_trailing_semicolon():
    assert _apply_limit("SELECT 1;", 5) == "SELECT 1\nLIMIT 5"


def test_apply_limit_strips_multi_semicolon_with_interior_space():
    # rstrip(';') chain leaves a semicolon when whitespace sits between semis.
    assert _apply_limit("SELECT 1; ;", 3) == "SELECT 1\nLIMIT 3"


def test_helper_preserves_semicolon_in_string_literal():
    sql = "SELECT 'a;b' AS x"
    assert _strip_trailing_semicolon(sql) == sql


def test_helper_double_semicolon():
    assert _strip_trailing_semicolon("SELECT 1;;") == "SELECT 1"
