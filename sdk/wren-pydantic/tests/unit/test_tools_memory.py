"""Unit tests for the 3 memory tools.

Tests against a mocked toolkit.memory. Verifies:
- Registration: 2 or 3 tools depending on include_write
- Return-type shapes: FetchContextResult / list[RecalledPair] / str
- WrenError → ModelRetry mapping fires
- wren_store_query uses retries=0 (write failures don't retry)
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic_ai import ModelRetry
from wren.model.error import ErrorCode, ErrorPhase, WrenError

from wren_pydantic._models import FetchContextResult, RecalledPair
from wren_pydantic._tools_memory import build_memory_toolset

_UNSET = object()


def _mock_toolkit(*, fetch=_UNSET, recall=_UNSET, store_raises=None):
    tk = MagicMock(name="WrenToolkit")
    tk.memory.fetch.return_value = (
        {"strategy": "full", "schema": "schema text"} if fetch is _UNSET else fetch
    )
    tk.memory.recall.return_value = (
        [
            {
                "nl_query": "top customers",
                "sql_query": "SELECT * FROM customers",
                "tags": "",
                "_distance": 0.12,
            }
        ]
        if recall is _UNSET
        else recall
    )
    if store_raises is not None:
        tk.memory.store.side_effect = store_raises
    return tk


def _get_tool(toolset, name: str):
    tools = getattr(toolset, "tools", None) or getattr(toolset, "_tools", None)
    if isinstance(tools, dict):
        entry = tools[name]
    else:
        entry = next(t for t in tools if getattr(t, "name", None) == name)
    return getattr(entry, "function", entry)


def _registered_names(toolset) -> list[str]:
    tools = getattr(toolset, "tools", None) or getattr(toolset, "_tools", None)
    if isinstance(tools, dict):
        return list(tools.keys())
    return [getattr(t, "name", None) for t in tools]


def _entry(toolset, name: str):
    tools = getattr(toolset, "tools", None) or getattr(toolset, "_tools", None)
    if isinstance(tools, dict):
        return tools[name]
    return next(t for t in tools if getattr(t, "name", None) == name)


# ── Registration ──────────────────────────────────────────────────────────


def test_build_memory_toolset_registers_three_tools_when_include_write():
    toolkit = _mock_toolkit()
    ts = build_memory_toolset(toolkit, include_write=True, takes_ctx=False)
    assert sorted(_registered_names(ts)) == [
        "wren_fetch_context",
        "wren_recall_queries",
        "wren_store_query",
    ]


def test_build_memory_toolset_drops_store_when_include_write_false():
    toolkit = _mock_toolkit()
    ts = build_memory_toolset(toolkit, include_write=False, takes_ctx=False)
    names = _registered_names(ts)
    assert "wren_store_query" not in names
    assert sorted(names) == ["wren_fetch_context", "wren_recall_queries"]


# ── wren_fetch_context ────────────────────────────────────────────────────


def test_fetch_context_returns_typed_full_payload():
    toolkit = _mock_toolkit(fetch={"strategy": "full", "schema": "schema text"})
    ts = build_memory_toolset(toolkit, include_write=True, takes_ctx=False)
    fn = _get_tool(ts, "wren_fetch_context")

    result = fn(question="What are orders?", limit=5)
    assert isinstance(result, FetchContextResult)
    assert result.strategy == "full"
    assert result.schema_text == "schema text"


def test_fetch_context_returns_typed_search_payload():
    toolkit = _mock_toolkit(
        fetch={
            "strategy": "search",
            "results": [{"item_type": "column", "name": "loan_id"}],
        }
    )
    ts = build_memory_toolset(toolkit, include_write=True, takes_ctx=False)
    fn = _get_tool(ts, "wren_fetch_context")

    result = fn(question="loan ids")
    assert result.strategy == "search"
    assert result.results == [{"item_type": "column", "name": "loan_id"}]


def test_fetch_context_wraps_wren_error_as_model_retry():
    toolkit = _mock_toolkit()
    toolkit.memory.fetch.side_effect = WrenError(
        error_code=ErrorCode.GENERIC_USER_ERROR,
        message="memory unavailable",
        phase=ErrorPhase.METADATA_FETCHING,
    )
    ts = build_memory_toolset(toolkit, include_write=True, takes_ctx=False)
    fn = _get_tool(ts, "wren_fetch_context")

    with pytest.raises(ModelRetry, match="memory unavailable"):
        fn(question="x")


# ── wren_recall_queries ───────────────────────────────────────────────────


def test_recall_returns_typed_pair_list():
    toolkit = _mock_toolkit(
        recall=[
            {
                "nl_query": "top customers",
                "sql_query": "SELECT * FROM customers",
                "tags": "revenue,ranking",
                "_distance": 0.18,
            }
        ]
    )
    ts = build_memory_toolset(toolkit, include_write=True, takes_ctx=False)
    fn = _get_tool(ts, "wren_recall_queries")

    result = fn(question="top customers", limit=3)
    assert isinstance(result, list)
    assert len(result) == 1
    assert isinstance(result[0], RecalledPair)
    assert result[0].nl_query == "top customers"
    assert result[0].tags == "revenue,ranking"


def test_recall_empty_returns_empty_list():
    toolkit = _mock_toolkit(recall=[])
    ts = build_memory_toolset(toolkit, include_write=True, takes_ctx=False)
    fn = _get_tool(ts, "wren_recall_queries")
    assert fn(question="nothing matches") == []


# ── wren_store_query ──────────────────────────────────────────────────────


def test_store_returns_success_string():
    toolkit = _mock_toolkit()
    ts = build_memory_toolset(toolkit, include_write=True, takes_ctx=False)
    fn = _get_tool(ts, "wren_store_query")

    result = fn(nl="top customers", sql="SELECT * FROM customers", tags=["revenue"])
    assert isinstance(result, str)
    assert "stored" in result.lower() or "saved" in result.lower()


def test_store_handles_none_tags_as_empty():
    toolkit = _mock_toolkit()
    ts = build_memory_toolset(toolkit, include_write=True, takes_ctx=False)
    fn = _get_tool(ts, "wren_store_query")
    fn(nl="x", sql="SELECT 1", tags=None)
    # toolkit.memory.store called with tags=[]
    call_kwargs = toolkit.memory.store.call_args.kwargs
    assert call_kwargs["tags"] == []


def test_store_query_retries_zero():
    """Write failures shouldn't retry — locked via tool registration."""
    toolkit = _mock_toolkit()
    ts = build_memory_toolset(toolkit, include_write=True, takes_ctx=False)
    entry = _entry(ts, "wren_store_query")
    # The Tool object exposes max_retries (Pydantic AI's name for retries).
    # We expect 0; other tools default to 2. (Don't use `or` here — 0 is falsy.)
    assert entry.max_retries == 0


# ── takes_ctx ─────────────────────────────────────────────────────────────


def test_takes_ctx_true_injects_ctx_into_fetch_signature():
    import inspect  # noqa: PLC0415

    toolkit = _mock_toolkit()
    ts = build_memory_toolset(toolkit, include_write=True, takes_ctx=True)
    fn = _get_tool(ts, "wren_fetch_context")
    params = list(inspect.signature(fn).parameters)
    assert params[0] == "ctx"
