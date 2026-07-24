"""format_store_content must tolerate None/non-str nl/sql and bad tags."""

from __future__ import annotations

from wren_langchain._format import format_store_content


def test_format_store_content_happy_path() -> None:
    out = format_store_content("List orders", "SELECT 1\nFROM t", ["a", "b"])
    assert 'Stored: "List orders"' in out
    assert "SELECT 1" in out
    assert "(2 tags)" in out


def test_format_store_content_none_sql_and_nl() -> None:
    out = format_store_content(None, None, None)  # type: ignore[arg-type]
    assert 'Stored: ""' in out
    assert "(0 tags)" in out


def test_format_store_content_non_string_text() -> None:
    out = format_store_content(123, 456, [])  # type: ignore[arg-type]
    assert 'Stored: "123"' in out
    assert "456" in out


def test_format_store_content_non_list_tags() -> None:
    out = format_store_content("q", "SELECT 1", "tags")  # type: ignore[arg-type]
    assert "(0 tags)" in out
