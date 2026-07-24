"""Snowflake unlimited query strips trailing semicolons (source pin)."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src" / "wren" / "connector" / "snowflake.py"


def test_query_always_strips_before_limit_branch():
    body = SRC.read_text(encoding="utf-8")
    start = body.index("def query(self, sql: str, limit: int | None = None)")
    end = body.index("def dry_run(self, sql: str)", start)
    section = body[start:end]
    assert "sql = strip_trailing_semicolon(sql)" in section
    assert section.index("sql = strip_trailing_semicolon(sql)") < section.index(
        "if limit is not None:"
    )
