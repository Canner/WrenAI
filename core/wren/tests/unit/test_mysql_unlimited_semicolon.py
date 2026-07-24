"""MySQL unlimited query strips trailing semis (source pin)."""

from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "src" / "wren" / "connector" / "mysql.py"


def test_query_always_strips_before_limit():
    text = SRC.read_text(encoding="utf-8")
    start = text.index("def query(self, sql: str, limit: int | None = None)")
    end = text.index("def dry_run(self, sql: str)", start)
    body = text[start:end]
    assert "sql = strip_trailing_semicolon(sql)" in body
    assert body.index("sql = strip_trailing_semicolon(sql)") < body.index(
        "if limit is not None:"
    )
