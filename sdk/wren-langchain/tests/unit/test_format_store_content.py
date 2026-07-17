"""format_store_content must tolerate None/non-str nl/sql and bad tags."""

from __future__ import annotations

import importlib.util
import pathlib

_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "src"
    / "wren_langchain"
    / "_format.py"
)
_spec = importlib.util.spec_from_file_location("wren_langchain_format_store_ut", _PATH)
_fmt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fmt)


def test_format_store_content_happy_path() -> None:
    out = _fmt.format_store_content("List orders", "SELECT 1\nFROM t", ["a", "b"])
    assert 'Stored: "List orders"' in out
    assert "SELECT 1" in out
    assert "(2 tags)" in out


def test_format_store_content_none_sql_and_nl() -> None:
    out = _fmt.format_store_content(None, None, None)  # type: ignore[arg-type]
    assert 'Stored: ""' in out
    assert "(0 tags)" in out


def test_format_store_content_non_list_tags() -> None:
    out = _fmt.format_store_content("q", "SELECT 1", "tags")  # type: ignore[arg-type]
    assert "(0 tags)" in out
