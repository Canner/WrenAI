"""Tests for WrenToolkit runtime API: query, dry_plan, dry_run."""

import base64
import json
from unittest.mock import MagicMock, patch

import pyarrow as pa

from wren_pydantic import WrenToolkit


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
        "wren_pydantic._toolkit.WrenEngine", return_value=fake_engine
    ) as engine_ctor:
        result = toolkit.query("SELECT 1", limit=10)

    assert result is fake_table
    fake_engine.query.assert_called_once_with("SELECT 1", limit=10)
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

    with patch("wren_pydantic._toolkit.WrenEngine", side_effect=make_engine):
        toolkit.query("SELECT 1")
        toolkit.query("SELECT 2")

    # Engine 1 keeps its connector; engine 2's initial connector got
    # overwritten with the cached one from engine 1 before query() ran.
    assert engines[0]._connector is first_connector
    assert engines[1]._connector is first_connector
    assert engines[1]._connector is not second_initial_connector


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
        "wren_pydantic._toolkit.WrenEngine", return_value=fake_engine
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

    with patch("wren_pydantic._toolkit.WrenEngine", return_value=fake_engine):
        result = toolkit.dry_plan("SELECT * FROM orders")

    assert result == "SELECT * FROM cte_orders"
    fake_engine.dry_plan.assert_called_once_with("SELECT * FROM orders")


def test_dry_run_delegates_to_engine(tmp_project, fake_active_profile):
    fake_engine = MagicMock(name="engine")
    fake_engine._connector = MagicMock()

    toolkit = WrenToolkit.from_project(tmp_project)

    with patch("wren_pydantic._toolkit.WrenEngine", return_value=fake_engine):
        toolkit.dry_run("SELECT 1")

    fake_engine.dry_run.assert_called_once_with("SELECT 1")
