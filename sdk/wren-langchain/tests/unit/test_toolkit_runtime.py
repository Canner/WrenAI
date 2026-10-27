"""Tests for WrenToolkit runtime API: query, dry_plan, dry_run."""

import base64
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock
from unittest.mock import MagicMock, patch

import pyarrow as pa

from wren_langchain import WrenToolkit


def test_query_invokes_wren_engine_with_resolved_manifest(
    tmp_project, fake_active_profile
):
    """toolkit.query reads the manifest fresh and delegates to WrenEngine.query."""
    fake_table = pa.table({"x": [1, 2, 3]})
    fake_engine = MagicMock(name="WrenEngine")
    fake_engine.query.return_value = fake_table
    fake_engine._connector = MagicMock(name="connector")

    toolkit = WrenToolkit.from_project(tmp_project)

    with patch(
        "wren_langchain._toolkit.WrenEngine", return_value=fake_engine
    ) as engine_ctor:
        result = toolkit.query("SELECT 1", limit=10)

    assert result is fake_table
    fake_engine.query.assert_called_once_with("SELECT 1", limit=10, properties=None)
    # Engine constructed with manifest bytes + datasource + connection_info
    engine_ctor.assert_called_once()
    kwargs = engine_ctor.call_args.kwargs
    assert kwargs["data_source"] == "duckdb"
    assert kwargs["connection_info"] == {"path": ":memory:"}


def test_connector_is_reused_across_query_calls(tmp_project, fake_active_profile):
    """Second query reuses the cached connector instead of reconnecting.

    Distinguishes "what engine 2 starts with" from "what gets injected" by
    seeding each fresh engine with a different connector. If reuse is broken,
    engine 2's `_connector` would remain its own initial mock; if reuse works,
    it gets replaced with engine 1's connector before `query()` runs.
    """
    first_connector = MagicMock(name="first_connector")
    second_initial_connector = MagicMock(name="second_initial_connector")
    engines = []

    def make_engine(*args, **kwargs):
        engine = MagicMock(name=f"engine{len(engines)}")
        engine._connector = first_connector if not engines else second_initial_connector
        engines.append(engine)
        return engine

    toolkit = WrenToolkit.from_project(tmp_project)

    with patch("wren_langchain._toolkit.WrenEngine", side_effect=make_engine):
        toolkit.query("SELECT 1")
        toolkit.query("SELECT 2")

    # Engine 1 keeps its connector; engine 2's initial connector got
    # overwritten with the cached one from engine 1 before query() ran.
    assert engines[0]._connector is first_connector
    assert engines[1]._connector is first_connector
    assert engines[1]._connector is not second_initial_connector


def test_concurrent_cold_queries_share_one_connector(tmp_project, fake_active_profile):
    """Concurrent first calls must not create and orphan extra connectors."""
    callers = 5
    engines_ready = Barrier(callers)
    queries_ready = Barrier(2)
    created_connectors = []
    connector_lock = Lock()
    engines = []

    class FakeEngine:
        _connector = None

        def _get_connector(self):
            if self._connector is None:
                self._connector = object()
                with connector_lock:
                    created_connectors.append(self._connector)
            return self._connector

        def query(self, sql, limit=None, properties=None):
            queries_ready.wait(timeout=5)
            return self._get_connector()

        def dry_run(self, sql, properties=None):
            self._get_connector()

    def make_engine(*args, **kwargs):
        engine = FakeEngine()
        engines.append(engine)
        engines_ready.wait(timeout=5)
        return engine

    toolkit = WrenToolkit.from_project(tmp_project)
    with patch("wren_langchain._toolkit.WrenEngine", side_effect=make_engine):
        with ThreadPoolExecutor(max_workers=callers) as executor:
            results = list(
                executor.map(
                    lambda i: (
                        toolkit.query("SELECT 1")
                        if i % 2
                        else toolkit.dry_run("SELECT 1")
                    ),
                    range(callers),
                )
            )

    assert len(created_connectors) == 1
    query_results = [result for result in results if result is not None]
    assert len(query_results) == 2
    assert all(result is created_connectors[0] for result in query_results)
    assert all(engine._connector is created_connectors[0] for engine in engines)


def test_manifest_is_read_through_on_every_call(
    tmp_project, fake_active_profile, monkeypatch
):
    """Each query re-reads target/mdl.json so external CLI rebuilds are picked up."""
    fake_engine = MagicMock(name="engine")
    fake_engine._connector = MagicMock()

    toolkit = WrenToolkit.from_project(tmp_project)

    # Replace the manifest content between calls.
    mdl_path = tmp_project / "target" / "mdl.json"
    mdl_path.write_text('{"models": [{"name": "v1"}]}')

    with patch(
        "wren_langchain._toolkit.WrenEngine", return_value=fake_engine
    ) as engine_ctor:
        toolkit.query("SELECT 1")

        # Simulate `wren context build` updating the file.
        mdl_path.write_text('{"models": [{"name": "v2"}]}')
        toolkit.query("SELECT 2")

    first_manifest_b64 = engine_ctor.call_args_list[0].kwargs["manifest_str"]
    second_manifest_b64 = engine_ctor.call_args_list[1].kwargs["manifest_str"]
    first = json.loads(base64.b64decode(first_manifest_b64))
    second = json.loads(base64.b64decode(second_manifest_b64))
    assert first["models"][0]["name"] == "v1"
    assert second["models"][0]["name"] == "v2"


def test_dry_plan_delegates_to_engine(tmp_project, fake_active_profile):
    fake_engine = MagicMock(name="engine")
    fake_engine.dry_plan.return_value = "SELECT * FROM cte_orders"
    fake_engine._connector = MagicMock()

    toolkit = WrenToolkit.from_project(tmp_project)

    with patch("wren_langchain._toolkit.WrenEngine", return_value=fake_engine):
        result = toolkit.dry_plan("SELECT * FROM orders")

    assert result == "SELECT * FROM cte_orders"
    fake_engine.dry_plan.assert_called_once_with(
        "SELECT * FROM orders", properties=None
    )


def test_dry_run_delegates_to_engine(tmp_project, fake_active_profile):
    fake_engine = MagicMock(name="engine")
    fake_engine._connector = MagicMock()

    toolkit = WrenToolkit.from_project(tmp_project)

    with patch("wren_langchain._toolkit.WrenEngine", return_value=fake_engine):
        toolkit.dry_run("SELECT 1")

    fake_engine.dry_run.assert_called_once_with("SELECT 1", properties=None)


def test_query_forwards_session_properties(tmp_project, fake_active_profile):
    """Session properties reach the engine, so RLAC-protected models are readable."""
    fake_engine = MagicMock(name="engine")
    fake_engine.query.return_value = pa.table({"x": [1]})
    fake_engine._connector = MagicMock()
    properties = {"session_user_id": "'u_42'"}

    toolkit = WrenToolkit.from_project(tmp_project)

    with patch("wren_langchain._toolkit.WrenEngine", return_value=fake_engine):
        toolkit.query("SELECT * FROM orders", limit=5, properties=properties)

    fake_engine.query.assert_called_once_with(
        "SELECT * FROM orders", limit=5, properties=properties
    )


def test_dry_plan_forwards_session_properties(tmp_project, fake_active_profile):
    """dry_plan forwards properties: RLAC predicates are injected while planning."""
    fake_engine = MagicMock(name="engine")
    fake_engine.dry_plan.return_value = "SELECT 1"
    fake_engine._connector = MagicMock()
    properties = {"session_user_id": "'u_42'"}

    toolkit = WrenToolkit.from_project(tmp_project)

    with patch("wren_langchain._toolkit.WrenEngine", return_value=fake_engine):
        toolkit.dry_plan("SELECT * FROM orders", properties=properties)

    fake_engine.dry_plan.assert_called_once_with(
        "SELECT * FROM orders", properties=properties
    )


def test_dry_run_forwards_session_properties(tmp_project, fake_active_profile):
    """dry_run forwards properties so validation matches what query will run."""
    fake_engine = MagicMock(name="engine")
    fake_engine._connector = MagicMock()
    properties = {"session_user_id": "'u_42'"}

    toolkit = WrenToolkit.from_project(tmp_project)

    with patch("wren_langchain._toolkit.WrenEngine", return_value=fake_engine):
        toolkit.dry_run("SELECT * FROM orders", properties=properties)

    fake_engine.dry_run.assert_called_once_with(
        "SELECT * FROM orders", properties=properties
    )
