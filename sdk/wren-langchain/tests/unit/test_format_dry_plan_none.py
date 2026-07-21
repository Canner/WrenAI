"""format_dry_plan_content must not render literal None."""

from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "src" / "wren_langchain" / "_format.py"


def test_source_coerces_none():
    text = SRC.read_text(encoding="utf-8")
    assert 'text = "" if sql is None else str(sql)' in text
    assert "sql: str | None" in text
