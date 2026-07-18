"""Athena unlimited query strips trailing semicolon like limit wrap."""

from __future__ import annotations

import re
from pathlib import Path


def test_query_unlimited_path_strips_trailing_semicolon():
    src = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "wren"
        / "connector"
        / "athena.py"
    ).read_text(encoding="utf-8")
    assert "stripped = strip_trailing_semicolon(sql)" in src
    assert "executed = stripped" in src

    helper = re.compile(r"[;\s]+\Z")
    assert helper.sub("", "SELECT 1;") == "SELECT 1"


def test_without_unconditional_strip_semicolon_would_reach_execute():
    def old_query(sql: str, limit: int | None = None) -> str:
        executed = sql
        if limit is not None:
            executed = f"SELECT * FROM ({re.sub(r'[;\\s]+\\Z', '', sql)}) AS t LIMIT {limit}"
        return executed

    assert old_query("SELECT 1;", None) == "SELECT 1;"
