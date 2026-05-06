"""Tests for runtime LLM-facing tools: wren_query, wren_dry_plan, wren_list_models."""

import json
from unittest.mock import MagicMock, patch

import pyarrow as pa
from wren.model.error import ErrorCode, ErrorPhase, WrenError

from wren_langchain import WrenToolkit


def _get_tool(toolkit, name):
    return next(t for t in toolkit.get_tools() if t.name == name)


def test_get_tools_returns_three_runtime_tools_when_memory_disabled(
    tmp_project, fake_active_profile
):
    """When memory is off, get_tools returns the 3 runtime-only tools."""
    toolkit = WrenToolkit.from_project(tmp_project)

    tools = toolkit.get_tools()
    names = sorted(t.name for t in tools)

    assert names == ["wren_dry_plan", "wren_list_models", "wren_query"]


def test_wren_query_success_envelope(tmp_project, fake_active_profile):
    fake_table = pa.table({"id": [1, 2], "name": ["a", "b"]})
    fake_engine = MagicMock(name="engine")
    fake_engine.query.return_value = fake_table
    fake_engine._connector = MagicMock()

    toolkit = WrenToolkit.from_project(tmp_project)
    tool = _get_tool(toolkit, "wren_query")

    with patch("wren_langchain._toolkit.WrenEngine", return_value=fake_engine):
        envelope = tool.invoke({"sql": "SELECT * FROM x", "limit": 50})

    assert envelope["ok"] is True
    assert envelope["data"]["columns"] == ["id", "name"]
    assert envelope["data"]["rows"] == [{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]
    assert envelope["data"]["row_count"] == 2
    assert envelope["data"]["content_truncated"] is False
    assert json.loads(envelope["content"]) == [
        {"id": 1, "name": "a"},
        {"id": 2, "name": "b"},
    ]


def test_wren_query_rejects_limit_above_hard_cap(tmp_project, fake_active_profile):
    """The LLM tool must guard against runaway `limit` values before
    materializing rows (typo / hallucinated huge number → memory blow-up)."""
    toolkit = WrenToolkit.from_project(tmp_project)
    tool = _get_tool(toolkit, "wren_query")

    # Don't even need to patch WrenEngine — validation should fire before
    # toolkit.query is called.
    envelope = tool.invoke({"sql": "SELECT 1", "limit": 100_000})

    assert envelope["ok"] is False
    assert "1 and 1000" in envelope["content"]


def test_wren_query_rejects_zero_or_negative_limit(tmp_project, fake_active_profile):
    """Zero / negative limits are nonsensical and would either return zero
    rows or fail in the DB layer with a less helpful message."""
    toolkit = WrenToolkit.from_project(tmp_project)
    tool = _get_tool(toolkit, "wren_query")

    envelope = tool.invoke({"sql": "SELECT 1", "limit": 0})

    assert envelope["ok"] is False
    assert "1 and 1000" in envelope["content"]


def test_wren_query_error_envelope_on_wren_error(tmp_project, fake_active_profile):
    fake_engine = MagicMock(name="engine")
    fake_engine.query.side_effect = WrenError(
        error_code=ErrorCode.INVALID_SQL,
        message="syntax error",
        phase=ErrorPhase.SQL_PARSING,
    )
    fake_engine._connector = MagicMock()

    toolkit = WrenToolkit.from_project(tmp_project)
    tool = _get_tool(toolkit, "wren_query")

    with patch("wren_langchain._toolkit.WrenEngine", return_value=fake_engine):
        envelope = tool.invoke({"sql": "SELEC * FROM x"})

    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "INVALID_SQL"
    assert envelope["error"]["phase"] == "SQL_PARSING"
    assert "syntax error" in envelope["content"]


def test_wren_dry_plan_returns_sql_code_block(tmp_project, fake_active_profile):
    fake_engine = MagicMock(name="engine")
    fake_engine.dry_plan.return_value = (
        "WITH cte_orders AS (...) SELECT * FROM cte_orders"
    )

    toolkit = WrenToolkit.from_project(tmp_project)
    tool = _get_tool(toolkit, "wren_dry_plan")

    with patch("wren_langchain._toolkit.WrenEngine", return_value=fake_engine):
        envelope = tool.invoke({"sql": "SELECT * FROM orders"})

    assert envelope["ok"] is True
    assert envelope["content"].startswith("```sql")
    assert envelope["content"].endswith("```")
    assert "cte_orders" in envelope["data"]["dialect_sql"]


def test_wren_list_models_returns_markdown_table(tmp_project, fake_active_profile):
    manifest = {
        "models": [
            {
                "name": "orders",
                "columns": [{"name": "id"}, {"name": "customer"}],
                "properties": {"description": "Customer orders"},
            },
            {
                "name": "customers",
                "columns": [{"name": "id"}],
            },
        ]
    }
    (tmp_project / "target" / "mdl.json").write_text(json.dumps(manifest))

    toolkit = WrenToolkit.from_project(tmp_project)
    tool = _get_tool(toolkit, "wren_list_models")

    envelope = tool.invoke({})

    assert envelope["ok"] is True
    assert "| model | cols | description |" in envelope["content"]
    assert "| orders | 2 | Customer orders |" in envelope["content"]
    assert "| customers | 1 |  |" in envelope["content"]
    assert len(envelope["data"]["models"]) == 2
