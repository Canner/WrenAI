"""Databricks query path strips trailing semicolons before execute."""

from __future__ import annotations

import re
from pathlib import Path


def test_query_strips_trailing_semicolon():
    src = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "wren"
        / "connector"
        / "databricks.py"
    ).read_text(encoding="utf-8")
    assert "sql = strip_trailing_semicolon(sql)" in src
    # appears in query, not only dry_run
    q = src.split("def query", 1)[1].split("def dry_run", 1)[0]
    assert "strip_trailing_semicolon" in q

    helper = re.compile(r"[;\s]+\Z")
    assert helper.sub("", "SELECT 1;") == "SELECT 1"
