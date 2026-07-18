"""Redshift unlimited query strips trailing semicolon."""

from __future__ import annotations

import re
from pathlib import Path


def test_query_unlimited_path_strips():
    src = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "wren"
        / "connector"
        / "redshift.py"
    ).read_text(encoding="utf-8")
    q = src.split("def query", 1)[1].split("def dry_run", 1)[0]
    assert "sql = strip_trailing_semicolon(sql)" in q
    helper = re.compile(r"[;\s]+\Z")
    assert helper.sub("", "SELECT 1;") == "SELECT 1"
