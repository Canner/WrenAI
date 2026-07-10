"""Unit tests for WrenToolkit.toolset() — the Pydantic AI adapter facade."""

from __future__ import annotations

import inspect

from pydantic_ai import FunctionToolset

from wren_pydantic import WrenToolkit


def _registered_names(toolset: FunctionToolset) -> list[str]:
    tools = getattr(toolset, "tools", None) or getattr(toolset, "_tools", None)
    if isinstance(tools, dict):
        return list(tools.keys())
    return [getattr(t, "name", None) for t in tools]


def _get_tool(toolset: FunctionToolset, name: str):
    tools = getattr(toolset, "tools", None) or getattr(toolset, "_tools", None)
    if isinstance(tools, dict):
        entry = tools[name]
    else:
        entry = next(t for t in tools if getattr(t, "name", None) == name)
    return getattr(entry, "function", entry)


def test_toolset_returns_three_runtime_tools_when_memory_disabled(
    tmp_project, fake_active_profile
):
    toolkit = WrenToolkit.from_project(tmp_project)
    ts = toolkit.toolset()

    names = _registered_names(ts)
    assert sorted(names) == ["wren_dry_plan", "wren_list_models", "wren_query"]


def test_toolset_takes_ctx_false_omits_ctx_param(tmp_project, fake_active_profile):
    toolkit = WrenToolkit.from_project(tmp_project)
    ts = toolkit.toolset(takes_ctx=False)
    fn = _get_tool(ts, "wren_query")

    params = list(inspect.signature(fn).parameters)
    assert "ctx" not in params


def test_toolset_takes_ctx_true_adds_ctx_first_param(tmp_project, fake_active_profile):
    toolkit = WrenToolkit.from_project(tmp_project)
    ts = toolkit.toolset(takes_ctx=True)
    fn = _get_tool(ts, "wren_query")

    params = list(inspect.signature(fn).parameters)
    assert params[0] == "ctx"


def test_toolset_returns_fresh_instance_each_call(tmp_project, fake_active_profile):
    """Each call builds a fresh FunctionToolset — toolkit state is captured
    in tool closures, so multiple toolsets can coexist with different
    takes_ctx settings."""
    toolkit = WrenToolkit.from_project(tmp_project)
    a = toolkit.toolset(takes_ctx=False)
    b = toolkit.toolset(takes_ctx=True)
    assert a is not b


def test_toolset_includes_memory_tools_when_memory_dir_exists(
    tmp_project, fake_active_profile
):
    """When .wren/memory/ exists, the toolset gains the 3 memory tools."""
    (tmp_project / ".wren" / "memory").mkdir(parents=True)

    toolkit = WrenToolkit.from_project(tmp_project)
    ts = toolkit.toolset()

    names = _registered_names(ts)
    assert sorted(names) == [
        "wren_dry_plan",
        "wren_fetch_context",
        "wren_list_models",
        "wren_query",
        "wren_recall_queries",
        "wren_store_query",
    ]


def test_toolset_drops_store_query_when_include_memory_write_false(
    tmp_project, fake_active_profile
):
    (tmp_project / ".wren" / "memory").mkdir(parents=True)

    toolkit = WrenToolkit.from_project(tmp_project)
    ts = toolkit.toolset(include_memory_write=False)

    names = _registered_names(ts)
    assert "wren_store_query" not in names
    assert "wren_fetch_context" in names
    assert "wren_recall_queries" in names
    # 5 tools total (3 runtime + 2 read-only memory)
    assert len(names) == 5


def test_toolset_include_memory_write_ignored_when_memory_disabled(
    tmp_project, fake_active_profile
):
    """When memory is disabled, include_memory_write has no effect —
    still only the 3 runtime tools."""
    toolkit = WrenToolkit.from_project(tmp_project)  # no .wren/memory
    ts_default = toolkit.toolset(include_memory_write=True)
    ts_no_write = toolkit.toolset(include_memory_write=False)

    assert sorted(_registered_names(ts_default)) == [
        "wren_dry_plan",
        "wren_list_models",
        "wren_query",
    ]
    assert sorted(_registered_names(ts_no_write)) == [
        "wren_dry_plan",
        "wren_list_models",
        "wren_query",
    ]
