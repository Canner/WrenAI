"""O6 — pluggable recall backend; grep works without the `memory` extra.

Runs in the unit job. The grep backend is dependency-free; CLI tests force
WREN_MEMORY_BACKEND=grep so they exercise the no-extra path even when the
extra happens to be installed locally.
"""

from __future__ import annotations

from typer.testing import CliRunner

from wren.cli import app
from wren.memory.index_backend import GrepIndex, resolve_backend
from wren.memory.markdown import write_query_markdown

runner = CliRunner()


# ── GrepIndex (dependency-free) ────────────────────────────────────────────


def _seed(tmp_path):
    write_query_markdown(
        tmp_path, "Total revenue by month", "SELECT month, SUM(amount) FROM orders"
    )
    write_query_markdown(
        tmp_path, "Number of customers", "SELECT COUNT(*) FROM customers"
    )


def test_grep_search_token_overlap(tmp_path):
    _seed(tmp_path)
    hits = GrepIndex(tmp_path).search("monthly revenue", limit=3)
    assert hits
    assert hits[0]["nl_query"] == "Total revenue by month"
    assert hits[0]["path"] == "knowledge/sql/total-revenue-by-month.md"


def test_grep_search_no_match(tmp_path):
    _seed(tmp_path)
    assert GrepIndex(tmp_path).search("xyzzy unrelated", limit=3) == []


def test_grep_search_datasource_filter(tmp_path):
    write_query_markdown(tmp_path, "Revenue pg", "SELECT 1", datasource="postgres")
    write_query_markdown(tmp_path, "Revenue bq", "SELECT 2", datasource="bigquery")
    hits = GrepIndex(tmp_path).search("revenue", limit=5, datasource="postgres")
    assert [h["nl_query"] for h in hits] == ["Revenue pg"]


def test_grep_rebuild_and_status_and_reset(tmp_path):
    _seed(tmp_path)
    idx = GrepIndex(tmp_path)
    assert idx.rebuild()["pairs"] == 2
    assert idx.status() == {"backend": "grep", "pairs": 2}
    idx.reset()  # no-op, must not raise
    assert idx.status()["pairs"] == 2


def test_resolve_backend_env_override():
    assert resolve_backend("grep") == "grep"
    assert resolve_backend("lancedb") == "lancedb"


# ── CLI commands over the grep backend (no extra needed) ───────────────────


def test_cli_recall_grep_without_semantic(tmp_path, monkeypatch):
    monkeypatch.setenv("WREN_PROJECT_HOME", str(tmp_path))
    monkeypatch.setenv("WREN_MEMORY_BACKEND", "grep")
    _seed(tmp_path)
    result = runner.invoke(
        app, ["memory", "recall", "-q", "revenue by month", "-o", "json"]
    )
    assert result.exit_code == 0, result.output
    assert "Total revenue by month" in result.output
    assert "knowledge/sql/total-revenue-by-month.md" in result.output


def test_cli_index_grep_is_noop(tmp_path, monkeypatch):
    monkeypatch.setenv("WREN_PROJECT_HOME", str(tmp_path))
    monkeypatch.setenv("WREN_MEMORY_BACKEND", "grep")
    _seed(tmp_path)
    result = runner.invoke(app, ["memory", "index"])
    assert result.exit_code == 0, result.output
    assert "grep backend" in result.output
    assert "2 pair(s)" in result.output


def test_cli_status_and_reset_and_check_grep(tmp_path, monkeypatch):
    monkeypatch.setenv("WREN_PROJECT_HOME", str(tmp_path))
    monkeypatch.setenv("WREN_MEMORY_BACKEND", "grep")
    _seed(tmp_path)

    status = runner.invoke(app, ["memory", "status"])
    assert status.exit_code == 0, status.output
    assert "Backend: grep" in status.output

    reset = runner.invoke(app, ["memory", "reset", "--force"])
    assert reset.exit_code == 0, reset.output
    assert "no derived index" in reset.output

    check = runner.invoke(app, ["memory", "check"])
    assert check.exit_code == 0, check.output
    assert "always in sync" in check.output
