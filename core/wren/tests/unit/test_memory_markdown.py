"""O4 — knowledge/sql/*.md is the source of truth for NL→SQL memory.

These run in the unit job (no `memory` extra): markdown writing is
dependency-free and `wren memory store` must work without LanceDB.
"""

from __future__ import annotations

import yaml
from typer.testing import CliRunner

from wren.cli import app
from wren.memory.markdown import (
    load_query_pairs,
    parse_query_markdown,
    slugify,
    write_query_markdown,
)

runner = CliRunner()


def test_slugify_normalizes_and_truncates():
    assert slugify("What is the total revenue?") == "what-is-the-total-revenue"
    assert slugify("  Trim/These  ") == "trim-these"
    assert slugify("!!!") == "query"
    assert len(slugify("word " * 40)) <= 60


def test_write_query_markdown_frontmatter(tmp_path):
    dest = write_query_markdown(
        tmp_path,
        "Total revenue?",
        "SELECT SUM(amount) FROM orders",
        datasource="postgres",
        tags=["revenue", "kpi"],
    )
    assert dest == tmp_path / "knowledge" / "sql" / "total-revenue.md"
    fm = parse_query_markdown(dest)
    assert fm["nl"] == "Total revenue?"
    assert "SUM(amount)" in fm["sql"]
    assert fm["datasource"] == "postgres"
    assert fm["tags"] == ["revenue", "kpi"]
    assert fm["source"] == "user"


def test_write_query_markdown_minimal(tmp_path):
    dest = write_query_markdown(tmp_path, "Count orders", "SELECT COUNT(*) FROM orders")
    fm = parse_query_markdown(dest)
    assert fm["nl"] == "Count orders"
    assert "datasource" not in fm
    assert "tags" not in fm


def test_same_nl_updates_same_file(tmp_path):
    a = write_query_markdown(tmp_path, "Total revenue?", "SELECT 1")
    b = write_query_markdown(
        tmp_path, "Total revenue?", "SELECT SUM(amount) FROM orders"
    )
    assert a == b  # same slug, updated in place
    files = list((tmp_path / "knowledge" / "sql").glob("*.md"))
    assert len(files) == 1
    assert "SUM(amount)" in parse_query_markdown(b)["sql"]


def test_same_nl_with_whitespace_reuses_file(tmp_path):
    """NLs differing only by surrounding whitespace map to the same file."""
    a = write_query_markdown(tmp_path, "Total revenue?", "SELECT 1")
    b = write_query_markdown(tmp_path, "  Total revenue?  ", "SELECT 2")
    assert a == b
    assert len(list((tmp_path / "knowledge" / "sql").glob("*.md"))) == 1


def test_sql_containing_dashes_roundtrips(tmp_path):
    """SQL whose body contains a '---' line must not break frontmatter parsing."""
    sql = "SELECT 1\n---\nUNION ALL\nSELECT 2"
    dest = write_query_markdown(tmp_path, "Dashy query", sql)
    fm = parse_query_markdown(dest)
    assert fm["nl"] == "Dashy query"
    assert fm["sql"] == sql


def test_slug_collision_gets_suffix(tmp_path):
    a = write_query_markdown(tmp_path, "Revenue?!", "SELECT 1")
    b = write_query_markdown(tmp_path, "Revenue???", "SELECT 2")  # same slug base
    assert a != b
    assert b.name == "revenue-2.md"
    assert len(list((tmp_path / "knowledge" / "sql").glob("*.md"))) == 2


def test_parse_source_handles_null_tags():
    """A null/empty tags value must not crash export's source parsing."""
    from wren.memory.cli import _parse_source  # noqa: PLC0415

    assert _parse_source(None) == "user"
    assert _parse_source("") == "user"
    assert _parse_source("source:seed") == "seed"


def test_write_query_markdown_created_at(tmp_path):
    """created_at is written when provided and ignored by the pair loader."""
    dest = write_query_markdown(
        tmp_path, "Q", "SELECT 1", created_at="2026-01-02T03:04:05+00:00"
    )
    fm = parse_query_markdown(dest)
    assert fm["created_at"] == "2026-01-02T03:04:05+00:00"
    pairs = load_query_pairs(tmp_path)
    assert pairs[0]["nl"] == "Q" and "created_at" not in pairs[0]


def test_load_query_pairs(tmp_path):
    write_query_markdown(
        tmp_path,
        "Total revenue",
        "SELECT SUM(amount) FROM orders",
        datasource="postgres",
        tags=["revenue"],
    )
    write_query_markdown(tmp_path, "Count orders", "SELECT COUNT(*) FROM orders")
    pairs = load_query_pairs(tmp_path)
    assert len(pairs) == 2
    by_nl = {p["nl"]: p for p in pairs}
    assert by_nl["Total revenue"]["sql"].startswith("SELECT SUM")
    assert by_nl["Total revenue"]["datasource"] == "postgres"
    assert by_nl["Total revenue"]["tags"] == ["revenue"]
    assert by_nl["Total revenue"]["source"] == "user"
    assert by_nl["Count orders"]["path"] == "knowledge/sql/count-orders.md"


def test_load_query_pairs_empty(tmp_path):
    assert load_query_pairs(tmp_path) == []


def test_load_query_pairs_skips_unparseable(tmp_path):
    sql_dir = tmp_path / "knowledge" / "sql"
    sql_dir.mkdir(parents=True)
    (sql_dir / "notes.md").write_text("# just a note, no frontmatter\n")
    (sql_dir / "partial.md").write_text("---\nnl: only nl, no sql\n---\n")
    # malformed YAML frontmatter must be skipped, not crash the whole load
    (sql_dir / "broken.md").write_text("---\nnl: [unterminated\nsql: x\n---\n")
    write_query_markdown(tmp_path, "Good one", "SELECT 1")
    pairs = load_query_pairs(tmp_path)
    assert [p["nl"] for p in pairs] == ["Good one"]


def test_recall_path_annotation_handles_collisions(tmp_path, monkeypatch):
    """recall path annotation matches on exact NL, not a derived slug."""
    from wren.memory.cli import _annotate_markdown_paths  # noqa: PLC0415

    monkeypatch.setenv("WREN_PROJECT_HOME", str(tmp_path))
    write_query_markdown(tmp_path, "Revenue?!", "SELECT 1")  # -> revenue.md
    write_query_markdown(tmp_path, "Revenue???", "SELECT 2")  # -> revenue-2.md
    results = [{"nl_query": "Revenue???", "sql_query": "SELECT 2"}]
    _annotate_markdown_paths(results)
    assert results[0]["path"] == "knowledge/sql/revenue-2.md"


def test_cli_store_writes_markdown_without_extra(tmp_path, monkeypatch):
    """`wren memory store` works without the memory extra — markdown only."""
    monkeypatch.setenv("WREN_PROJECT_HOME", str(tmp_path))
    result = runner.invoke(
        app,
        [
            "memory",
            "store",
            "--nl",
            "Top customers by revenue",
            "--sql",
            "SELECT customer_id, SUM(amount) FROM orders GROUP BY 1",
            "--tags",
            "revenue,customers",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "Stored:" in result.output
    md = tmp_path / "knowledge" / "sql" / "top-customers-by-revenue.md"
    assert md.exists()
    fm = yaml.safe_load(md.read_text().split("---")[1])
    assert fm["tags"] == ["revenue", "customers"]
