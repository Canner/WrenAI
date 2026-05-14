"""Unit tests for the 3 runtime tools (wren_query, wren_dry_plan, wren_list_models).

Tests run against a mocked toolkit — the toolkit's direct API is unit-tested
in test_toolkit_runtime.py. Here we verify the tool wrappers:
- Registration shape under FunctionToolset
- Successful return: typed Pydantic models match the tool's annotated return
- Error path: WrenError → ModelRetry mapping fires
- Propagate-class WrenError re-raises instead of becoming ModelRetry
- `limit` clamping for wren_query
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pyarrow as pa
import pytest
from pydantic_ai import ModelRetry
from wren.model.error import ErrorCode, ErrorPhase, WrenError

from wren_pydantic._models import ModelSummary, WrenQueryResult
from wren_pydantic._tools import MAX_QUERY_ROWS, build_runtime_toolset


def _mock_toolkit(*, manifest=None, query_table=None, dry_plan_sql="EXPANDED SQL"):
    """Build a MagicMock that quacks like a WrenToolkit for tool tests."""
    tk = MagicMock(name="WrenToolkit")
    tk._mdl_source.load_manifest.return_value = manifest or {
        "models": [
            {"name": "orders", "columns": [{"name": "id"}, {"name": "total"}]},
        ]
    }
    tk.query.return_value = query_table or pa.table({"id": [1, 2], "name": ["a", "b"]})
    tk.dry_plan.return_value = dry_plan_sql
    return tk


def _get_tool(toolset, name: str):
    """Pull a tool function from the toolset by registered name. The exact
    accessor depends on Pydantic AI's internals — try the documented path
    first, fall back to introspecting the toolset's tool list."""
    # Pydantic AI's FunctionToolset stores tools internally; tests should
    # call the registered function directly. Use add-via-decorator style.
    tools_dict = getattr(toolset, "tools", None) or getattr(toolset, "_tools", None)
    if tools_dict is None:
        raise AttributeError(f"toolset has no tools attribute: {dir(toolset)}")
    # tools may be a dict {name: Tool} or list of tools — handle both
    if isinstance(tools_dict, dict):
        entry = tools_dict[name]
    else:
        entry = next(t for t in tools_dict if getattr(t, "name", None) == name)
    # The wrapped function — Pydantic AI's Tool object exposes .function
    return getattr(entry, "function", entry)


# ── Registration shape ────────────────────────────────────────────────────


def test_build_runtime_toolset_registers_three_tools():
    toolkit = _mock_toolkit()
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    tool_names = _registered_names(ts)
    assert sorted(tool_names) == ["wren_dry_plan", "wren_list_models", "wren_query"]


def _registered_names(toolset) -> list[str]:
    tools = getattr(toolset, "tools", None) or getattr(toolset, "_tools", None)
    if isinstance(tools, dict):
        return list(tools.keys())
    return [getattr(t, "name", None) for t in tools]


# ── wren_query ────────────────────────────────────────────────────────────


def test_wren_query_returns_typed_result():
    toolkit = _mock_toolkit()
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_query")

    result = fn(sql="SELECT * FROM orders", limit=100)

    assert isinstance(result, WrenQueryResult)
    assert result.columns == ["id", "name"]
    assert result.row_count == 2
    assert result.truncated is False


def test_wren_query_rejects_limit_below_one():
    toolkit = _mock_toolkit()
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_query")

    with pytest.raises(ModelRetry, match="limit"):
        fn(sql="SELECT 1", limit=0)


def test_wren_query_rejects_limit_above_max():
    toolkit = _mock_toolkit()
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_query")

    with pytest.raises(ModelRetry, match=str(MAX_QUERY_ROWS)):
        fn(sql="SELECT 1", limit=MAX_QUERY_ROWS + 1)


def test_wren_query_wraps_wren_error_as_model_retry():
    toolkit = _mock_toolkit()
    toolkit.query.side_effect = WrenError(
        error_code=ErrorCode.INVALID_SQL,
        message="syntax error near 'FORM'",
        phase=ErrorPhase.SQL_PARSING,
    )
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_query")

    with pytest.raises(ModelRetry, match="syntax error"):
        fn(sql="SELECT * FORM orders", limit=10)


def test_wren_query_propagates_infra_errors():
    """GET_CONNECTION_ERROR is in propagate set — re-raises as WrenError, not ModelRetry."""
    toolkit = _mock_toolkit()
    toolkit.query.side_effect = WrenError(
        error_code=ErrorCode.GET_CONNECTION_ERROR,
        message="cannot connect",
    )
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_query")

    with pytest.raises(WrenError, match="cannot connect"):
        fn(sql="SELECT 1", limit=10)


def test_wren_query_truncated_when_engine_returns_more_than_limit():
    """When the engine returns row_count == limit, we flag truncated=True
    because we can't tell whether there were more rows."""
    big_table = pa.table({"c": list(range(100))})
    toolkit = _mock_toolkit(query_table=big_table)
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_query")

    result = fn(sql="SELECT * FROM big", limit=100)
    assert result.truncated is True


# ── wren_dry_plan ─────────────────────────────────────────────────────────


def test_wren_dry_plan_returns_string():
    toolkit = _mock_toolkit(dry_plan_sql="WITH a AS (SELECT 1) SELECT * FROM a")
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_dry_plan")

    result = fn(sql="SELECT 1")
    assert isinstance(result, str)
    assert "WITH" in result


def test_wren_dry_plan_wraps_error_as_model_retry():
    toolkit = _mock_toolkit()
    toolkit.dry_plan.side_effect = WrenError(
        error_code=ErrorCode.INVALID_SQL,
        message="invalid statement",
        phase=ErrorPhase.SQL_PARSING,
    )
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_dry_plan")

    with pytest.raises(ModelRetry, match="invalid statement"):
        fn(sql="bogus")


# ── wren_list_models ──────────────────────────────────────────────────────


def test_wren_list_models_returns_typed_summaries():
    manifest = {
        "models": [
            {
                "name": "orders",
                "columns": [{"name": "id"}, {"name": "total"}, {"name": "user_id"}],
                "properties": {"description": "Order facts"},
            },
            {
                "name": "users",
                "columns": [{"name": "id"}, {"name": "email"}],
            },
        ]
    }
    toolkit = _mock_toolkit(manifest=manifest)
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_list_models")

    result = fn()

    assert isinstance(result, list)
    assert len(result) == 2
    assert all(isinstance(s, ModelSummary) for s in result)

    orders = next(s for s in result if s.name == "orders")
    assert orders.column_count == 3
    assert orders.description == "Order facts"

    users = next(s for s in result if s.name == "users")
    assert users.description is None


def test_wren_list_models_empty_manifest():
    toolkit = _mock_toolkit(manifest={"models": []})
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_list_models")

    result = fn()
    assert result == []


def test_wren_list_models_wraps_error_as_model_retry():
    toolkit = _mock_toolkit()
    toolkit._mdl_source.load_manifest.side_effect = WrenError(
        error_code=ErrorCode.MDL_NOT_FOUND,
        message="target/mdl.json missing",
        phase=ErrorPhase.MDL_EXTRACTION,
    )
    ts = build_runtime_toolset(toolkit, takes_ctx=False)
    fn = _get_tool(ts, "wren_list_models")

    with pytest.raises(ModelRetry, match="missing"):
        fn()


# ── takes_ctx variant ─────────────────────────────────────────────────────


def test_takes_ctx_true_registers_tools_with_ctx_param():
    """With takes_ctx=True, tool signatures expose ctx: RunContext as first arg."""
    import inspect  # noqa: PLC0415

    from pydantic_ai import RunContext  # noqa: F401, PLC0415  (type ref for clarity)

    toolkit = _mock_toolkit()
    ts = build_runtime_toolset(toolkit, takes_ctx=True)
    fn = _get_tool(ts, "wren_query")

    sig = inspect.signature(fn)
    params = list(sig.parameters)
    assert params[0] == "ctx"
