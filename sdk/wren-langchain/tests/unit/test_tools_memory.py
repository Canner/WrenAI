"""Tests for memory LLM-facing tools."""

from unittest.mock import MagicMock, patch

from wren_langchain import WrenToolkit


def _enable_memory(tmp_project):
    (tmp_project / ".wren" / "memory").mkdir(parents=True)
    return tmp_project


def test_get_tools_returns_six_tools_when_memory_enabled(
    tmp_project, fake_active_profile
):
    """Memory enabled → 3 runtime + 3 memory tools."""
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_langchain._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        names = sorted(t.name for t in toolkit.get_tools())

    assert names == [
        "wren_dry_plan",
        "wren_fetch_context",
        "wren_list_models",
        "wren_query",
        "wren_recall_queries",
        "wren_store_query",
    ]


def test_include_memory_write_false_removes_store_query(
    tmp_project, fake_active_profile
):
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_langchain._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        names = sorted(t.name for t in toolkit.get_tools(include_memory_write=False))

    assert "wren_store_query" not in names
    assert "wren_fetch_context" in names
    assert "wren_recall_queries" in names


def test_include_memory_write_true_is_no_op_when_memory_disabled(
    tmp_project, fake_active_profile
):
    """When the project has no .wren/memory/, include_memory_write=True must
    silently produce no memory tools — not raise, not warn, not partially
    add tools that would fail on first call.
    """
    # tmp_project fixture does NOT create .wren/memory/, so memory auto-detects
    # as disabled.
    toolkit = WrenToolkit.from_project(tmp_project)

    tools_default = toolkit.get_tools()
    tools_explicit_true = toolkit.get_tools(include_memory_write=True)

    # Memory is disabled either way; no memory tools regardless of include flag.
    for tools in (tools_default, tools_explicit_true):
        names = {t.name for t in tools}
        assert "wren_store_query" not in names
        assert "wren_fetch_context" not in names
        assert "wren_recall_queries" not in names
        # Runtime tools are still present.
        assert "wren_query" in names


def test_wren_fetch_context_full_strategy(tmp_project, fake_active_profile):
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")
    fake_store.get_context.return_value = {
        "strategy": "full",
        "schema": "Schema text describing models...",
    }

    with patch("wren_langchain._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        tool = next(t for t in toolkit.get_tools() if t.name == "wren_fetch_context")
        envelope = tool.invoke({"question": "what models exist?"})

    assert envelope["ok"] is True
    assert envelope["data"]["strategy"] == "full"
    assert "Schema text" in envelope["content"]


def test_wren_fetch_context_search_strategy(tmp_project, fake_active_profile):
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")
    fake_store.get_context.return_value = {
        "strategy": "search",
        "results": [
            {"item_type": "model", "name": "orders", "summary": "orders model"},
            {"item_type": "column", "name": "orders.id", "summary": "primary key"},
        ],
    }

    with patch("wren_langchain._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        tool = next(t for t in toolkit.get_tools() if t.name == "wren_fetch_context")
        envelope = tool.invoke({"question": "orders"})

    assert envelope["ok"] is True
    assert envelope["data"]["strategy"] == "search"
    assert "[model] orders" in envelope["content"]
    assert "[column] orders.id" in envelope["content"]


def test_wren_recall_queries_formats_as_numbered_list(tmp_project, fake_active_profile):
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")
    fake_store.recall_queries.return_value = [
        {"nl_query": "top customers", "sql_query": "SELECT * FROM customers"},
        {"nl_query": "revenue by region", "sql_query": "SELECT region, SUM(revenue)"},
    ]

    with patch("wren_langchain._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        tool = next(t for t in toolkit.get_tools() if t.name == "wren_recall_queries")
        envelope = tool.invoke({"question": "customer rankings"})

    assert envelope["ok"] is True
    assert "1." in envelope["content"]
    assert "top customers" in envelope["content"]
    assert "```sql" in envelope["content"]
    assert len(envelope["data"]["results"]) == 2


def test_wren_store_query_returns_short_success_message(
    tmp_project, fake_active_profile
):
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_langchain._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        tool = next(t for t in toolkit.get_tools() if t.name == "wren_store_query")
        envelope = tool.invoke(
            {
                "nl": "top customers",
                "sql": "SELECT * FROM customers",
                "tags": ["ranking", "demo"],
            }
        )

    assert envelope["ok"] is True
    assert "Stored" in envelope["content"]
    # Use `assert_called_once_with(...)` so this test fails with a clear
    # diff if the SDK ever switches from kwargs to positional args, instead
    # of a confusing KeyError on `call_args.kwargs["tags"]`.
    fake_store.store_query.assert_called_once_with(
        nl_query="top customers",
        sql_query="SELECT * FROM customers",
        tags="ranking,demo",
    )
