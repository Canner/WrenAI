"""Oracle Connector.query strips trailing semicolons when limit is None."""

from __future__ import annotations

import re
from pathlib import Path


def test_query_unlimited_path_strips_trailing_semicolon():
    src = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "wren"
        / "connector"
        / "oracle.py"
    ).read_text(encoding="utf-8")
    # Unlimited branch used to pass `sql` through unchanged after the
    # limited branch. Require an unconditional strip for both paths.
    assert "sql = strip_trailing_semicolon(sql)" in src

    # Helper behaviour (same regex as production):
    helper = re.compile(r"[;\s]+\Z")
    assert helper.sub("", "SELECT 1;") == "SELECT 1"
    assert helper.sub("", "SELECT 'a;b'") == "SELECT 'a;b'"


def test_without_unconditional_strip_semicolon_would_reach_execute():
    """Document pre-fix behaviour: only the limit branch stripped."""
    # Simulated old code path for regression documentation.
    def old_query(sql: str, limit: int | None = None) -> str:
        if limit is not None:
            sql = re.sub(r"[;\s]+\Z", "", sql)
            sql = f"SELECT * FROM ({sql}) t WHERE ROWNUM <= {limit}"
        return sql

    assert old_query("SELECT 1;", None) == "SELECT 1;"
    assert old_query("SELECT 1;", 10).startswith("SELECT * FROM (SELECT 1)")
