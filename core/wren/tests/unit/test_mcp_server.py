"""MCP handler tests for project context, capability gating, and query limits."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

import pytest

pytest.importorskip("mcp")

import pyarrow as pa  # noqa: E402

from wren.mcp_server import ServeContext, _workflow_text, build_server  # noqa: E402

pytestmark = pytest.mark.unit

V5_GOLDEN = Path(__file__).resolve().parents[4] / "examples" / "v5-jaffle"


def _get_tool(mcp, name: str):
    """Return a registered tool implementation for handler-level tests.

    FastMCP registry access is isolated here so the tests can call synchronous
    handlers without exercising transport serialization.
    """
    return mcp._tool_manager._tools[name].fn


def _make_ctx(tmp_path: Path, **overrides) -> ServeContext:
    defaults = dict(
        project=tmp_path,
        engine=Mock(),
        allow_write=False,
        no_connect=False,
    )
    defaults.update(overrides)
    return ServeContext(**defaults)


# ── Memory handlers use ServeContext.project ────────────────────────────────


def test_recall_queries_uses_ctx_project(tmp_path, monkeypatch):
    proj_a = tmp_path / "projA"
    proj_b = tmp_path / "projB"
    proj_a.mkdir()
    proj_b.mkdir()
    monkeypatch.chdir(proj_a)

    ctx = _make_ctx(proj_b)
    mcp = build_server(ctx)
    recall_queries = _get_tool(mcp, "recall_queries")

    captured = {}

    def fake_get_index(project, mem_path):
        captured["project"] = project
        captured["mem_path"] = mem_path
        return Mock(search=lambda question, limit: [])

    monkeypatch.setattr("wren.memory.index_backend.get_index", fake_get_index)

    recall_queries(question="revenue")

    assert captured["project"] == proj_b
    assert captured["mem_path"] == str(proj_b / ".wren" / "memory")
    assert captured["mem_path"] != str(proj_a / ".wren" / "memory")


def test_get_context_uses_ctx_project(tmp_path, monkeypatch):
    proj_a = tmp_path / "projA"
    proj_b = tmp_path / "projB"
    proj_a.mkdir()
    proj_b.mkdir()
    monkeypatch.chdir(proj_a)

    ctx = _make_ctx(proj_b)
    mcp = build_server(ctx)
    get_context = _get_tool(mcp, "get_context")

    monkeypatch.setattr("wren.context.build_json", lambda project: {})

    captured = {}

    class FakeStore:
        def __init__(self, path):
            captured["path"] = path

        def get_context(self, manifest, question, **kwargs):
            return {"strategy": "fake"}

    monkeypatch.setattr("wren.memory.store.MemoryStore", FakeStore)

    get_context(question="revenue")

    assert captured["path"] == str(proj_b / ".wren" / "memory")
    assert captured["path"] != str(proj_a / ".wren" / "memory")


def test_list_stored_queries_uses_ctx_project(tmp_path, monkeypatch):
    proj_a = tmp_path / "projA"
    proj_b = tmp_path / "projB"
    proj_a.mkdir()
    proj_b.mkdir()
    monkeypatch.chdir(proj_a)

    ctx = _make_ctx(proj_b)
    mcp = build_server(ctx)
    list_stored_queries = _get_tool(mcp, "list_stored_queries")

    captured = {}

    class FakeStore:
        def __init__(self, path):
            captured["path"] = path

        def list_queries(self, **kwargs):
            return [], 0

    monkeypatch.setattr("wren.memory.store.MemoryStore", FakeStore)

    list_stored_queries()

    assert captured["path"] == str(proj_b / ".wren" / "memory")
    assert captured["path"] != str(proj_a / ".wren" / "memory")


def test_list_stored_queries_fallback_applies_default_cap(tmp_path, monkeypatch):
    """The markdown fallback must apply the same default cap as the LanceDB path.

    ``store.list_queries`` is called with ``limit=MAX_ROW_LIMIT`` when the caller
    omits ``limit``; the fallback (taken on *any* MemoryStore error, not just a
    missing extra) must not return the whole corpus uncapped.
    """
    import wren.mcp_server as mcp_mod

    ctx = _make_ctx(tmp_path)
    mcp = build_server(ctx)
    list_stored_queries = _get_tool(mcp, "list_stored_queries")

    class BrokenStore:
        def __init__(self, path):
            raise RuntimeError("memory extra unavailable")

    monkeypatch.setattr("wren.memory.store.MemoryStore", BrokenStore)
    monkeypatch.setattr(mcp_mod, "MAX_ROW_LIMIT", 3)
    monkeypatch.setattr(
        "wren.memory.markdown.load_query_pairs",
        lambda project: [{"nl": f"q{i}", "sql": f"SELECT {i}"} for i in range(10)],
    )

    result = list_stored_queries()

    assert len(result["queries"]) == 3


def test_list_stored_queries_fallback_honours_explicit_limit(tmp_path, monkeypatch):
    """Reverse anchor: an explicit limit below the cap must still win.

    Guards against "fix" that hard-caps the fallback at MAX_ROW_LIMIT and
    ignores the caller's smaller limit.
    """
    import wren.mcp_server as mcp_mod

    ctx = _make_ctx(tmp_path)
    mcp = build_server(ctx)
    list_stored_queries = _get_tool(mcp, "list_stored_queries")

    class BrokenStore:
        def __init__(self, path):
            raise RuntimeError("memory extra unavailable")

    monkeypatch.setattr("wren.memory.store.MemoryStore", BrokenStore)
    monkeypatch.setattr(mcp_mod, "MAX_ROW_LIMIT", 3)
    monkeypatch.setattr(
        "wren.memory.markdown.load_query_pairs",
        lambda project: [{"nl": f"q{i}", "sql": f"SELECT {i}"} for i in range(10)],
    )

    assert len(list_stored_queries(limit=2)["queries"]) == 2


def test_store_query_uses_ctx_project(tmp_path, monkeypatch):
    proj_a = tmp_path / "projA"
    proj_b = tmp_path / "projB"
    proj_a.mkdir()
    proj_b.mkdir()
    monkeypatch.chdir(proj_a)

    ctx = _make_ctx(proj_b, allow_write=True)
    mcp = build_server(ctx)
    store_query = _get_tool(mcp, "store_query")

    captured = {}

    class FakeStore:
        def __init__(self, path):
            captured["path"] = path

        def store_query(self, *args, **kwargs):
            return None

    monkeypatch.setattr("wren.memory.store.MemoryStore", FakeStore)

    store_query(nl_query="revenue", sql_query="SELECT 1")

    assert captured["path"] == str(proj_b / ".wren" / "memory")
    assert captured["path"] != str(proj_a / ".wren" / "memory")


# ── Workflow prompt reflects registered tools ───────────────────────────────


def test_workflow_text_connected_writable_mentions_query_and_write_tools(tmp_path):
    ctx = _make_ctx(tmp_path, allow_write=True, no_connect=False)
    text = _workflow_text(ctx)
    assert "run_sql" in text
    assert "query_cube" in text
    assert "store_query" in text


def test_workflow_text_no_connect_omits_connect_tools(tmp_path):
    ctx = _make_ctx(tmp_path, allow_write=True, no_connect=True)
    text = _workflow_text(ctx)
    assert "run_sql" not in text
    assert "dry_run" not in text
    assert "query_cube" not in text
    assert "dry_plan" in text


def test_workflow_text_no_write_omits_store_query(tmp_path):
    ctx = _make_ctx(tmp_path, allow_write=False, no_connect=False)
    text = _workflow_text(ctx)
    assert "store_query" not in text


# ── Query limits reject invalid values ──────────────────────────────────────


def test_run_sql_negative_limit_rejected(tmp_path):
    engine = Mock()
    engine.query.return_value = pa.table({"value": []})
    ctx = _make_ctx(tmp_path, engine=engine)
    mcp = build_server(ctx)
    run_sql = _get_tool(mcp, "run_sql")

    with pytest.raises(ValueError, match="non-negative"):
        run_sql(sql="SELECT 1", limit=-1)

    engine.query.assert_not_called()


# ── Cube queries embed truncation probes in generated SQL ──────────────────
#
# The generated SQL owns the row cap, and the connector receives `limit=None`.
# This preserves generated LIMIT/OFFSET ordering and bounds connectors that
# materialize results before slicing.


def test_query_cube_sql_only_uses_user_limit():
    """SQL-only output uses the user-requested limit."""
    ctx = _make_ctx(V5_GOLDEN, engine=Mock())
    mcp = build_server(ctx)
    query_cube = _get_tool(mcp, "query_cube")

    result = query_cube(
        cube="order_metrics",
        measures=["total_revenue", "order_count"],
        dimensions=["customer_id"],
        limit=5,
        sql_only=True,
    )

    sql = result["sql"].upper()
    assert "LIMIT 5" in sql
    assert "LIMIT 6" not in sql


def test_query_cube_offset_forwarded_in_sql_only():
    """Offset must survive into the displayed SQL alongside the user's limit."""
    ctx = _make_ctx(V5_GOLDEN, engine=Mock())
    mcp = build_server(ctx)
    query_cube = _get_tool(mcp, "query_cube")

    result = query_cube(
        cube="order_metrics",
        measures=["total_revenue"],
        dimensions=["customer_id"],
        limit=5,
        offset=10,
        sql_only=True,
    )

    assert "OFFSET 10" in result["sql"].upper()


def test_query_cube_execution_bakes_probe_into_sql_not_connector():
    """Execution embeds N+1 in cube SQL and disables connector limiting."""
    engine = Mock()
    seen = {}

    def fake_query(sql, limit):
        seen["sql"] = sql
        seen["limit"] = limit
        return pa.table({"customer_id": list(range(3))})

    engine.query = fake_query

    ctx = _make_ctx(V5_GOLDEN, engine=engine)
    mcp = build_server(ctx)
    query_cube = _get_tool(mcp, "query_cube")

    query_cube(
        cube="order_metrics",
        measures=["total_revenue"],
        dimensions=["customer_id"],
        limit=3,
        offset=10,
    )

    # The generated SQL owns the probe limit, so the connector receives None.
    assert seen["limit"] is None
    sql = seen["sql"].upper()
    assert sql.count("LIMIT") == 1, f"expected exactly one LIMIT clause: {sql}"
    assert "LIMIT 4" in sql  # effective_limit(3) + 1
    assert "OFFSET 10" in sql


def test_query_cube_truncation_probe_detects_truncation():
    """An N+1 result is truncated and sliced to the requested size."""
    engine = Mock()

    def fake_query(sql, limit):
        assert limit is None
        assert "LIMIT 4" in sql.upper()  # effective_limit(3) + 1
        # Return the probe row alongside the requested rows.
        return pa.table({"customer_id": list(range(4))})

    engine.query = fake_query

    ctx = _make_ctx(V5_GOLDEN, engine=engine)
    mcp = build_server(ctx)
    query_cube = _get_tool(mcp, "query_cube")

    result = query_cube(
        cube="order_metrics",
        measures=["total_revenue", "order_count"],
        dimensions=["customer_id"],
        limit=3,
    )

    assert result["truncated"] is True
    assert result["row_count"] == 3


def test_query_cube_not_truncated_when_rows_fit():
    """When the cube yields exactly `limit` rows (no n+1 overflow), the
    result must not be marked truncated."""
    engine = Mock()

    def fake_query(sql, limit):
        assert limit is None
        return pa.table({"customer_id": list(range(3))})

    engine.query = fake_query

    ctx = _make_ctx(V5_GOLDEN, engine=engine)
    mcp = build_server(ctx)
    query_cube = _get_tool(mcp, "query_cube")

    result = query_cube(
        cube="order_metrics",
        measures=["total_revenue", "order_count"],
        dimensions=["customer_id"],
        limit=3,
    )

    assert result["truncated"] is False
    assert result["row_count"] == 3


def test_query_cube_negative_limit_rejected_consistently():
    """Execution and SQL-only reject negative limits before SQL generation."""
    engine = Mock()
    engine.query = lambda sql, limit: pa.table({"customer_id": []})

    ctx = _make_ctx(V5_GOLDEN, engine=engine)
    mcp = build_server(ctx)
    query_cube = _get_tool(mcp, "query_cube")

    with pytest.raises(ValueError, match="non-negative"):
        query_cube(
            cube="order_metrics",
            measures=["total_revenue"],
            dimensions=["customer_id"],
            limit=-1,
        )

    with pytest.raises(ValueError, match="non-negative"):
        query_cube(
            cube="order_metrics",
            measures=["total_revenue"],
            dimensions=["customer_id"],
            limit=-1,
            sql_only=True,
        )
