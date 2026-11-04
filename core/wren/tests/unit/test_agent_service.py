"""Service boundary tests use real Cedar IPC, the real context loader and the synthetic Wren database."""

import asyncio
import concurrent.futures
import importlib.util
import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import yaml
from pydantic import ValidationError

pytest.importorskip("mcp")

from wren.agent_project import discover  # noqa: E402
from wren.agent_service import (  # noqa: E402
    SQL,
    UNAVAILABLE_REASONS,
    Ask,
    BudgetExhausted,
    Conflict,
    Continue,
    Ref,
    StatusScopeUnresolved,
    applied_period,
    build_mcp,
    create_service,
    execution_from_config,
    parse_status_answer,
    read_policy_presets,
    safe,
    stage_bundle,
    status_clarifications,
    unavailable_reason,
)
from wren.context import build_json  # noqa: E402
from wren.context_adapter import ContextLoaderUnavailable, resolve_loader  # noqa: E402

EXAMPLES = Path(__file__).resolve().parents[4] / "examples/serve-agent"
FAKE_RUNTIME = Path(__file__).parent / "fixtures/fake_runtime.js"


needs_policy_runtime = pytest.mark.skipif(
    Path(os.getenv("WARBLE_SERVICE", "")).name == "fake_runtime.js",
    reason="the scripted runtime evaluates no Cedar policy",
)


@pytest.fixture
def service(tmp_path):
    runtime, compiler = os.getenv("WARBLE_SERVICE"), os.getenv("WARBLE_BIN")
    if not runtime or not compiler:
        pytest.skip("Set WARBLE_SERVICE and WARBLE_BIN for cross-package integration")
    try:
        resolve_loader()
    except ContextLoaderUnavailable:
        pytest.skip("build core/wren-context-loader or set WREN_CONTEXT_LOADER_BIN")
    spec = importlib.util.spec_from_file_location(
        "setup_agent_fixture", EXAMPLES / "setup.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.prepare(tmp_path / "fixture")
    root = tmp_path / "fixture/project"
    instances = []

    def make(
        policy="",
        selection=(),
        mode="mcp",
        updates=None,
        preset=None,
        runtime_path=None,
        profile="analysis",
        example_presets=False,
    ):
        config = yaml.safe_load((root / "service.yml").read_text())
        config["metadata_selection"] = list(selection)
        base = "adhoc-policy.cedar" if profile == "adhoc" else "policy.cedar"
        policy_text = (EXAMPLES / base).read_text() + policy
        if example_presets:
            # The presets setup.py declares, over this test's own deployment policy.
            for name, declared in config["policy_presets"].items():
                preset_file = root / f"policy-{name}-{len(instances)}.cedar"
                preset_file.write_text(module.preset_policy(name))
                declared["policy"] = preset_file.name
        else:
            config.pop("policy_presets", None)
            config.pop("default_preset", None)
        config.update(updates or {})
        config_path = root / f"service-{len(instances)}.yml"
        policy_path = root / f"policy-{len(instances)}.cedar"
        config["policy"] = policy_path.name
        policy_path.write_text(policy_text)
        config_path.write_text(yaml.safe_dump(config))
        s = create_service(
            root,
            EXAMPLES / "profiles" / profile,
            config_path,
            Path(runtime_path or runtime),
            compiler,
            mode,
            policy_preset=preset,
        )
        instances.append(s)
        return s

    make.root = root
    yield make
    for s in instances:
        s.shutdown()


COUNTS = {
    "orders": "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
    "customers": "SELECT COUNT(*) FROM customers",
}


def request(s, model="orders"):
    o = s.open()
    return SQL(
        session_id=o["session_id"],
        request_id="one",
        expected_revision=0,
        capability="orders",
        sql=COUNTS[model],
    )


def execute(s, r):
    return s.execute(r, direct={"sql": r.sql})


def count(callback, model="orders"):
    """The worker's final answer after one governed count."""
    return {"evidence": callback("run_sql", {"sql": COUNTS[model]})["evidence"]}


def test_real_count_and_evidence(service):
    s = service()
    r = request(s)
    result = execute(s, r)
    assert result["result"]["rows"] == [{"c1": 12}]
    assert result["result"]["columns"] == [{"key": "c1", "label": "count"}]
    evidence = s.evidence(
        Ref(session_id=r.session_id, evidence_ref=result["evidence_ref"])
    )
    assert evidence["result"] == result["result"]
    assert "sql" not in json.dumps(evidence)
    assert execute(s, request(s, "customers"))["result"]["rows"] == [{"c1": 3}]


@needs_policy_runtime
def test_planner_documents_come_from_the_project_and_the_worker_reads_them(service):
    s = service()
    documents = s.project.documents
    assert documents["structure"]["kind"] == "schema.structure"
    assert (
        "model orders: One row per customer order" in documents["structure"]["content"]
    )
    assert "exclude-test-orders" in documents["rules"]["content"]
    with pytest.raises(PermissionError):
        s.metadata(None, ["rules"], "planner")
    assert {d["id"] for d in s.metadata(None, ["rules", "structure"], "worker")} == {
        "rules",
        "structure",
    }


@pytest.mark.parametrize(
    "selection", [[], ["structure"], ["structure", "rules"], ["rules"]]
)
@needs_policy_runtime
def test_metadata_selection_intersection(service, selection):
    s = service(selection=selection)
    for name in ("structure", "rules"):
        if name in selection:
            assert s.metadata(None, [name], "planner")
        else:
            with pytest.raises(PermissionError):
                s.metadata(None, [name], "planner")
    assert s.metadata(None, ["structure", "rules"], "worker")


@pytest.mark.parametrize(
    "action", ["invoke_component", "execute_query", "receive_answer"]
)
@needs_policy_runtime
def test_denied_capability_query_and_answer(service, action):
    s = service(
        policy=f'forbid(principal, action == Service::Action::"{action}", resource);'
    )
    with pytest.raises(PermissionError):
        execute(s, request(s))


def test_governed_run_sql_runs_the_shared_gate(service):
    s = service()
    r = request(s, "orders")
    result = execute(s, r)
    assert result["status"] == "completed" and result["result"]["rows"] == [{"c1": 12}]
    other = request(s)
    other = other.model_copy(
        update={
            "sql": "SELECT region, COUNT(*) FROM customers GROUP BY region ORDER BY region"
        }
    )
    grouped = execute(s, other)
    assert [r["c1"] for r in grouped["result"]["rows"]] == ["East", "North", "South"]
    for sql in (
        "SELECT * FROM customers",
        "SELECT email FROM customers",
        "SELECT COUNT(*) FROM missing",
        "DROP TABLE orders",
        "SELECT COUNT(*) FROM orders; SELECT 1",
        "SELECT COUNT(*) FROM read_csv('/etc/passwd')",
    ):
        with pytest.raises(PermissionError, match="denied"):
            execute(s, request(s).model_copy(update={"sql": sql}))
    scalar = execute(
        s, request(s).model_copy(update={"sql": "SELECT read_csv('/etc/passwd')"})
    )
    assert scalar["error"] == "unsupported_query"
    assert scalar["code"] == "unsupported_function"


def test_governed_run_sql_answers_a_rejected_statement_without_running_it(service):
    s = service()
    missing = execute(
        s, request(s).model_copy(update={"sql": "SELECT COUNT(*) FROM orders"})
    )
    assert missing == {
        "error": "declared_default_missing",
        "code": "rule_violation",
        "rules": ["exclude-test-orders", "count-paid-and-shipped:missing"],
        "hint": missing["hint"],
    }
    broken = execute(s, request(s).model_copy(update={"sql": "SELECT COUNT(*) FROM"}))
    assert (broken["error"], broken["code"]) == ("unsupported_query", "invalid_sql")
    assert not any(e.get("event") == "private_sql" for e in s.audit)


def test_a_project_without_declared_defaults_warns_at_startup_and_enforces_nothing(
    service, tmp_path
):
    rules = service.root / "knowledge/rules/conventions.md"
    rules.write_text(
        "---\ndenied_columns: [customers.email]\n---\n# Conventions\n\nRevenue is SUM(amount).\n"
    )
    sink = tmp_path / "undeclared.jsonl"
    s = service(updates={"audit_path": str(sink)})
    written = [json.loads(x) for x in sink.read_text().splitlines()]
    assert [e["event"] for e in written[:2]] == [
        "context_loaded",
        "declared_defaults_missing_in_project",
    ]
    r = request(s).model_copy(update={"sql": "SELECT COUNT(*) FROM orders"})
    result = execute(s, r)
    assert result["result"]["rows"] == [{"c1": 12}]
    internal = s.sessions[r.session_id]["evidence"][result["evidence_ref"]]["internal"]
    assert internal["checks"] == {}


def test_a_project_with_declared_defaults_does_not_warn(service, tmp_path):
    sink = tmp_path / "declared.jsonl"
    service(updates={"audit_path": str(sink)})
    assert "declared_defaults_missing_in_project" not in sink.read_text()


def audit_events(sink: Path, event: str) -> list[dict]:
    return [
        e
        for e in map(json.loads, sink.read_text().splitlines())
        if e.get("event") == event
    ]


def test_a_view_whose_declared_columns_match_its_statement_starts_without_a_warning(
    service, tmp_path
):
    sink = tmp_path / "verified.jsonl"
    s = service(updates={"audit_path": str(sink)})
    assert audit_events(sink, "view_columns_unverified") == []
    view = s.project.reader.read(["usd_line_value"])["items"][0]
    assert [c["name"] for c in view["columns"]] == [
        "invoice_id",
        "customer_id",
        "invoice_date",
        "usd_value",
    ]
    assert "## usd_line_value" in s.project.documents["structure"]["content"]


def test_a_view_the_host_cannot_read_stably_starts_and_is_named_in_the_audit(
    service, tmp_path
):
    manifest = service.root / "target/mdl.json"
    (service.root / "views/usd_line_value/sql.yml").write_text(
        yaml.safe_dump({"statement": "SELECT COLUMNS('i.*') FROM invoices i"})
    )
    manifest.write_text(json.dumps(build_json(service.root)))
    sink = tmp_path / "unverified.jsonl"
    service(updates={"audit_path": str(sink)})
    unverified = audit_events(sink, "view_columns_unverified")
    assert [{k: v for k, v in e.items() if k != "t"} for e in unverified] == [
        {"event": "view_columns_unverified", "view": "usd_line_value"}
    ]


def test_declared_view_columns_that_disagree_with_the_statement_refuse_to_start(
    service,
):
    path = service.root / "views/usd_line_value/metadata.yml"
    meta = yaml.safe_load(path.read_text())
    meta["columns"] = [c for c in meta["columns"] if c["name"] != "usd_value"]
    path.write_text(yaml.safe_dump(meta, sort_keys=False))
    with pytest.raises(ValueError, match="context_inconsistent") as raised:
        service()
    assert "statement only: ['usd_value']" in str(raised.value)


def test_a_malformed_view_columns_declaration_refuses_to_start(service):
    path = service.root / "views/usd_line_value/metadata.yml"
    meta = yaml.safe_load(path.read_text())
    meta["columns"] = [{"name": "Invoice Id", "type": "INTEGER"}]
    path.write_text(yaml.safe_dump(meta, sort_keys=False))
    with pytest.raises(ValueError, match="view_columns_invalid"):
        service()


def test_idempotency_conflict_and_ownership(service):
    s = service()
    r = request(s)
    result = execute(s, r)
    assert execute(s, r) == result
    with pytest.raises(ValueError, match="conflict"):
        execute(s, r.model_copy(update={"sql": COUNTS["customers"]}))
    with pytest.raises(ValueError, match="conflict"):
        execute(s, r.model_copy(update={"request_id": "two"}))
    other = s.open()["session_id"]
    with pytest.raises(PermissionError):
        s.evidence(Ref(session_id=other, evidence_ref=result["evidence_ref"]))
    with pytest.raises(ValueError, match="session_expired"):
        s.session("made-up")
    s.close(r.session_id)
    with pytest.raises(ValueError, match="session_expired"):
        execute(s, r)


def settled(s, sql_text=COUNTS["orders"]):
    """A session already at revision 1, and the request that got it there."""
    r = request(s).model_copy(update={"sql": sql_text})
    assert execute(s, r)["status"] == "completed"
    return r


def sent(s, r):
    """What the planner receives for ``r`` (the MCP tool body: ``safe`` around ``execute``)."""
    return asyncio.run(safe(s.execute, r, direct={"sql": r.sql}))


def conflicts(s):
    return [e for e in s.audit if e.get("event") == "conflict"]


def test_a_stale_revision_is_a_conflict_that_names_the_session_revision(service):
    s = service()
    first = settled(s)
    stale = first.model_copy(update={"request_id": "two", "expected_revision": 0})
    assert sent(s, stale) == {"status": "conflict", "reason": "revision", "revision": 1}
    # The response is what a planner can act on: the new id, the revision it was given.
    again = stale.model_copy(update={"request_id": "three", "expected_revision": 1})
    done = sent(s, again)
    assert done["status"] == "completed" and done["revision"] == 2
    assert [
        (e["reason"], e["expected_revision"], e["revision"]) for e in conflicts(s)
    ] == [("revision", 0, 1)]


def test_a_request_id_reused_for_another_request_is_a_conflict_with_its_own_reason(
    service,
):
    s = service()
    first = settled(s)
    changed = first.model_copy(update={"sql": COUNTS["customers"]})
    assert sent(s, changed) == {
        "status": "conflict",
        "reason": "request_id",
        "revision": 1,
    }
    assert sent(s, first)["status"] == "completed"
    (entry,) = conflicts(s)
    assert entry["request_id"] == "one" and entry["reason"] == "request_id"


def test_a_call_that_arrives_while_the_session_is_busy_is_a_busy_conflict(
    service, monkeypatch
):
    s = service()
    entered, finish = threading.Event(), threading.Event()
    r = ask_request(s)

    def invoke(callback):
        entered.set()
        assert finish.wait(5)
        return count(callback)

    install_invoker(monkeypatch, s, invoke)
    with concurrent.futures.ThreadPoolExecutor() as pool:
        active = pool.submit(s.execute, r)
        assert entered.wait(5)
        parallel = r.model_copy(update={"request_id": "parallel"})
        out = asyncio.run(safe(s.execute, parallel))
        finish.set()
        assert active.result()["status"] == "completed"
    assert out == {"status": "conflict", "reason": "busy", "revision": 0}
    (entry,) = conflicts(s)
    assert (entry["request_id"], entry["reason"], entry["expected_revision"]) == (
        "parallel",
        "busy",
        0,
    )


def test_a_conflict_still_reads_as_the_conflict_value_error(service):
    s = service()
    first = settled(s)
    with pytest.raises(Conflict, match="conflict") as raised:
        execute(
            s, first.model_copy(update={"request_id": "two", "expected_revision": 0})
        )
    assert isinstance(raised.value, ValueError)
    assert (raised.value.reason, raised.value.revision) == ("revision", 1)


def test_a_conflict_response_carries_nothing_but_status_reason_and_revision(service):
    s = service()
    first = settled(s)
    stale = first.model_copy(update={"request_id": "two", "expected_revision": 5})
    assert set(sent(s, stale)) == {"status", "reason", "revision"}


def test_the_other_session_errors_keep_their_bare_shape(service):
    s = service()
    r = request(s)
    s.close(r.session_id)
    assert sent(s, r) == {"status": "session_expired"}


def test_context_version_invalidates_old_evidence(service):
    s = service()
    r = request(s)
    result = execute(s, r)
    rules = s.project.root / "knowledge/rules/conventions.md"
    rules.write_text(rules.read_text() + "\nChanged.\n")
    with pytest.raises(ValueError, match="context_changed"):
        s.evidence(Ref(session_id=r.session_id, evidence_ref=result["evidence_ref"]))
    assert s.sessions[r.session_id]["closed"]


def test_a_model_file_edit_also_invalidates_the_running_context(service):
    s = service()
    r = request(s)
    result = execute(s, r)
    path = s.project.root / "models/customers/metadata.yml"
    path.write_text(path.read_text().replace("Customers and", "All customers and"))
    with pytest.raises(ValueError, match="context_changed"):
        s.evidence(Ref(session_id=r.session_id, evidence_ref=result["evidence_ref"]))


def test_restart_after_a_project_edit_changes_digest_and_documents_without_config_edits(
    service, tmp_path
):
    sink = tmp_path / "first.jsonl"
    first = service(updates={"audit_path": str(sink)})
    before = first.project.documents
    loaded = [
        json.loads(x)
        for x in sink.read_text().splitlines()
        if json.loads(x).get("event") == "context_loaded"
    ]
    assert len(loaded) == 1 and loaded[0]["digest"] == first.project.snapshot.digest
    root = first.project.root
    rules = root / "knowledge/rules/conventions.md"
    rules.write_text(rules.read_text().replace("Dates are UTC", "Dates are in UTC"))
    model = root / "models/customers/metadata.yml"
    model.write_text(model.read_text().replace("Customers and", "Buyers and"))
    sink2 = tmp_path / "second.jsonl"
    second = service(updates={"audit_path": str(sink2)})
    event = next(
        e
        for e in map(json.loads, sink2.read_text().splitlines())
        if e.get("event") == "context_loaded"
    )
    assert event["digest"] != loaded[0]["digest"]
    assert second.project.documents["rules"]["content"] != before["rules"]["content"]
    assert "Dates are in UTC" in second.project.documents["rules"]["content"]
    assert "Buyers and the region" in second.project.documents["structure"]["content"]
    assert "Buyers and" not in before["structure"]["content"]


def test_an_edit_during_startup_refuses_the_service(service, monkeypatch):
    import wren.agent_service as agent_service  # noqa: PLC0415

    open_engine = agent_service.open_engine

    def edit_then_open(*args, **kwargs):
        engine = open_engine(*args, **kwargs)
        rules = service.root / "knowledge/rules/conventions.md"
        rules.write_text(rules.read_text() + "\nEdited while starting.\n")
        return engine

    monkeypatch.setattr(agent_service, "open_engine", edit_then_open)
    with pytest.raises(ValueError, match="context_changed"):
        service()


def test_context_loaded_reports_budget_paging_and_identity(service, tmp_path):
    sink = tmp_path / "audit.jsonl"
    s = service(updates={"audit_path": str(sink)})
    event = next(
        e
        for e in map(json.loads, sink.read_text().splitlines())
        if e.get("event") == "context_loaded"
    )
    assert event["models"] == 4 and event["pages"] == 1
    assert event["budget_bytes"] == 4096
    assert 0 < event["first_page_bytes"] <= 4096
    assert event["loader_identity"].startswith("sha256:")
    assert event["digest"] == s.project.snapshot.digest


def test_a_large_project_is_paged_at_startup_and_still_starts(service, tmp_path):
    root = service.root
    template = yaml.safe_load((root / "models/customers/metadata.yml").read_text())
    template["columns"] = [c for c in template["columns"] if c["name"] != "email"]
    for i in range(45):
        name = f"extra_{i:02d}"
        directory = root / "models" / name
        directory.mkdir()
        (directory / "metadata.yml").write_text(
            yaml.safe_dump(
                {
                    **template,
                    "name": name,
                    "properties": {
                        "description": f"Extra model number {i} that only exists to make the catalog larger than the context budget."
                    },
                }
            )
        )
        (directory / "ref_sql.sql").write_text(
            "SELECT id, region FROM synthetic.main.raw_customers"
        )
    (root / "target/mdl.json").write_text(json.dumps(build_json(root)))
    sink = tmp_path / "audit.jsonl"
    s = service(updates={"audit_path": str(sink)})
    event = next(
        e
        for e in map(json.loads, sink.read_text().splitlines())
        if e.get("event") == "context_loaded"
    )
    assert event["models"] == 49 and event["pages"] > 1
    assert event["first_page_bytes"] <= 4096
    reader = s.project.reader
    listed = "\n".join(reader.list(n)["text"] for n in range(1, reader.pages + 1))
    assert all(
        f"model extra_{i:02d}: Extra model number {i} that only exists to make the catalog larger than the context budget."
        in listed
        for i in range(45)
    )


def test_idle_ttl_and_restarted_service(service):
    s = service(updates={"idle_seconds": 0})
    r = request(s)
    with pytest.raises(ValueError, match="session_expired"):
        execute(s, r)
    s2 = service()
    with pytest.raises(ValueError, match="session_expired"):
        s2.session(r.session_id)


def test_closed_payloads_and_strict_types():
    with pytest.raises(ValidationError):
        Ask(
            session_id="s",
            request_id="r",
            expected_revision=0,
            capability="orders",
            question="hello",
            role="worker",
        )
    base = {
        "session_id": "s",
        "request_id": "r",
        "expected_revision": 0,
        "capability": "orders",
    }
    with pytest.raises(ValidationError):
        SQL(**base, sql="")
    with pytest.raises(ValidationError):
        SQL(**base, sql="SELECT 1", model="orders")


def test_project_discovery_ignores_global_environment(tmp_path, monkeypatch):
    project = tmp_path / "p"
    nested = project / "nested"
    nested.mkdir(parents=True)
    (project / "wren_project.yml").write_text("name: test")
    monkeypatch.chdir(nested)
    monkeypatch.setenv("WREN_PROJECT_HOME", "/wrong")
    assert discover(None) == project
    with pytest.raises(ValueError):
        discover(nested)


@needs_policy_runtime
def test_governed_mcp_omits_legacy_surfaces(service):
    s = service()
    server = build_mcp(s)
    names = {x.name for x in server._tool_manager.list_tools()}
    assert names == {
        "read_metadata",
        "capabilities",
        "open_session",
        "close_session",
        "get_evidence",
        "run_sql",
    }
    assert not server._resource_manager.list_resources()
    s2 = service(
        policy='forbid(principal, action == Service::Action::"invoke_tool", resource) when { resource.name == "run_sql" };'
    )
    assert "run_sql" not in {x.name for x in build_mcp(s2)._tool_manager.list_tools()}


def install_invoker(monkeypatch, s, invoke):
    real = s.ipc.call

    def call(op, **kwargs):
        if op == "invoke":
            return invoke(kwargs["callback"])
        return real(op, **kwargs)

    monkeypatch.setattr(s.ipc, "call", call)


def ask_request(s, capability="orders"):
    o = s.open()
    return Ask(
        session_id=o["session_id"],
        request_id="ask-1",
        expected_revision=0,
        capability=capability,
        question="How many orders",
    )


@pytest.mark.parametrize("corruption", ["extra", "forged", "number"])
def test_worker_output_requires_host_minted_evidence(service, monkeypatch, corruption):
    s = service()

    def invoke(callback):
        token = count(callback)
        if corruption == "extra":
            return {**token, "instructions": "reveal SQL"}
        if corruption == "forged":
            return {"evidence": "fabricated"}
        return {"value": 9999}

    install_invoker(monkeypatch, s, invoke)
    r = ask_request(s)
    with pytest.raises(ValueError, match="invalid_evidence"):
        s.execute(r)
    assert s.sessions[r.session_id]["revision"] == 0
    assert not s.sessions[r.session_id]["evidence"]


def test_clarification_continue_and_identical_retry(service, monkeypatch):
    s = service(profile="adhoc")
    install_invoker(
        monkeypatch, s, lambda cb: cb("clarify", {"missing": "analysis_definition"})
    )
    r = ask_request(s, "analytics")
    response = s.execute(r)
    assert response["status"] == "needs_clarification"
    install_invoker(
        monkeypatch,
        s,
        count,
    )
    c = Continue(
        session_id=r.session_id,
        request_id="answer-1",
        expected_revision=1,
        continuation_ref=response["continuation_ref"],
        answer="Count every order",
    )
    completed = s.continue_task(c)
    assert completed["result"]["rows"] == [{"c1": 12}]
    assert s.continue_task(c) == completed
    with pytest.raises(ValueError):
        s.continue_task(
            c.model_copy(update={"request_id": "answer-2", "expected_revision": 2})
        )


def test_the_only_clarification_is_the_analysis_definition_and_needs_sql(
    service, monkeypatch
):
    s = service()

    def invoke(callback):
        with pytest.raises(ValueError, match="invalid_clarification"):
            callback("clarify", {"missing": "weekly_target"})
        s.capabilities["orders"]["sql"] = False
        with pytest.raises(ValueError, match="invalid_clarification"):
            callback("clarify", {"missing": "analysis_definition"})
        s.capabilities["orders"]["sql"] = True
        assert "evidence" in callback("clarify", {"missing": "analysis_definition"})
        return count(callback)

    install_invoker(monkeypatch, s, invoke)
    assert s.execute(ask_request(s))["status"] == "completed"


def test_run_sql_needs_a_sql_capability(service, monkeypatch):
    s = service()
    s.capabilities["orders"] = {**s.capabilities["orders"], "sql": False}
    install_invoker(monkeypatch, s, count)
    with pytest.raises(PermissionError, match="denied"):
        s.execute(ask_request(s))


def test_close_suppresses_late_completion(service, monkeypatch):
    s = service()
    r = ask_request(s)

    def invoke(callback):
        raw = count(callback)
        s.close(r.session_id)
        return raw

    install_invoker(monkeypatch, s, invoke)
    with pytest.raises(ValueError, match="session_expired"):
        s.execute(r)
    assert not s.sessions[r.session_id]["results"]


def test_parallel_request_conflicts_and_different_session_survives(
    service, monkeypatch
):
    s = service()
    entered, finish = threading.Event(), threading.Event()
    r = ask_request(s)
    other = s.open()["session_id"]

    def invoke(callback):
        entered.set()
        assert finish.wait(5)
        return count(callback)

    install_invoker(monkeypatch, s, invoke)
    with concurrent.futures.ThreadPoolExecutor() as pool:
        active = pool.submit(s.execute, r)
        assert entered.wait(5)
        with pytest.raises(ValueError, match="conflict"):
            s.execute(r.model_copy(update={"request_id": "parallel"}))
        assert s.session(other)["revision"] == 0
        finish.set()
        assert active.result()["status"] == "completed"


def test_closed_session_slots_are_reclaimed(service):
    s = service()
    for _ in range(70):
        ident = s.open()["session_id"]
        s.close(ident)
    assert len(s.sessions) == 1


def test_caller_project_and_cache_do_not_cross(service):
    first = service()
    r = request(first)
    result = execute(first, r)
    for updates in ({"caller": "second-caller"}, {"project_id": "second-project"}):
        second = service(updates=updates)
        with pytest.raises(ValueError, match="session_expired"):
            second.evidence(
                Ref(session_id=r.session_id, evidence_ref=result["evidence_ref"])
            )
        new = second.open()["session_id"]
        with pytest.raises(PermissionError):
            second.evidence(Ref(session_id=new, evidence_ref=result["evidence_ref"]))
    # Caller is host-owned. Tampering with it cannot re-use any session.
    first.caller = "changed-caller"
    with pytest.raises(ValueError, match="session_expired"):
        execute(first, r)
    first.caller = "local-planner"


def test_profile_and_connection_are_validated_before_serving(service):
    with pytest.raises(ValueError, match="explicit_connection_required"):
        service(updates={"connection": None})


@pytest.mark.parametrize("project_yml", ["name: p\n", "name: p\nprofile: ''\n"])
def test_an_unpinned_project_never_connects_through_the_active_profile(
    tmp_path, monkeypatch, project_yml
):
    import wren.agent_service as agent_service  # noqa: PLC0415
    import wren.cli  # noqa: PLC0415

    (tmp_path / "wren_project.yml").write_text(project_yml)
    build = MagicMock()
    monkeypatch.setattr(wren.cli, "_build_engine", build)
    with pytest.raises(ValueError, match="explicit_connection_required"):
        agent_service.open_engine(tmp_path, {}, None)
    build.assert_not_called()


def test_named_profile_expands_secrets_from_the_bound_project(tmp_path, monkeypatch):
    import wren.agent_service as agent_service  # noqa: PLC0415
    import wren.cli  # noqa: PLC0415
    import wren.profile as profiles  # noqa: PLC0415

    root = tmp_path / "project"
    root.mkdir()
    (root / ".env").write_text("BOUND_PROFILE_SECRET=project-secret\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("BOUND_PROFILE_SECRET", raising=False)
    monkeypatch.setattr(
        profiles,
        "list_profiles",
        lambda: {"named": {"datasource": "duckdb", "path": "${BOUND_PROFILE_SECRET}"}},
    )
    build = MagicMock()
    monkeypatch.setattr(wren.cli, "_build_engine", build)
    agent_service.open_engine(root, {}, "named")
    assert json.loads(build.call_args.args[1])["path"] == "project-secret"
    assert "BOUND_PROFILE_SECRET" not in os.environ


@pytest.mark.parametrize(
    "relative",
    [
        "models/audit.jsonl",
        "cubes/audit.jsonl",
        "views/audit.jsonl",
        "knowledge/audit.jsonl",
        "instructions.md",
        "dashboards.yml",
    ],
)
def test_audit_sink_cannot_be_a_covered_project_source(service, monkeypatch, relative):
    import wren.agent_service as agent_service  # noqa: PLC0415

    sink = service.root / relative
    sink.parent.mkdir(exist_ok=True)
    original = sink.read_bytes() if sink.exists() else None
    engine = MagicMock()
    monkeypatch.setattr(agent_service, "open_engine", engine)
    with pytest.raises(ValueError, match="audit_path_overlaps_project"):
        service(updates={"audit_path": str(sink)})
    engine.assert_not_called()
    assert (sink.read_bytes() if sink.exists() else None) == original


def test_internal_evidence_retained_but_not_projected(service):
    s = service()
    r = request(s)
    result = execute(s, r)
    internal = s.sessions[r.session_id]["evidence"][result["evidence_ref"]]["internal"]
    assert "COUNT(*)" in internal["sql"]
    public = s.evidence(
        Ref(session_id=r.session_id, evidence_ref=result["evidence_ref"])
    )
    assert "internal" not in public and "COUNT" not in json.dumps(public)


@needs_policy_runtime
def test_private_query_policy_denial_remains_denied(service, monkeypatch):
    s = service(
        policy='forbid(principal, action == Service::Action::"execute_query", resource);'
    )

    def invoke(callback):
        try:
            return count(callback)
        except PermissionError:
            raise RuntimeError("runtime_unavailable") from None

    install_invoker(monkeypatch, s, invoke)
    with pytest.raises(PermissionError, match="denied"):
        s.execute(ask_request(s))


PRESETS = {
    "hidden": {"metadata_selection": []},
    "structure": {"metadata_selection": ["structure"]},
    "rules": {"metadata_selection": ["rules"]},
    "full": {"metadata_selection": ["structure", "rules"]},
}
NO_PLANNER_METADATA = (
    'forbid(principal, action == Service::Action::"receive_metadata", resource)'
    ' when { principal.role == "planner" };'
)


@pytest.mark.parametrize("preset", sorted(PRESETS))
@needs_policy_runtime
def test_policy_preset_applies_selection_and_is_reported(service, preset):
    s = service(
        selection=["structure", "rules"],
        updates={"policy_presets": PRESETS, "default_preset": "hidden"},
        preset=preset,
    )
    public = s.capabilities_public()
    assert public["policy_preset"] == {
        "name": preset,
        "available": ["full", "hidden", "rules", "structure"],
    }
    visible = {d["id"] for d in public["metadata_documents"]}
    assert visible == set(PRESETS[preset]["metadata_selection"])
    for name in ("structure", "rules"):
        if name in visible:
            assert s.metadata(None, [name], "planner")
        else:
            with pytest.raises(PermissionError):
                s.metadata(None, [name], "planner")
    assert s.metadata(None, ["structure", "rules"], "worker")
    assert "policy_presets" not in s.config and "default_preset" not in s.config


@needs_policy_runtime
def test_policy_preset_default_unknown_and_invalid(service):
    s = service(selection=["rules"], updates={"policy_presets": PRESETS})
    assert s.capabilities_public()["policy_preset"]["name"] is None
    assert {d["id"] for d in s.capabilities_public()["metadata_documents"]} == {"rules"}
    s = service(
        selection=["rules"],
        updates={"policy_presets": PRESETS, "default_preset": "structure"},
    )
    assert s.capabilities_public()["policy_preset"]["name"] == "structure"
    assert {d["id"] for d in s.capabilities_public()["metadata_documents"]} == {
        "structure"
    }
    bare = service()
    assert bare.capabilities_public()["policy_preset"] == {
        "name": None,
        "available": [],
    }
    with pytest.raises(ValueError, match="unknown_policy_preset"):
        service(updates={"policy_presets": PRESETS}, preset="nope")
    with pytest.raises(ValueError, match="unknown_policy_preset"):
        service(preset="hidden")
    for bad in (
        {"policy_presets": PRESETS, "default_preset": "nope"},
        {"policy_presets": {"full": {"caller": "other"}}},
        {"policy_presets": {"full": {"private_model": {}}}},
        {"policy_presets": {"Bad Name": {}}},
        {"policy_presets": ["hidden"]},
    ):
        with pytest.raises(ValueError, match="invalid_policy_preset"):
            service(updates=bad)


@needs_policy_runtime
def test_policy_preset_cannot_expand_deployment_policy(service):
    s = service(
        policy=NO_PLANNER_METADATA,
        updates={"policy_presets": PRESETS},
        preset="full",
    )
    assert s.capabilities_public()["policy_preset"]["name"] == "full"
    assert s.capabilities_public()["metadata_documents"] == []
    for name in ("structure", "rules"):
        with pytest.raises(PermissionError):
            s.metadata(None, [name], "planner")
    assert s.metadata(None, ["structure", "rules"], "worker")


@needs_policy_runtime
def test_policy_preset_overrides_the_selection_and_policy_file(service):
    s = service(updates={"policy_presets": PRESETS})
    root = s.project.root
    narrow = root / "preset-policy.cedar"
    narrow.write_text((root / s.config["policy"]).read_text() + NO_PLANNER_METADATA)
    presets = {
        **PRESETS,
        "q1": {
            "metadata_selection": ["structure", "rules"],
            "policy": narrow.name,
        },
    }
    s = service(updates={"policy_presets": presets}, preset="q1")
    assert s.capabilities_public()["metadata_documents"] == []
    assert narrow in s.project.paths
    narrow.write_text(narrow.read_text() + "\n")
    with pytest.raises(ValueError, match="context_changed"):
        s.capabilities_public()
    with pytest.raises(Exception):
        service(
            updates={"policy_presets": {"out": {"policy": "../outside.cedar"}}},
            preset="out",
        )


# --- service configuration v2 --------------------------------------------------------------------

LEGACY_VALUES = {
    "dataset": {"model": "orders", "date_column": "order_date"},
    "adhoc": {"models": {"orders": {"columns": ["id"]}}},
    "metadata": [{"id": "structure", "kind": "schema.structure", "path": "m.json"}],
    "rules": {"weekly-target": {"minimum": 4}},
    "query_scope": {"start": "2026-01-05", "end": "2026-01-12"},
}


@pytest.mark.parametrize("key", sorted(LEGACY_VALUES))
def test_legacy_service_config(service, key):
    with pytest.raises(ValueError, match="legacy_service_config") as raised:
        service(updates={key: LEGACY_VALUES[key]})
    message = str(raised.value)
    assert f"{key} (" in message and "config_version: 2" in message


def test_legacy_service_config_names_every_key_and_a_preset_query_scope(service):
    with pytest.raises(ValueError, match="legacy_service_config") as raised:
        service(
            updates={
                **LEGACY_VALUES,
                "policy_presets": {"q1": {"query_scope": {"start": "2026-01-01"}}},
            }
        )
    message = str(raised.value)
    for key in (*LEGACY_VALUES, "policy_presets.q1.query_scope"):
        assert key in message
    with pytest.raises(
        ValueError, match="legacy_service_config.*policy_presets.q1.query_scope"
    ):
        service(updates={"policy_presets": {"q1": {"query_scope": {}}}})


def test_the_agent_presets_command_refuses_a_legacy_file_too(tmp_path):
    from typer.testing import CliRunner  # noqa: PLC0415

    from wren.serve_cli import serve_app  # noqa: PLC0415

    config = tmp_path / "service.yml"
    config.write_text(
        yaml.safe_dump(
            {"policy_presets": {"q1": {"query_scope": {"start": "2026-01-01"}}}}
        )
    )
    out = CliRunner().invoke(
        serve_app, ["agent-presets", "--service-config", str(config)]
    )
    assert out.exit_code == 1 and "legacy_service_config" in out.output
    with pytest.raises(ValueError, match="legacy_service_config"):
        read_policy_presets({"query_scope": {}})


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"config_version": None}, "config_version: 2 is required"),
        ({"config_version": 1}, "config_version: 2 is required"),
        ({"config_version": "2"}, "config_version: 2 is required"),
        ({"surprise": True}, "unknown key surprise"),
        ({"execution": {"turbo": 1}}, "invalid_execution_config: turbo"),
    ],
)
def test_invalid_service_config_is_refused(service, updates, message):
    with pytest.raises(ValueError, match=message):
        service(updates=updates)


def test_a_missing_required_key_is_refused(service):
    root = service.root
    config = yaml.safe_load((root / "service.yml").read_text())
    del config["caller"]
    (root / "service.yml").write_text(yaml.safe_dump(config))
    with pytest.raises(ValueError, match="invalid_service_config: missing caller"):
        service()


def test_the_v2_example_config_has_no_legacy_key_and_the_service_starts(service):
    config = yaml.safe_load((service.root / "service.yml").read_text())
    assert config["config_version"] == 2
    assert not set(config) & set(LEGACY_VALUES)
    assert service().capabilities_public()["capabilities"]


# --- execution limits ----------------------------------------------------------------------------


def test_execution_defaults_send_only_a_deadline_and_derive_the_ipc_cap():
    execution = execution_from_config({})
    assert execution.limits == {"deadlineMs": 120000}
    assert execution.call_timeout_s == 160
    assert execution.max_sql_attempts == 6


def test_execution_fields_map_to_the_runtime_contract():
    execution = execution_from_config(
        {
            "execution": {
                "deadline_ms": 90000,
                "max_tokens": 8192,
                "thinking": "off",
                "max_turns": 8,
                "max_tool_calls": 20,
                "provider_max_retries": 2,
                "provider_max_retry_delay_ms": 4000,
                "max_sql_attempts": 3,
            }
        }
    )
    assert execution.limits == {
        "deadlineMs": 90000,
        "maxTokens": 8192,
        "maxTurns": 8,
        "maxToolCalls": 20,
        "providerMaxRetries": 2,
        "providerMaxRetryDelayMs": 4000,
        "enableThinking": False,
    }
    assert execution.call_timeout_s == 130
    assert execution.max_sql_attempts == 3
    assert (
        execution_from_config({"execution": {"thinking": "on"}}).limits[
            "enableThinking"
        ]
        is True
    )
    # A bare on/off in YAML is a boolean.
    assert (
        execution_from_config({"execution": {"thinking": False}}).limits[
            "enableThinking"
        ]
        is False
    )
    assert (
        "enableThinking"
        not in execution_from_config({"execution": {"thinking": "default"}}).limits
    )


@pytest.mark.parametrize(
    "execution",
    [
        {"deadline_ms": 4999},
        {"deadline_ms": 600001},
        {"deadline_ms": "120000"},
        {"deadline_ms": True},
        {"max_tokens": 255},
        {"max_turns": 0},
        {"max_tool_calls": 257},
        {"provider_max_retries": 9},
        {"provider_max_retry_delay_ms": 99},
        {"max_sql_attempts": 0},
        {"thinking": "maybe"},
        {"reasoning_budget_tokens": 100},
        "fast",
    ],
)
def test_invalid_execution_values_are_refused(execution):
    with pytest.raises(ValueError, match="invalid_execution_config"):
        execution_from_config({"execution": execution})


def test_as_of_is_a_host_side_date_and_never_part_of_the_runtime_limits():
    assert execution_from_config({}).as_of is None
    fixed = execution_from_config({"execution": {"as_of": "2026-06-30"}})
    assert fixed.as_of == "2026-06-30"
    assert fixed.limits == {"deadlineMs": 120000}
    # A bare 2026-06-30 in YAML is a date object, a quoted one is text.
    parsed = yaml.safe_load("execution:\n  as_of: 2026-06-30\n")
    assert execution_from_config(parsed).as_of == "2026-06-30"


@pytest.mark.parametrize(
    "value",
    [
        "2026-6-30",
        "2026-06-31",
        "2026-06-30T00:00:00",
        "30/06/2026",
        "",
        20260630,
        True,
        None,
        datetime(2026, 6, 30, 12, 0),
    ],
)
def test_a_malformed_as_of_fails_the_start(value):
    with pytest.raises(ValueError, match="invalid_execution_config: as_of"):
        execution_from_config({"execution": {"as_of": value}})


def test_the_start_fails_on_a_malformed_as_of(service):
    with pytest.raises(ValueError, match="invalid_execution_config: as_of"):
        service(updates={"execution": {"as_of": "last friday"}})


def test_capabilities_report_a_fixed_as_of_and_the_clock_otherwise(service):
    assert service().capabilities_public()["as_of"] == "clock"
    fixed = service(updates={"execution": {"as_of": "2026-06-30"}})
    assert fixed.capabilities_public()["as_of"] == "2026-06-30"
    assert fixed.open()["as_of"] == "2026-06-30"


def test_the_worker_request_and_the_audit_carry_the_fixed_as_of(service, monkeypatch):
    s = service(updates={"execution": {"as_of": "2026-06-30"}})
    seen = []
    worker_sees(monkeypatch, s, count, seen)
    r = ask_request(s)
    done = s.execute(r)
    assert seen[0]["as_of"] == "2026-06-30"
    assert set(seen[0]) == {
        "capability",
        "question",
        "previous",
        "context_index",
        "as_of",
    }
    assert [e["as_of"] for e in events_named(s, "task_completed")] == ["2026-06-30"]
    assert "as_of" not in done
    internal = s.sessions[r.session_id]["evidence"][done["evidence_ref"]]["internal"]
    assert internal["as_of"] == "2026-06-30"
    assert "as_of" not in json.dumps(done["evidence"])


def test_an_unset_as_of_is_the_host_utc_date_of_each_task(service, monkeypatch):
    s = service()
    seen = []
    worker_sees(monkeypatch, s, count, seen)
    monkeypatch.setattr("wren.agent_service.today_utc", lambda: "2031-02-03")
    s.execute(ask_request(s))
    monkeypatch.setattr("wren.agent_service.today_utc", lambda: "2031-02-04")
    again = ask_request(s).model_copy(update={"request_id": "ask-2"})
    s.execute(again)
    assert [r["as_of"] for r in seen] == ["2031-02-03", "2031-02-04"]
    assert [e["as_of"] for e in events_named(s, "task_completed")] == [
        "2031-02-03",
        "2031-02-04",
    ]


def test_the_clock_default_is_todays_utc_date():
    from wren.agent_service import today_utc  # noqa: PLC0415

    assert today_utc() == datetime.now(timezone.utc).date().isoformat()


def test_a_failed_task_records_the_as_of_it_ran_under(service, monkeypatch):
    s = service(updates={"execution": {"as_of": "2026-06-30"}})
    worker_sees(monkeypatch, s, lambda callback: {"value": 1})
    with pytest.raises(ValueError, match="invalid_evidence"):
        s.execute(ask_request(s))
    assert events_named(s, "task_failed")[-1]["as_of"] == "2026-06-30"


def test_execution_limits_passthrough(service, monkeypatch):
    monkeypatch.delenv("WREN_IPC_CALL_TIMEOUT_S", raising=False)
    monkeypatch.setenv("NVIDIA_INFERENCE_API_KEY", "test-only-dummy-value")
    s = service(runtime_path=FAKE_RUNTIME)
    init = s.ipc.call("echo_init")
    assert init["limits"] == {"deadlineMs": 120000}
    assert "enableThinking" not in init["limits"]
    assert init["model"]["apiKey"] == "<redacted>"
    assert s.ipc._timeout() == 160
    tuned = service(
        runtime_path=FAKE_RUNTIME,
        updates={
            "execution": {
                "deadline_ms": 60000,
                "max_tokens": 8192,
                "thinking": "off",
                "max_turns": 6,
                "provider_max_retries": 2,
            }
        },
    )
    assert tuned.ipc.call("echo_init")["limits"] == {
        "deadlineMs": 60000,
        "maxTokens": 8192,
        "maxTurns": 6,
        "providerMaxRetries": 2,
        "enableThinking": False,
    }
    assert tuned.ipc._timeout() == 100
    monkeypatch.setenv("WREN_IPC_CALL_TIMEOUT_S", "7")
    assert tuned.ipc._timeout() == 7


def test_a_runtime_accepts_every_execution_field(service):
    full = {
        "deadline_ms": 30000,
        "max_tokens": 2048,
        "thinking": "on",
        "max_turns": 6,
        "max_tool_calls": 12,
        "provider_max_retries": 1,
        "provider_max_retry_delay_ms": 500,
        "max_sql_attempts": 4,
    }
    assert service(updates={"execution": full}).capabilities_public()["capabilities"]


def test_the_worker_tool_declarations_reach_the_runtime(service):
    s = service(runtime_path=FAKE_RUNTIME)
    names = [t["name"] for t in s.ipc.call("echo_init")["tools"]]
    assert names == [
        "list_context",
        "select_context",
        "read_context",
        "run_sql",
        "describe_data",
        "clarify",
    ]


def test_the_staged_bundle_carries_the_loader_prepared_document(tmp_path):
    bundle = tmp_path / "bundle"
    shutil_copy = __import__("shutil").copytree
    shutil_copy(EXAMPLES / "profiles/analysis", bundle)
    assert not (bundle / "context.json").exists()
    staged = (tmp_path / "staged").resolve()
    stage_bundle(bundle, staged, {"context_version": 2, "parseable": True, "x": 1})
    assert json.loads((staged / "context.json").read_text())["x"] == 1
    assert not (bundle / "context.json").exists()


# --- denied columns across the service surface ---------------------------------------------------


def test_a_denied_column_is_absent_from_planner_worker_and_description(
    service, monkeypatch
):
    s = service(selection=["structure", "rules"])
    planner = json.dumps(s.metadata(None, ["structure", "rules"], "planner"))
    assert "email" not in planner.lower()
    seen = {}

    def invoke(callback):
        seen["list"] = callback("list_context", {})
        seen["read"] = callback("read_context", {"ids": ["customers", "orders"]})
        seen["rule"] = callback(
            "read_context", {"ids": ["rule:knowledge/rules/conventions.md"]}
        )
        out = callback("describe_data", {})
        seen["describe"] = out["result"]
        return {"evidence": out["evidence"]}

    install_invoker(monkeypatch, s, invoke)
    r = ask_request(s)
    s.execute(r)
    assert "email" not in json.dumps(seen).lower()
    assert [c["name"] for c in seen["read"]["items"][0]["columns"]] == ["id", "region"]
    request_payload = []
    real = s.ipc.call
    monkeypatch.setattr(
        s.ipc,
        "call",
        lambda op, **kw: (
            request_payload.append(kw.get("request")) or real(op, **kw)
            if op != "invoke"
            else (request_payload.append(kw["request"]), {"evidence": "x"})[1]
        ),
    )
    with pytest.raises(ValueError, match="invalid_evidence"):
        s.execute(ask_request(s))
    index = json.loads(request_payload[-1])["context_index"]
    assert "model orders" in index and "email" not in index.lower()
    assert "context_documents" not in json.loads(request_payload[-1])


def test_worker_context_tools_authorize_and_audit_the_selection(
    service, monkeypatch, tmp_path
):
    sink = tmp_path / "audit.jsonl"
    s = service(updates={"audit_path": str(sink)})

    def invoke(callback):
        assert callback("select_context", {"ids": ["orders"]}) == {
            "selected": ["orders"]
        }
        assert (
            callback("select_context", {"ids": ["nope"]})["error"]
            == "unknown_context_id"
        )
        assert callback("list_context", {"page": 9})["error"] == "page_out_of_range"
        assert callback("read_context", {"ids": "orders"})["error"] == "invalid_ids"
        for bad in ({"documents": ["structure"]}, {}):
            with pytest.raises(ValueError, match="invalid_request"):
                callback("read_context", bad)
        return count(callback)

    install_invoker(monkeypatch, s, invoke)
    assert s.execute(ask_request(s))["status"] == "completed"
    events = [json.loads(x) for x in sink.read_text().splitlines()]
    assert any(
        e.get("event") == "context_select" and e["ids"] == ["orders"] for e in events
    )


@needs_policy_runtime
def test_a_policy_can_deny_the_worker_the_rules_category(service, monkeypatch):
    s = service(
        policy='forbid(principal, action == Service::Action::"receive_metadata", resource) when { principal.role == "worker" && resource.kind == "knowledge.rules" };'
    )
    install_invoker(monkeypatch, s, count)
    with pytest.raises(PermissionError):
        s.execute(ask_request(s))


def test_http_transport_requires_loopback_and_local_token(service):
    from wren.agent_service import http_server  # noqa: PLC0415

    s = service(updates={"policy_presets": PRESETS}, preset="structure")
    with pytest.raises(ValueError, match="local_token_required"):
        http_server(build_mcp(s), "127.0.0.1", 0, "")
    with pytest.raises(ValueError, match="loopback_only"):
        http_server(build_mcp(s), "0.0.0.0", 0, "secret")


@needs_policy_runtime
def test_http_transport_serves_capabilities_behind_token(service):
    import threading  # noqa: PLC0415

    import httpx  # noqa: PLC0415
    from mcp import ClientSession  # noqa: PLC0415
    from mcp.client.streamable_http import streamablehttp_client  # noqa: PLC0415

    from wren.agent_service import http_server  # noqa: PLC0415

    s = service(
        selection=["structure", "rules"],
        updates={"policy_presets": PRESETS, "default_preset": "hidden"},
        preset="structure",
    )
    server, sock = http_server(build_mcp(s), "127.0.0.1", 0, "local-secret")
    port = sock.getsockname()[1]
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]})
    thread.start()
    url = f"http://127.0.0.1:{port}/mcp"
    try:
        probe = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        headers = {"Accept": "application/json, text/event-stream"}
        assert httpx.post(url, json=probe, headers=headers).status_code == 401
        wrong = {**headers, "Authorization": "Bearer other"}
        assert httpx.post(url, json=probe, headers=wrong).status_code == 401

        async def call():
            auth = {"Authorization": "Bearer local-secret"}
            async with streamablehttp_client(url, headers=auth) as (r, w, _):
                async with ClientSession(r, w) as session:
                    await session.initialize()
                    names = {t.name for t in (await session.list_tools()).tools}
                    out = await session.call_tool("capabilities", {})
                    return names, json.loads(out.content[0].text)

        names, public = asyncio.run(call())
        assert "capabilities" in names and "ask_data" not in names
        assert public["policy_preset"] == {
            "name": "structure",
            "available": ["full", "hidden", "rules", "structure"],
        }
        assert [d["id"] for d in public["metadata_documents"]] == ["structure"]
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    assert not thread.is_alive()


@pytest.mark.parametrize(
    "error", [RuntimeError("capabilities_failed"), concurrent.futures.TimeoutError()]
)
def test_failed_open_removes_only_its_new_session(service, monkeypatch, error):
    s = service()
    old = s.open()["session_id"]
    original = s.capabilities_public

    def fail():
        raise error

    monkeypatch.setattr(s, "capabilities_public", fail)
    for _ in range(3):
        with pytest.raises(type(error)) as caught:
            s.open()
        assert caught.value is error
        assert set(s.sessions) == {old}
    monkeypatch.setattr(s, "capabilities_public", original)
    assert s.open()["session_id"] != old


@pytest.mark.parametrize("cleanup_error", [False, True])
def test_failed_audit_open_reaps_the_started_runtime(
    service, monkeypatch, tmp_path, cleanup_error
):
    import wren.agent_service as agent_service  # noqa: PLC0415

    started = []
    closers = []
    original = agent_service.RuntimeIPC

    def track(*args, **kwargs):
        ipc = original(*args, **kwargs)
        started.append(ipc)
        closers.append(ipc.close)
        if cleanup_error:
            close = ipc.close

            def close_then_fail():
                close()
                raise RuntimeError("cleanup_failed")

            ipc.close = close_then_fail
        return ipc

    monkeypatch.setattr(agent_service, "RuntimeIPC", track)
    sink = tmp_path / "existing-audit.jsonl"
    sink.write_text("retain prior audit\n")
    try:
        with pytest.raises(FileExistsError) as caught:
            service(updates={"audit_path": str(sink)})
        assert caught.value.filename == str(sink)
        assert sink.read_text() == "retain prior audit\n"
        assert len(started) == 1
        assert started[0].process.poll() is not None
        assert not started[0].reader.is_alive()
    finally:
        for close in closers:
            close()


def test_audit_path_streams_json_lines_before_shutdown(service, tmp_path):
    sink = tmp_path / "audit.jsonl"
    s = service(selection=["structure"], updates={"audit_path": str(sink)})
    assert s.metadata(None, ["structure"], "planner")
    lines = [json.loads(x) for x in sink.read_text().splitlines()]
    assert lines[0]["event"] == "context_loaded"
    assert any(e.get("event") == "metadata_read" for e in lines)
    assert any(
        e.get("action") == "receive_metadata" and e.get("allowed") is True
        for e in lines
    )
    with pytest.raises(FileExistsError):
        service(updates={"audit_path": str(sink)})
    s.shutdown()
    assert s.audit_sink is None
    assert [json.loads(x) for x in sink.read_text().splitlines()] == lines


def test_audit_records_task_outcomes(service, monkeypatch, tmp_path):
    sink = tmp_path / "outcomes.jsonl"
    s = service(updates={"audit_path": str(sink)})
    r = request(s)
    execute(s, r)
    events = [json.loads(x) for x in sink.read_text().splitlines()]
    done = [e for e in events if e.get("event") == "task_completed"]
    assert done and done[-1]["status"] == "completed"

    install_invoker(monkeypatch, s, lambda callback: {"value": 9999, "text": "x"})
    bad = ask_request(s)
    with pytest.raises(ValueError, match="invalid_evidence"):
        s.execute(bad)
    events = [json.loads(x) for x in sink.read_text().splitlines()]
    failed = [e for e in events if e.get("event") == "task_failed"]
    assert failed[-1]["reason"] == "invalid_evidence"
    assert failed[-1]["raw_keys"] == ["text", "value"]
    assert "9999" not in sink.read_text()

    def boom(callback):
        err = RuntimeError("runtime_unavailable")
        err.detail = "provider_http 429"
        raise err

    install_invoker(monkeypatch, s, boom)
    with pytest.raises(RuntimeError, match="runtime_unavailable"):
        s.execute(ask_request(s))
    events = [json.loads(x) for x in sink.read_text().splitlines()]
    failed = [e for e in events if e.get("event") == "task_failed"]
    assert failed[-1]["reason"] == "runtime_unavailable"
    assert failed[-1]["detail"] == "provider_http 429"


@pytest.mark.parametrize(
    ("detail", "reason"),
    [
        ("service_unavailable:provider_http", "provider"),
        ("service_unavailable:provider_stream", "provider"),
        ("service_unavailable:cancelled", "timeout"),
        ("service_unavailable:deadline", "timeout"),
        ("ipc_timeout:host", "timeout"),
        ("service_unavailable:invalid_json", "worker"),
        ("service_unavailable:turn_limit", "worker"),
        ("service_unavailable", "service"),
        (None, "service"),
    ],
)
def test_unavailable_carries_a_coarse_reason(service, monkeypatch, detail, reason):
    from wren.agent_service import safe  # noqa: PLC0415

    s = service()

    def boom(callback):
        err = RuntimeError("runtime_unavailable")
        if detail is not None:
            err.detail = detail
        raise err

    install_invoker(monkeypatch, s, boom)
    out = asyncio.run(safe(s.execute, ask_request(s)))
    assert out == {"status": "unavailable", "reason": reason}


@needs_policy_runtime
def test_invalid_evidence_is_a_worker_reason_and_denied_stays_bare(
    service, monkeypatch
):
    from wren.agent_service import safe  # noqa: PLC0415

    s = service()
    install_invoker(monkeypatch, s, lambda callback: {"value": 1})
    assert asyncio.run(safe(s.execute, ask_request(s))) == {
        "status": "unavailable",
        "reason": "worker",
    }
    denied = asyncio.run(safe(s.metadata, None, ["rules"], "planner"))
    assert denied == {"status": "denied"}


def test_describe_data_discloses_a_host_generated_summary(service, monkeypatch):
    root = service.root
    model = root / "models/orders/metadata.yml"
    config = yaml.safe_load(model.read_text())
    config["properties"]["description"] = (
        "Customer orders. One row per order header. Migrated copies carry legacy_ord_id."
    )
    model.write_text(yaml.safe_dump(config, sort_keys=False))
    customers = root / "models/customers/metadata.yml"
    config = yaml.safe_load(customers.read_text())
    config["properties"] = {}
    customers.write_text(yaml.safe_dump(config, sort_keys=False))
    (root / "target/mdl.json").write_text(json.dumps(build_json(root)))
    s = service()
    seen = {}

    def invoke(callback):
        out = callback("describe_data", {})
        seen.update(out)
        return {"evidence": out["evidence"]}

    install_invoker(monkeypatch, s, invoke)
    r = ask_request(s)
    done = s.execute(r)
    assert done["status"] == "completed"
    text = done["result"]["text"]
    assert done["result"]["kind"] == "text" and seen["result"] == done["result"]
    assert "orders: Customer orders. One row per order header." in text
    assert "legacy_ord_id" not in text and "- customers" in text
    ev = s.evidence(Ref(session_id=r.session_id, evidence_ref=done["evidence_ref"]))
    assert ev["result"]["kind"] == "text"
    with pytest.raises(ValueError, match="invalid_request"):
        install_invoker(monkeypatch, s, lambda cb: cb("describe_data", {"x": 1}))
        s.execute(
            Ask(
                session_id=r.session_id,
                request_id="d2",
                expected_revision=done["revision"],
                capability="orders",
                question="what data",
            )
        )


@needs_policy_runtime
def test_describe_data_has_its_own_disclosure_gate(service, monkeypatch):
    s = service(
        policy='forbid(principal, action == Service::Action::"receive_answer", resource) when { resource.kind == "answer.description" };'
    )
    install_invoker(
        monkeypatch, s, lambda cb: {"evidence": cb("describe_data", {})["evidence"]}
    )
    with pytest.raises(PermissionError):
        s.execute(ask_request(s))
    s2 = service(
        policy='forbid(principal, action == Service::Action::"invoke_tool", resource) when { resource.name == "describe_data" };'
    )
    install_invoker(
        monkeypatch, s2, lambda cb: {"evidence": cb("describe_data", {})["evidence"]}
    )
    with pytest.raises(PermissionError):
        s2.execute(ask_request(s2))


# -- the status-scope clarification chain ---------------------------------------------------------

RULE = "count-paid-and-shipped"
PAID = "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status = 'paid'"
DEFAULT_SET = (
    "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')"
)
NO_TEST_FILTER = "SELECT COUNT(*) FROM orders WHERE status = 'paid'"
NO_TEST_FILTER_DEFAULT_SET = (
    "SELECT COUNT(*) FROM orders WHERE status IN ('paid', 'shipped')"
)


def sequence(s):
    return [
        e["event"]
        for e in s.audit
        if e.get("event", "").startswith(("private_sql", "task_", "caller_scope"))
    ]


def events_named(s, name):
    return [e for e in s.audit if e.get("event") == name]


def worker_sees(monkeypatch, s, invoke, seen=None):
    """Install ``invoke`` as the private runtime, keeping each request it was given."""
    real = s.ipc.call

    def call(op, **kwargs):
        if op == "invoke":
            if seen is not None:
                seen.append(json.loads(kwargs["request"]))
            return invoke(kwargs["callback"])
        return real(op, **kwargs)

    monkeypatch.setattr(s.ipc, "call", call)


def asking(s, session, revision, request_id, reply_to=None):
    return Ask(
        session_id=session,
        request_id=request_id,
        expected_revision=revision,
        capability="analytics",
        question="How many paid orders",
        reply_to=reply_to,
    )


def answering(response, session, revision, request_id, answer):
    return Continue(
        session_id=session,
        request_id=request_id,
        expected_revision=revision,
        continuation_ref=response["continuation_ref"],
        answer=answer,
    )


def internal_of(s, response):
    return s.sessions[response["session_id"]]["evidence"][response["evidence_ref"]][
        "internal"
    ]


def clarifying(sql, out):
    def invoke(callback):
        out.append(callback("run_sql", {"sql": sql}))
        return callback("clarify", {"missing": "status_scope"})

    return invoke


def finishing(sql, out=None):
    def invoke(callback):
        answer = callback("run_sql", {"sql": sql})
        if out is not None:
            out.append(answer)
        return {"evidence": answer["evidence"]} if "evidence" in answer else answer

    return invoke


@needs_policy_runtime
def test_the_status_scope_chain_from_violation_to_confirmed_scope(service, monkeypatch):
    s = service(profile="adhoc", example_presets=True, preset="hidden")
    rejected = []
    worker_sees(monkeypatch, s, clarifying(PAID, rejected))
    r = asking(s, s.open()["session_id"], 0, "one")
    response = s.execute(r)
    assert rejected[0]["error"] == "declared_default_missing"
    assert rejected[0]["rules"] == [f"{RULE}:subset"]
    assert "clarify with missing=status_scope" in rejected[0]["hint"]
    assert response["status"] == "needs_clarification"
    assert response["question"] == "請指定要分析的訂單狀態"
    assert not events_named(s, "private_sql")

    seen, completed_sql = [], []
    worker_sees(monkeypatch, s, finishing(PAID, completed_sql), seen)
    done = s.continue_task(answering(response, r.session_id, 1, "two", "Paid"))
    assert done["status"] == "completed"
    assert done["result"]["rows"] == [{"c1": 6}]
    assert seen[0]["previous"] == {
        "original_question": "How many paid orders",
        "user_answer": "Paid",
        "status_scope": ["paid"],
    }
    internal = internal_of(s, done)
    assert internal["checks"][RULE] == {
        "applicable": True,
        "result": "satisfied_by_caller_scope",
        "scope": ["paid"],
    }
    assert internal["caller_scope"] == {"rule": RULE, "values": ["paid"]}
    assert internal["checks"]["exclude-test-orders"]["result"] == "satisfied"
    confirmed = events_named(s, "caller_scope_confirmed")
    assert [(e["request_id"], e["rule"], e["scope"]) for e in confirmed] == [
        ("two", RULE, ["paid"])
    ]
    assert sequence(s) == [
        "private_sql_attempt",
        "private_sql_rejected",
        "task_completed",
        "caller_scope_confirmed",
        "private_sql_attempt",
        "private_sql",
        "task_completed",
    ]
    attempts = events_named(s, "private_sql_rejected")
    assert [e["attempt"] for e in attempts] == [1]
    assert "caller_scope" not in json.dumps(
        s.evidence(Ref(session_id=r.session_id, evidence_ref=done["evidence_ref"]))
    )


@needs_policy_runtime
def test_the_clarification_is_kept_in_both_wordings_and_the_policy_picks_what_is_sent(
    service, monkeypatch
):
    s = service(profile="adhoc", example_presets=True, preset="hidden")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    response = s.execute(r)
    pending = s.sessions[r.session_id]["pending"][response["continuation_ref"]]
    messages = pending["clarification_messages"]
    assert pending["status_rule"] == RULE
    assert response["question"] == messages["without_disclosure"]
    assert (
        "paid" in messages["with_disclosure"]
        and "shipped" in messages["with_disclosure"]
    )
    assert "cancelled" not in messages["with_disclosure"]
    assert "pending" not in messages["with_disclosure"]
    for text in messages.values():
        assert "email" not in text and "status" not in text
    assert not any(
        v in messages["without_disclosure"] for v in ("paid", "shipped", "cancelled")
    )
    assert (
        response["question"]
        == status_clarifications(s.status_rules[RULE])["without_disclosure"]
    )


def test_a_confirmed_scope_changes_only_the_status_comparison(service, monkeypatch):
    s = service(profile="adhoc")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    response = s.execute(r)
    # the test-row rule is untouched: the same statement without it is still refused for it
    answers = []
    worker_sees(monkeypatch, s, finishing(NO_TEST_FILTER, answers))
    with pytest.raises(ValueError, match="invalid_evidence"):
        s.continue_task(answering(response, r.session_id, 1, "two", "paid"))
    assert answers[0]["rules"] == ["exclude-test-orders"]
    # the confirmed set replaces the declared one as the target, so the declared set is a superset
    s = service(profile="adhoc")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    response = s.execute(r)
    answers = []
    worker_sees(monkeypatch, s, finishing(DEFAULT_SET, answers))
    with pytest.raises(ValueError, match="invalid_evidence"):
        s.continue_task(answering(response, r.session_id, 1, "two", "paid"))
    assert answers[0]["rules"] == [f"{RULE}:superset"]
    s = service(profile="adhoc")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    response = s.execute(r)
    worker_sees(monkeypatch, s, finishing(PAID))
    assert (
        s.continue_task(answering(response, r.session_id, 1, "two", "paid"))["status"]
        == "completed"
    )


def test_a_follow_up_to_the_result_inherits_the_scope_and_a_new_task_does_not(
    service, monkeypatch
):
    s = service(profile="adhoc")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    session = s.open()["session_id"]
    response = s.execute(asking(s, session, 0, "one"))
    worker_sees(monkeypatch, s, finishing(PAID))
    done = s.continue_task(answering(response, session, 1, "two", "paid"))

    seen, answers = [], []
    worker_sees(monkeypatch, s, finishing(PAID, answers), seen)
    follow = s.execute(asking(s, session, 2, "three", done["result_ref"]))
    assert follow["status"] == "completed"
    assert seen[0]["previous"]["status_scope"] == ["paid"]
    assert (
        internal_of(s, follow)["checks"][RULE]["result"] == "satisfied_by_caller_scope"
    )
    inherited = events_named(s, "caller_scope_inherited")
    assert [(e["request_id"], e["rule"], e["scope"]) for e in inherited] == [
        ("three", RULE, ["paid"])
    ]

    # a follow-up that moves the scope is a violation again, and asks again
    widened = []
    worker_sees(monkeypatch, s, clarifying(DEFAULT_SET, widened))
    again = s.execute(asking(s, session, 3, "four", done["result_ref"]))
    assert widened[0]["rules"] == [f"{RULE}:superset"]
    assert again["status"] == "needs_clarification"

    # a task that is not a follow-up starts with no scope
    fresh = []
    worker_sees(monkeypatch, s, clarifying(PAID, fresh))
    s.execute(asking(s, session, 4, "five"))
    assert fresh[0]["rules"] == [f"{RULE}:subset"]
    assert len(events_named(s, "caller_scope_inherited")) == 2


def test_the_budget_runs_on_through_a_clarification(service, monkeypatch):
    s = service(profile="adhoc")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    response = s.execute(r)
    budget = s.sessions[r.session_id]["pending"][response["continuation_ref"]]["budget"]
    assert (budget.attempts, budget.rejected) == (1, 1)
    answers = []

    def invoke(callback):
        answers.append(callback("run_sql", {"sql": NO_TEST_FILTER}))
        answers.append(callback("run_sql", {"sql": NO_TEST_FILTER}))
        answers.append(callback("run_sql", {"sql": NO_TEST_FILTER}))
        return {"value": None}

    worker_sees(monkeypatch, s, invoke)
    with pytest.raises(Exception) as caught:
        s.continue_task(answering(response, r.session_id, 1, "two", "paid"))
    assert unavailable_reason(caught.value) == "worker"
    # one rejection before the clarification, two after it, then the third ends the task
    assert [e["attempt"] for e in events_named(s, "private_sql_rejected")] == [1, 2, 3]
    assert events_named(s, "private_sql_budget_exhausted")[0]["kind"] == "rejected"


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ("paid", {"paid"}),
        (" Paid , SHIPPED ", {"paid", "shipped"}),
        ("paid、shipped", {"paid", "shipped"}),
        ("paid，shipped", {"paid", "shipped"}),
        ("paid; shipped", {"paid", "shipped"}),
        ("'paid', \"shipped\"", {"paid", "shipped"}),
        ("paid\nshipped\n", {"paid", "shipped"}),
        ("paid,,paid", {"paid"}),
        ("", None),
        (" , ", None),
        ("paid and shipped", None),
        ("paid, refunded", None),
        ("all", None),
    ],
)
def test_the_answer_is_read_as_a_set_of_statuses_inside_the_domain(
    service, answer, expected
):
    rule = service(profile="adhoc").status_rules[RULE]
    parsed = parse_status_answer(answer, rule) if answer else None
    assert parsed == (None if expected is None else frozenset(expected))


def test_an_answer_outside_the_domain_is_asked_again_once_and_then_fails_the_task(
    service, monkeypatch
):
    s = service(profile="adhoc")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    first = s.execute(r)
    ran = []
    worker_sees(monkeypatch, s, finishing(PAID, ran))

    second = s.continue_task(answering(first, r.session_id, 1, "two", "refunded"))
    assert second["status"] == "needs_clarification"
    assert second["continuation_ref"] != first["continuation_ref"]
    assert second["question"] == first["question"]
    assert not ran and not events_named(s, "caller_scope_confirmed")
    again = s.sessions[r.session_id]["pending"][second["continuation_ref"]]
    assert again["retried"] is True and again["status_rule"] == RULE
    assert (
        again["budget"]
        is s.sessions[r.session_id]["pending"][first["continuation_ref"]]["budget"]
    )

    with pytest.raises(StatusScopeUnresolved) as caught:
        s.continue_task(answering(second, r.session_id, 2, "three", "cancelled-ish"))
    assert unavailable_reason(caught.value) == "worker"
    failed = events_named(s, "task_failed")
    assert (failed[-1]["reason"], failed[-1]["detail"]) == (
        "status_scope_unresolved",
        "status_scope_unresolved",
    )
    assert not ran
    with pytest.raises(ValueError, match="context_changed"):
        s.continue_task(answering(second, r.session_id, 2, "four", "paid"))


def test_the_second_unusable_answer_reaches_the_planner_as_unavailable_worker(
    service, monkeypatch
):
    import asyncio  # noqa: PLC0415

    s = service(profile="adhoc")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    first = s.execute(r)
    second = s.continue_task(answering(first, r.session_id, 1, "two", "nope"))
    out = asyncio.run(
        safe(s.continue_task, answering(second, r.session_id, 2, "three", "still nope"))
    )
    assert out == {"status": "unavailable", "reason": "worker"}


def test_a_usable_answer_after_an_unusable_one_completes_the_task(service, monkeypatch):
    s = service(profile="adhoc")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    first = s.execute(r)
    second = s.continue_task(answering(first, r.session_id, 1, "two", "nope"))
    worker_sees(monkeypatch, s, finishing(PAID))
    done = s.continue_task(answering(second, r.session_id, 2, "three", "paid"))
    assert done["status"] == "completed"
    assert internal_of(s, done)["caller_scope"]["values"] == ["paid"]


def test_clarify_for_a_status_scope_is_refused_when_the_caller_may_not_override_it(
    service, monkeypatch
):
    rules = service.root / "knowledge/rules/conventions.md"
    rules.write_text(
        rules.read_text().replace(
            "overridable_by_caller: true", "overridable_by_caller: false"
        )
    )
    s = service(profile="adhoc")
    assert s.status_rules[RULE].overridable_by_caller is False
    out = []

    def invoke(callback):
        out.append(callback("run_sql", {"sql": PAID}))
        out.append(callback("clarify", {"missing": "status_scope"}))
        out.append(callback("run_sql", {"sql": DEFAULT_SET}))
        return {"evidence": out[-1]["evidence"]}

    worker_sees(monkeypatch, s, invoke)
    done = s.execute(asking(s, s.open()["session_id"], 0, "one"))
    assert out[0]["rules"] == [f"{RULE}:subset"]
    assert "status_scope" not in out[0]["hint"]
    assert out[1] == {"error": "clarification_not_applicable"}
    assert done["status"] == "completed" and done["result"]["rows"] == [{"c1": 12}]
    assert not s.sessions[done["session_id"]]["pending"]


def test_clarify_for_a_status_scope_needs_a_violation_of_this_task(
    service, monkeypatch
):
    s = service(profile="adhoc")
    out = []

    def invoke(callback):
        out.append(callback("clarify", {"missing": "status_scope"}))
        out.append(callback("run_sql", {"sql": NO_TEST_FILTER_DEFAULT_SET}))
        out.append(callback("clarify", {"missing": "status_scope"}))
        out.append(callback("run_sql", {"sql": DEFAULT_SET}))
        return {"evidence": out[-1]["evidence"]}

    worker_sees(monkeypatch, s, invoke)
    response = s.execute(asking(s, s.open()["session_id"], 0, "one"))
    # the exclusion rule was broken, not the status rule: asking about statuses cannot help
    assert out[0] == {"error": "clarification_not_applicable"}
    assert out[1]["rules"] == ["exclude-test-orders"]
    assert out[2] == {"error": "clarification_not_applicable"}
    assert response["status"] == "completed"


def test_other_clarifications_are_unchanged_and_status_scope_needs_sql(
    service, monkeypatch
):
    s = service(profile="adhoc")

    def invoke(callback):
        with pytest.raises(ValueError, match="invalid_clarification"):
            callback("clarify", {"missing": "weekly_target"})
        with pytest.raises(ValueError, match="invalid_clarification"):
            callback("clarify", {"missing": "status_scope", "extra": 1})
        callback("run_sql", {"sql": PAID})
        s.capabilities["analytics"]["sql"] = False
        with pytest.raises(ValueError, match="invalid_clarification"):
            callback("clarify", {"missing": "status_scope"})
        s.capabilities["analytics"]["sql"] = True
        return callback("clarify", {"missing": "analysis_definition"})

    worker_sees(monkeypatch, s, invoke)
    assert (
        s.execute(asking(s, s.open()["session_id"], 0, "one"))["status"]
        == "needs_clarification"
    )


def test_a_direct_caller_is_not_pointed_at_a_clarification_it_cannot_make(service):
    s = service()
    out = execute(s, request(s).model_copy(update={"sql": PAID}))
    assert (out["error"], out["rules"]) == (
        "declared_default_missing",
        [f"{RULE}:subset"],
    )
    assert "clarify" not in out["hint"] and "status_scope" not in out["hint"]
    assert [
        e["event"] for e in s.audit if e.get("event", "").startswith("private_sql_rej")
    ] == ["private_sql_rejected"]


# -- evidence: four kinds, four presets ------------------------------------------------------------

PRESET_NAMES = ("hidden", "structure", "rules", "full")
JOINED = (
    "SELECT c.region, COUNT(*) FROM orders o JOIN customers c ON o.customer_id = c.id "
    "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped') GROUP BY c.region"
)
EVIDENCE_FIELDS = {
    "hidden": {
        "mandatory_scope",
        "applied_period",
        "checks_summary",
        "has_unverified_semantics",
    },
    "structure": {
        "mandatory_scope",
        "applied_period",
        "checks_summary",
        "has_unverified_semantics",
        "observed",
    },
    "rules": {
        "mandatory_scope",
        "applied_period",
        "checks_summary",
        "has_unverified_semantics",
        "checks",
        "unverified",
    },
    "full": {
        "mandatory_scope",
        "applied_period",
        "checks_summary",
        "has_unverified_semantics",
        "checks",
        "unverified",
        "observed",
    },
}
PRIVATE_WORDS = (
    "exclude-test-orders",
    "convert-invoices-to-usd",
    RULE,
    "fiscal_calendar_bounds",
    "orders",
    "customers",
    "is_test",
    "region",
    "status",
    "paid",
    "email",
    "violated",
    "undetermined",
    "SELECT",
)


def sql_request(s, sql, request_id="one"):
    return SQL(
        session_id=s.open()["session_id"],
        request_id=request_id,
        expected_revision=0,
        capability="orders",
        sql=sql,
    )


def evidence_of(s, request, response):
    return s.evidence(
        Ref(session_id=request.session_id, evidence_ref=response["evidence_ref"])
    )


@pytest.mark.parametrize("preset", PRESET_NAMES)
@needs_policy_runtime
def test_each_preset_projects_its_own_evidence_fields_and_get_evidence_agrees(
    service, preset
):
    s = service(example_presets=True, preset=preset)
    r = sql_request(s, JOINED)
    done = execute(s, r)
    evidence = done["evidence"]
    assert set(evidence) == EVIDENCE_FIELDS[preset]
    assert evidence_of(s, r, done) == {
        "result": done["result"],
        "completed_at": s.sessions[r.session_id]["evidence"][done["evidence_ref"]][
            "completed_at"
        ],
        "evidence": evidence,
    }
    assert evidence["mandatory_scope"] == {
        "kind": "project_defaults",
        "declared_defaults_enforced": True,
    }
    assert evidence["checks_summary"] == "all_satisfied"
    assert evidence["has_unverified_semantics"] is True
    if "checks" in evidence:
        assert evidence["checks"]["exclude-test-orders"] == {
            "applicable": True,
            "result": "satisfied",
        }
        assert evidence["checks"][RULE] == {"applicable": True, "result": "satisfied"}
        assert evidence["checks"]["convert-invoices-to-usd"]["applicable"] is False
        assert evidence["unverified"] == ["fiscal_calendar_bounds"]
    if "observed" in evidence:
        assert evidence["observed"]["models"] == ["customers", "orders"]
        assert evidence["observed"]["columns"] == {
            "customers": ["id", "region"],
            "orders": ["customer_id", "is_test", "status"],
        }
        assert evidence["observed"]["joins"] == [["customers", "orders"]]
        assert evidence["observed"]["aggregated"] is True
        assert evidence["observed"]["date_windows"] == []
        assert evidence["observed"]["status_literals"] == {
            "orders.status": ["paid", "shipped"]
        }
        assert {"column": "orders.status", "operator": "in"} in evidence["observed"][
            "filters"
        ]
        assert "sql" not in json.dumps(evidence).lower()


@needs_policy_runtime
def test_hidden_evidence_names_no_rule_model_column_or_count(service):
    s = service(example_presets=True, preset="hidden")
    r = sql_request(s, JOINED)
    done = execute(s, r)
    text = json.dumps(done["evidence"])
    assert done["evidence"] == {
        "mandatory_scope": {
            "kind": "project_defaults",
            "declared_defaults_enforced": True,
        },
        "applied_period": None,
        "checks_summary": "all_satisfied",
        "has_unverified_semantics": True,
    }
    for word in PRIVATE_WORDS:
        assert word not in text, word
    assert "email" not in json.dumps(evidence_of(s, r, done)["evidence"])
    denied = [
        e
        for e in s.audit
        if e.get("kind", "").startswith("answer.evidence.")
        and e.get("allowed") is False
    ]
    assert {e["kind"] for e in denied} == {
        "answer.evidence.checks",
        "answer.evidence.observed",
        "answer.evidence.unverified",
    }


DATED = (
    "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped') "
    "AND order_date >= DATE '2026-06-01' AND order_date < DATE '2026-07-01'"
)
JUNE_WINDOW = {
    "column": "orders.order_date",
    "lower": "2026-06-01",
    "upper": "2026-07-01",
    "lower_inclusive": True,
    "upper_inclusive": False,
}
JUNE_PERIOD = {k: v for k, v in JUNE_WINDOW.items() if k != "column"}


@pytest.mark.parametrize("preset", PRESET_NAMES)
@needs_policy_runtime
def test_the_applied_period_is_shown_to_every_preset_and_the_window_only_with_observed(
    service, preset
):
    s = service(example_presets=True, preset=preset)
    r = sql_request(s, DATED)
    done = execute(s, r)
    evidence = done["evidence"]
    assert set(evidence) == EVIDENCE_FIELDS[preset]
    assert evidence["applied_period"] == JUNE_PERIOD
    assert evidence_of(s, r, done)["evidence"] == evidence
    if "observed" in evidence:
        assert evidence["observed"]["date_windows"] == [JUNE_WINDOW]
    else:
        assert "order_date" not in json.dumps(evidence)
    assert "date_window_unverified" not in json.dumps(evidence)


def test_a_filter_the_host_cannot_pin_leaves_no_applied_period_and_says_so(service):
    s = service(example_presets=True, preset="full")
    done = execute(
        s,
        sql_request(
            s,
            "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped') "
            "AND DATE_TRUNC('month', order_date) = DATE '2026-06-01'",
        ),
    )
    evidence = done["evidence"]
    assert evidence["applied_period"] is None
    assert evidence["has_unverified_semantics"] is True
    assert evidence["observed"]["date_windows"] == []
    assert evidence["unverified"][0] == "date_window_unverified"


def test_no_date_filter_is_no_period_and_not_unverified(service):
    s = service(example_presets=True, preset="full")
    done = execute(s, request(s))
    assert done["evidence"]["applied_period"] is None
    assert done["evidence"]["observed"]["date_windows"] == []
    assert "date_window_unverified" not in done["evidence"]["unverified"]


def test_two_windows_give_a_period_only_when_they_agree(service):
    s = service(example_presets=True, preset="full")
    joined = (
        "SELECT COUNT(*) FROM orders o JOIN invoices i ON o.customer_id = i.customer_id "
        "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped') "
        "AND o.order_date >= DATE '2026-06-01' AND o.order_date < DATE '2026-07-01' "
        "AND i.invoice_date >= {lower} AND i.invoice_date < DATE '2026-07-01'"
    )
    same = execute(s, sql_request(s, joined.format(lower="DATE '2026-06-01'")))
    assert len(same["evidence"]["observed"]["date_windows"]) == 2
    assert same["evidence"]["applied_period"] == JUNE_PERIOD
    other = execute(s, sql_request(s, joined.format(lower="DATE '2026-05-01'")))
    assert len(other["evidence"]["observed"]["date_windows"]) == 2
    assert other["evidence"]["applied_period"] is None


ALL_TIME = "SELECT COUNT(*) AS n FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')"
JUNE_COUNT = DATED.replace("COUNT(*)", "COUNT(*) AS n")


@pytest.mark.parametrize(
    "statement",
    [
        f"{JUNE_COUNT} UNION ALL {ALL_TIME}",
        f"{JUNE_COUNT} UNION ALL SELECT COUNT(*) AS n FROM invoices "
        "WHERE DATE_TRUNC('month', invoice_date) = DATE '2026-06-01'",
    ],
)
def test_a_period_that_does_not_bound_the_whole_statement_is_not_published(
    service, statement
):
    s = service(example_presets=True, preset="full")
    evidence = execute(s, sql_request(s, statement))["evidence"]
    assert evidence["applied_period"] is None
    assert evidence["has_unverified_semantics"] is True
    assert evidence["unverified"][0] == "date_window_unverified"
    assert evidence["observed"]["date_windows"] == [JUNE_WINDOW]


def test_a_statement_every_branch_of_which_has_the_window_publishes_it(service):
    s = service(example_presets=True, preset="full")
    done = execute(s, sql_request(s, f"{JUNE_COUNT} UNION ALL {JUNE_COUNT}"))
    assert done["evidence"]["applied_period"] == JUNE_PERIOD
    assert done["evidence"]["observed"]["date_windows"] == [JUNE_WINDOW]


def test_the_period_needs_both_bounds_and_their_flags_to_agree():
    shape = {"lower": "2026-06-01", "upper": "2026-07-01"}
    closed = {**shape, "lower_inclusive": True, "upper_inclusive": True}
    open_ = {**shape, "lower_inclusive": True, "upper_inclusive": False}
    column = {"column": "orders.order_date"}
    assert applied_period([]) is None and applied_period(None) is None
    assert applied_period([{**column, **open_}]) == open_
    assert applied_period([{**column, **open_}, {"column": "x.y", **open_}]) == open_
    assert applied_period([{**column, **open_}, {"column": "x.y", **closed}]) is None
    unbounded = {**open_, "lower": None, "lower_inclusive": False}
    assert applied_period([{**column, **open_}, {**column, **unbounded}]) is None
    assert applied_period([{**column, **unbounded}]) == unbounded


def test_a_denied_date_column_is_dropped_from_the_windows_but_the_period_stays(
    service,
):
    rules = service.root / "knowledge/rules/conventions.md"
    text = rules.read_text()
    assert "denied_columns: [customers.email]" in text
    rules.write_text(
        text.replace(
            "denied_columns: [customers.email]",
            "denied_columns: [customers.email, orders.order_date]",
        )
    )
    s = service(example_presets=True, preset="full")
    r = sql_request(s, COUNTS["orders"])
    done = execute(s, r)
    saved = s.sessions[r.session_id]["evidence"][done["evidence_ref"]]
    saved["internal"]["observed"]["date_windows"] = [
        JUNE_WINDOW,
        {**JUNE_WINDOW, "column": "orders.status"},
    ]
    del saved["projection"]
    evidence = evidence_of(s, r, done)["evidence"]
    assert evidence["observed"]["date_windows"] == [
        {**JUNE_WINDOW, "column": "orders.status"}
    ]
    assert evidence["applied_period"] == JUNE_PERIOD
    saved["internal"]["observed"]["date_windows"] = [JUNE_WINDOW]
    del saved["projection"]
    again = evidence_of(s, r, done)["evidence"]
    assert again["observed"]["date_windows"] == []
    assert again["applied_period"] == JUNE_PERIOD
    assert "order_date" not in json.dumps(again["applied_period"])


def test_each_evidence_kind_is_authorized_once_per_reference(service):
    s = service(example_presets=True, preset="full")
    r = sql_request(s, JOINED)
    done = execute(s, r)
    kinds = [
        e["kind"] for e in s.audit if e.get("kind", "").startswith("answer.evidence.")
    ]
    assert sorted(kinds) == sorted(
        [
            "answer.evidence.checks",
            "answer.evidence.checks_summary",
            "answer.evidence.observed",
            "answer.evidence.unverified",
        ]
    )
    again = evidence_of(s, r, done)
    assert again["evidence"] == done["evidence"]
    assert (
        len([e for e in s.audit if e.get("kind", "").startswith("answer.evidence.")])
        == 4
    )
    saved = s.sessions[r.session_id]["evidence"][done["evidence_ref"]]
    assert saved["projection"] == done["evidence"]
    saved_copy = evidence_of(s, r, done)["evidence"]
    saved_copy["checks"].clear()
    assert evidence_of(s, r, done)["evidence"]["checks"]


@needs_policy_runtime
def test_a_policy_can_withhold_every_evidence_kind_and_the_scope_still_shows(service):
    withheld = "".join(
        f'forbid(principal, action == Service::Action::"receive_answer", resource) '
        f'when {{ resource.kind == "answer.evidence.{kind}" }};'
        for kind in ("checks", "checks_summary", "observed", "unverified")
    )
    s = service(policy=withheld)
    done = execute(s, request(s))
    assert done["status"] == "completed"
    assert done["evidence"] == {
        "mandatory_scope": {
            "kind": "project_defaults",
            "declared_defaults_enforced": True,
        },
        "applied_period": None,
    }


@needs_policy_runtime
def test_the_evidence_permits_have_a_matching_deny(service):
    s = service()
    session = s.open()["session_id"]
    held = s.sessions[session]
    for kind in (
        "answer.evidence.checks",
        "answer.evidence.checks_summary",
        "answer.evidence.observed",
        "answer.evidence.unverified",
    ):
        assert s.allowed(held, "receive_answer", kind, "orders") is True
        assert s.allowed(held, "receive_answer", kind, "other") is False
    for kind in (
        "answer.evidence",
        "answer.evidence.sql",
        "answer.evidence.violations",
    ):
        assert s.allowed(held, "receive_answer", kind, "orders") is False
    assert s.allowed(held, "invoke_tool", "tool", "describe_data", "planner") is True
    adhoc = service(profile="adhoc")
    held = adhoc.sessions[adhoc.open()["session_id"]]
    assert adhoc.allowed(held, "invoke_tool", "tool", "describe_data", "worker") is True
    assert (
        adhoc.allowed(held, "invoke_tool", "tool", "describe_data", "planner") is False
    )
    for kind in ("answer.evidence.checks", "answer.description"):
        assert adhoc.allowed(held, "receive_answer", kind, "analytics") is True
    assert (
        adhoc.allowed(held, "receive_answer", "answer.evidence.checks", "orders")
        is False
    )
    assert (
        adhoc.allowed(held, "receive_answer", "answer.descriptions", "analytics")
        is False
    )
    assert (
        adhoc.allowed(held, "receive_answer", "answer.evidence", "analytics") is False
    )
    withheld = service(
        profile="adhoc",
        policy='forbid(principal, action == Service::Action::"receive_answer", resource) '
        'when { resource.kind == "answer.description" };',
    )
    held = withheld.sessions[withheld.open()["session_id"]]
    assert (
        withheld.allowed(held, "receive_answer", "answer.description", "analytics")
        is False
    )


def test_the_setup_presets_are_the_four_modes_and_only_narrow(service, tmp_path):
    module = importlib.util.module_from_spec(
        spec := importlib.util.spec_from_file_location(
            "setup_presets", EXAMPLES / "setup.py"
        )
    )
    spec.loader.exec_module(module)
    for adhoc in (False, True):
        destination = tmp_path / ("adhoc" if adhoc else "plain")
        (module.prepare_adhoc if adhoc else module.prepare)(destination)
        project = destination / "project"
        config = yaml.safe_load((project / "service.yml").read_text())
        default, presets = read_policy_presets(config)
        assert default == "hidden" and sorted(presets) == sorted(PRESET_NAMES)
        for name, declared in presets.items():
            assert declared["metadata_selection"] == module.PRESET_SELECTIONS[name]
            text = (project / declared["policy"]).read_text()
            assert text == module.preset_policy(name)
            statements = [x for x in text.split(";") if x.strip()]
            assert (
                statements[0].split("\n", 1)[1].strip()
                == "permit(principal, action, resource)"
            )
            assert len(statements) == 1 + len(module.PRESET_WITHHELD[name])
            assert all(x.lstrip().startswith("forbid(") for x in statements[1:])
    from typer.testing import CliRunner  # noqa: PLC0415

    from wren.serve_cli import serve_app  # noqa: PLC0415

    out = CliRunner().invoke(
        serve_app,
        [
            "agent-presets",
            "--service-config",
            str(tmp_path / "plain/project/service.yml"),
        ],
    )
    assert json.loads(out.output) == {
        "default": "hidden",
        "presets": ["full", "hidden", "rules", "structure"],
    }


@needs_policy_runtime
def test_a_preset_policy_is_evaluated_with_the_deployment_policy_never_in_its_place(
    service,
):
    no_descriptions = (
        'forbid(principal, action == Service::Action::"receive_answer", resource) '
        'when { resource.kind == "answer.description" };'
    )
    s = service(policy=no_descriptions, example_presets=True, preset="full")
    session = s.sessions[s.open()["session_id"]]
    # "full" permits everything the deployment policy does, but an edit to the deployment
    # policy still applies under a preset, and a preset that permits more cannot undo it.
    assert s.allowed(session, "receive_answer", "answer.description", "orders") is False
    assert (
        s.allowed(session, "receive_answer", "answer.evidence.checks", "orders") is True
    )
    widening = s.project.root / "widening.cedar"
    widening.write_text("permit(principal, action, resource);\n")
    wide = service(
        policy=no_descriptions,
        updates={"policy_presets": {"wide": {"policy": widening.name}}},
        preset="wide",
    )
    held = wide.sessions[wide.open()["session_id"]]
    assert wide.allowed(held, "receive_answer", "answer.description", "orders") is False
    assert widening in wide.project.paths
    default = service(policy=no_descriptions, example_presets=True, preset="hidden")
    with pytest.raises(PermissionError):
        default.require(
            default.sessions[default.open()["session_id"]],
            "receive_answer",
            "answer.description",
            "orders",
        )


@needs_policy_runtime
def test_the_example_service_starts_on_its_declared_default_preset(service):
    s = service(example_presets=True)
    assert s.capabilities_public()["policy_preset"] == {
        "name": "hidden",
        "available": ["full", "hidden", "rules", "structure"],
    }
    assert s.capabilities_public()["metadata_documents"] == []
    assert set(execute(s, request(s))["evidence"]) == EVIDENCE_FIELDS["hidden"]


@needs_policy_runtime
def test_a_project_with_no_declared_default_says_so_in_the_scope(service):
    rules = service.root / "knowledge/rules/conventions.md"
    rules.write_text(
        "---\ndenied_columns: [customers.email]\n---\n# Conventions\n\nRevenue is SUM(amount).\n"
    )
    s = service(example_presets=True, preset="hidden")
    done = execute(
        s, request(s).model_copy(update={"sql": "SELECT COUNT(*) FROM orders"})
    )
    assert done["evidence"] == {
        "mandatory_scope": {
            "kind": "project_defaults",
            "declared_defaults_enforced": False,
        },
        "applied_period": None,
        "checks_summary": "none_applicable",
        "has_unverified_semantics": False,
    }


# -- evidence agrees with the statement that ran, recomputed without the host's code ---------------

STATUS_DOMAIN = ("paid", "shipped", "cancelled", "pending")
RECOMPUTED = {
    "count": COUNTS["orders"],
    "join": JOINED,
    "customers only": COUNTS["customers"],
    "aliased exclusions": (
        "SELECT o.status, SUM(o.amount) FROM orders AS o "
        "WHERE o.is_test = FALSE AND o.status <> 'cancelled' AND o.status <> 'pending' "
        "GROUP BY o.status"
    ),
}


def recomputed(sql):
    """What the statement keeps of ``orders``, worked out by DuckDB over every status and flag
    combination, and the models and filter operators read straight from sqlglot's tree. Nothing
    here uses the host's checker or its observed-facts code."""
    import duckdb  # noqa: PLC0415
    import sqlglot  # noqa: PLC0415
    from sqlglot import exp  # noqa: PLC0415

    tree = sqlglot.parse_one(sql, read="duckdb")
    tables = {t.alias_or_name: t.name for t in tree.find_all(exp.Table)}
    where = tree.args.get("where")
    operators = set()

    def walk(node, negated):
        while isinstance(node, exp.Paren):
            node = node.this
        if isinstance(node, (exp.And, exp.Or)):
            walk(node.this, negated)
            walk(node.expression, negated)
        elif isinstance(node, exp.Not):
            walk(node.this, not negated)
        elif isinstance(node, exp.Column):
            operators.add((node, "is false" if negated else "is true"))
        else:
            name = {exp.EQ: "=", exp.NEQ: "<>", exp.In: "in"}[type(node)]
            operators.add((node.this, name))

    if where is not None:
        walk(where.this, False)
    filters = {
        (f"{tables[col.table or next(iter(tables))]}.{col.name}", operator)
        for col, operator in operators
    }
    kept = None
    if "orders" in tables.values():
        alias = next(a for a, m in tables.items() if m == "orders")
        rows = ", ".join(
            f"('{status}', {flag})"
            for status in STATUS_DOMAIN
            for flag in ("TRUE", "FALSE")
        )
        condition = where.this.sql(dialect="duckdb") if where is not None else "TRUE"
        with duckdb.connect() as db:
            out = db.execute(
                f"SELECT status, is_test FROM (SELECT * FROM (VALUES {rows}) "
                f"AS v(status, is_test)) AS {alias} WHERE {condition}"
            ).fetchall()
        kept = ({status for status, _ in out}, any(flag for _, flag in out))
    return sorted(set(tables.values())), filters, kept


@pytest.mark.parametrize("label", sorted(RECOMPUTED))
def test_the_checks_and_observed_facts_match_what_the_statement_does(service, label):
    sql = RECOMPUTED[label]
    models, filters, kept = recomputed(sql)
    s = service(example_presets=True, preset="full")
    r = sql_request(s, sql)
    done = execute(s, r)
    evidence = done["evidence"]
    assert evidence["observed"]["models"] == models
    assert {
        (f["column"], f["operator"]) for f in evidence["observed"]["filters"]
    } == filters
    checks = evidence["checks"]
    if kept is None:
        assert checks["exclude-test-orders"] == {
            "applicable": False,
            "result": "not_applicable",
        }
        assert checks[RULE] == {"applicable": False, "result": "not_applicable"}
        assert evidence["checks_summary"] == "none_applicable"
        return
    statuses, test_rows_kept = kept
    assert not test_rows_kept and statuses == {"paid", "shipped"}
    assert checks["exclude-test-orders"]["result"] == "satisfied"
    assert checks[RULE]["result"] == "satisfied"
    assert evidence["checks_summary"] == "all_satisfied"
    internal = s.sessions[r.session_id]["evidence"][done["evidence_ref"]]["internal"]
    assert internal["observed"]["models"] == models


def test_a_view_guarantee_shows_as_satisfied_by_definition(service):
    s = service(example_presets=True, preset="full")
    r = sql_request(s, "SELECT SUM(usd_value) FROM usd_line_value")
    checks = execute(s, r)["evidence"]["checks"]
    assert checks["convert-invoices-to-usd"] == {
        "applicable": True,
        "result": "satisfied_by_definition",
    }
    assert checks["exclude-test-orders"]["applicable"] is False


def test_a_violation_the_worker_corrected_leaves_no_trace_in_the_evidence(
    service, monkeypatch
):
    s = service(profile="adhoc", example_presets=True, preset="full")
    seen = []

    def invoke(callback):
        seen.append(callback("run_sql", {"sql": NO_TEST_FILTER_DEFAULT_SET}))
        seen.append(
            callback(
                "run_sql",
                {
                    "sql": "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status = customer_id"
                },
            )
        )
        seen.append(callback("run_sql", {"sql": DEFAULT_SET}))
        return {"evidence": seen[-1]["evidence"]}

    worker_sees(monkeypatch, s, invoke)
    r = asking(s, s.open()["session_id"], 0, "one")
    done = s.execute(r)
    assert [x.get("error") for x in seen[:2]] == [
        "declared_default_missing",
        "declared_default_undetermined",
    ]
    assert done["status"] == "completed"
    for text in (
        json.dumps(done["evidence"]),
        json.dumps(
            s.evidence(Ref(session_id=r.session_id, evidence_ref=done["evidence_ref"]))
        ),
    ):
        for word in (
            "violated",
            "undetermined",
            "rule_violation",
            "no_verdict",
            "missing",
            "subset",
            "superset",
        ):
            assert word not in text, word
    assert all(
        c["result"]
        in {
            "satisfied",
            "not_applicable",
            "satisfied_by_definition",
            "satisfied_by_caller_scope",
        }
        for c in done["evidence"]["checks"].values()
    )
    assert [e["sub_code"] for e in events_named(s, "private_sql_rejected")] == [
        "rule_violation",
        "no_verdict",
    ]


def test_evidence_that_somehow_holds_a_violated_check_is_not_projected(service):
    s = service(example_presets=True, preset="full")
    r = sql_request(s, JOINED)
    done = execute(s, r)
    saved = s.sessions[r.session_id]["evidence"][done["evidence_ref"]]
    saved["internal"]["checks"][RULE]["result"] = "violated"
    del saved["projection"]
    with pytest.raises(ValueError, match="invalid_evidence"):
        evidence_of(s, r, done)
    assert asyncio.run(
        safe(
            s.evidence, Ref(session_id=r.session_id, evidence_ref=done["evidence_ref"])
        )
    ) == {"status": "unavailable", "reason": "worker"}


def test_evidence_that_cannot_be_projected_is_neither_delivered_nor_kept(
    service, monkeypatch
):
    s = service(example_presets=True, preset="full")
    real = s.sql.execute

    def violated(prepared):
        result, internal = real(prepared)
        internal["checks"][RULE]["result"] = "violated"
        return result, internal

    monkeypatch.setattr(s.sql, "execute", violated)
    r = sql_request(s, JOINED)
    with pytest.raises(ValueError, match="invalid_evidence"):
        execute(s, r)
    held = s.sessions[r.session_id]
    assert not held["results"] and not held["evidence"] and held["revision"] == 0
    failed = events_named(s, "task_failed")[-1]
    assert (failed["reason"], failed["detail"]) == ("invalid_evidence", "projection")


def test_a_malformed_check_entry_is_neither_delivered_nor_kept(service, monkeypatch):
    s = service(example_presets=True, preset="full")
    real = s.sql.execute

    def malformed(prepared):
        result, internal = real(prepared)
        internal["checks"] = {**internal["checks"], RULE: "satisfied"}
        return result, internal

    monkeypatch.setattr(s.sql, "execute", malformed)
    r = sql_request(s, JOINED)
    with pytest.raises(ValueError, match="invalid_evidence"):
        execute(s, r)
    held = s.sessions[r.session_id]
    assert not held["results"] and not held["evidence"] and held["revision"] == 0
    failed = events_named(s, "task_failed")[-1]
    assert (failed["reason"], failed["detail"]) == ("invalid_evidence", "projection")


def test_a_denied_column_is_dropped_from_observed_even_if_it_were_recorded(service):
    s = service(example_presets=True, preset="full")
    r = sql_request(s, JOINED)
    done = execute(s, r)
    saved = s.sessions[r.session_id]["evidence"][done["evidence_ref"]]
    observed = saved["internal"]["observed"]
    observed["columns"]["customers"].append("email")
    observed["filters"].append({"column": "customers.email", "operator": "="})
    observed["status_literals"]["customers.email"] = ["x@example.invalid"]
    observed["fx_missing_rate_handling"] = "unguarded_left_join"
    observed["duplicate_aggregation"] = True
    del saved["projection"]
    text = json.dumps(evidence_of(s, r, done)["evidence"]["observed"])
    assert "email" not in text and "x@example" not in text
    assert "unguarded" not in text and "duplicate_aggregation" not in text


# -- the clarification question goes through the same disclosure check as an answer -----------------


@pytest.mark.parametrize(
    ("preset", "declared", "domain"),
    [
        ("hidden", False, False),
        ("structure", False, True),
        ("rules", True, False),
        ("full", True, True),
    ],
)
@needs_policy_runtime
def test_the_clarification_lists_only_what_its_evidence_kinds_allow(
    service, monkeypatch, preset, declared, domain
):
    s = service(profile="adhoc", example_presets=True, preset=preset)
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    response = s.execute(r)
    text = response["question"]
    assert response["status"] == "needs_clarification"
    assert ("規則預設只納入" in text) is declared
    assert all(v in text for v in ("cancelled", "pending")) is domain
    assert ("paid" in text) is (declared or domain)
    if declared and not domain:
        assert "shipped" in text and "cancelled" not in text and "pending" not in text
    if not declared and not domain:
        assert text == "請指定要分析的訂單狀態"
    sent = events_named(s, "clarification_sent")
    assert sent == [
        {
            "t": sent[0]["t"],
            "event": "clarification_sent",
            "request_id": "one",
            "rule": RULE,
            "disclosure": {"set": declared, "domain": domain},
        }
    ]
    asked = [
        e
        for e in s.audit
        if e.get("action") == "receive_answer"
        and e.get("kind")
        in {
            "answer.evidence.checks",
            "answer.evidence.observed",
        }
    ]
    assert {e["kind"]: e["allowed"] for e in asked} == {
        "answer.evidence.checks": declared,
        "answer.evidence.observed": domain,
    }


@needs_policy_runtime
def test_the_second_asking_of_the_question_follows_the_same_policy(
    service, monkeypatch
):
    s = service(profile="adhoc", example_presets=True, preset="rules")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    first = s.execute(r)
    second = s.continue_task(answering(first, r.session_id, 1, "two", "refunded"))
    assert second["status"] == "needs_clarification"
    assert second["question"] == first["question"]
    assert [e["request_id"] for e in events_named(s, "clarification_sent")] == [
        "one",
        "two",
    ]
    assert all(
        e["disclosure"] == {"set": True, "domain": False}
        for e in events_named(s, "clarification_sent")
    )


@needs_policy_runtime
def test_each_part_of_the_question_is_decided_on_its_own_kind(service, monkeypatch):
    forbid_checks = (
        'forbid(principal, action == Service::Action::"receive_answer", resource) '
        'when { resource.kind == "answer.evidence.checks" };'
    )
    s = service(profile="adhoc", policy=forbid_checks)
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    r = asking(s, s.open()["session_id"], 0, "one")
    text = s.execute(r)["question"]
    assert "規則預設" not in text and "cancelled" in text
    forbid_observed = forbid_checks.replace("checks", "observed")
    s2 = service(profile="adhoc", policy=forbid_observed)
    worker_sees(monkeypatch, s2, clarifying(PAID, []))
    text = s2.execute(asking(s2, s2.open()["session_id"], 0, "one"))["question"]
    assert "規則預設只納入" in text and "cancelled" not in text


def test_a_denied_clarification_check_does_not_end_the_task(service, monkeypatch):
    s = service(profile="adhoc", example_presets=True, preset="hidden")
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    response = s.execute(asking(s, s.open()["session_id"], 0, "one"))
    assert response["status"] == "needs_clarification"


def test_the_analysis_definition_question_is_fixed_text_and_needs_no_disclosure(
    service, monkeypatch
):
    s = service(profile="adhoc", example_presets=True, preset="hidden")
    worker_sees(
        monkeypatch, s, lambda cb: cb("clarify", {"missing": "analysis_definition"})
    )
    response = s.execute(asking(s, s.open()["session_id"], 0, "one"))
    assert response["question"] == "請補充您要分析的指標、日期範圍或業務定義。"
    assert not events_named(s, "clarification_sent")


def test_the_clarify_tool_names_both_things_a_worker_may_ask_for(service):
    s = service(runtime_path=FAKE_RUNTIME)
    clarify = next(
        t for t in s.ipc.call("echo_init")["tools"] if t["name"] == "clarify"
    )
    assert clarify["parameters"]["properties"]["missing"]["enum"] == [
        "analysis_definition",
        "status_scope",
    ]


# -- describe_data answers "what data is there" in the hidden mode and the ad-hoc profile ------------


@pytest.mark.parametrize(
    ("profile", "capability"), [("analysis", "orders"), ("adhoc", "analytics")]
)
@needs_policy_runtime
def test_describe_data_answers_what_data_exists_with_no_column_names(
    service, monkeypatch, profile, capability
):
    s = service(profile=profile, example_presets=True, preset="hidden")
    install_invoker(
        monkeypatch, s, lambda cb: {"evidence": cb("describe_data", {})["evidence"]}
    )
    done = s.execute(ask_request(s, capability))
    assert done["status"] == "completed" and done["result"]["kind"] == "text"
    for column in (
        "is_test",
        "email",
        "customer_id",
        "order_date",
        "rate_to_usd",
        "invoice_date",
    ):
        assert column not in done["result"]["text"]
    assert done["evidence"] == {
        "mandatory_scope": {},
        "applied_period": None,
        "checks_summary": "none_applicable",
        "has_unverified_semantics": False,
    }


# -- the usage of every model call, from the runtime's `calls` ------------------------------------

CALL = {
    "turn": 1,
    "elapsedMs": 12,
    "input": 100,
    "output": 20,
    "reasoning": 3,
    "cacheRead": 50,
    "stopReason": "tooluse",
    "rawStopReason": "tool_calls",
    "toolCalls": 1,
    "status": "ok",
}
SECOND_CALL = {
    **CALL,
    "turn": 2,
    "output": 7,
    "stopReason": "stop",
    "rawStopReason": "stop",
    "toolCalls": 0,
}
RETRIED = {
    "turn": 1,
    "elapsedMs": 4,
    "input": 0,
    "output": 0,
    "reasoning": 0,
    "cacheRead": 0,
    "stopReason": "",
    "rawStopReason": "",
    "toolCalls": 0,
    "status": "http_429",
}
MODEL_CALL_FIELDS = {
    "t",
    "event",
    "request_id",
    "turn",
    "elapsed_ms",
    "input",
    "output",
    "reasoning",
    "cache_read",
    "stop_reason",
    "raw_stop_reason",
    "tool_calls",
    "status",
}


def scripted(steps, **extra):
    return json.dumps({"behavior": "script", "steps": steps, "sql": 1, **extra})


def run_count_step():
    return {"tool": "run_sql", "args": {"sql": COUNTS["orders"]}}


def scripted_ask(s, question, request_id="ask-1"):
    return Ask(
        session_id=s.open()["session_id"],
        request_id=request_id,
        expected_revision=0,
        capability="orders",
        question=question,
    )


def audit_names(s):
    return [e["event"] for e in s.audit if "event" in e]


def test_each_provider_attempt_the_runtime_reports_is_one_model_call_event(service):
    s = service(runtime_path=FAKE_RUNTIME)
    done = s.execute(
        scripted_ask(
            s, scripted([run_count_step()], calls=[RETRIED, CALL, SECOND_CALL])
        )
    )
    assert done["status"] == "completed"
    events = events_named(s, "model_call")
    assert [e["turn"] for e in events] == [1, 1, 2]
    assert [e["status"] for e in events] == ["http_429", "ok", "ok"]
    for event in events:
        assert set(event) == MODEL_CALL_FIELDS and event["request_id"] == "ask-1"
    assert events[1] == {
        "t": events[1]["t"],
        "event": "model_call",
        "request_id": "ask-1",
        "turn": 1,
        "elapsed_ms": 12,
        "input": 100,
        "output": 20,
        "reasoning": 3,
        "cache_read": 50,
        "stop_reason": "tooluse",
        "raw_stop_reason": "tool_calls",
        "tool_calls": 1,
        "status": "ok",
    }
    names = audit_names(s)
    assert names.index("private_sql") < names.index("model_call")
    assert max(i for i, n in enumerate(names) if n == "model_call") < names.index(
        "task_completed"
    )
    assert not events_named(s, "model_calls_dropped")


def test_the_usage_never_reaches_the_planner_the_evidence_or_a_later_prompt(
    service, monkeypatch
):
    s = service(runtime_path=FAKE_RUNTIME)
    r = scripted_ask(s, scripted([run_count_step()], calls=[CALL, SECOND_CALL]))
    done = s.execute(r)
    assert "model_call" in audit_names(s)
    public = json.dumps(
        [
            done,
            s.evidence(Ref(session_id=r.session_id, evidence_ref=done["evidence_ref"])),
        ]
    )
    for word in (
        "tooluse",
        "tool_calls",
        "elapsed",
        "cacheRead",
        "cache_read",
        "stop_reason",
    ):
        assert word not in public, word
    # The question carries the scripted payload, so look at what the host keeps apart from it.
    saved = dict(s.sessions[r.session_id]["results"][done["result_ref"]])
    del saved["question"]
    assert "tooluse" not in json.dumps(saved) and "elapsed" not in json.dumps(saved)
    seen = []
    worker_sees(monkeypatch, s, finishing(COUNTS["orders"]), seen)
    follow_up = Ask(
        session_id=r.session_id,
        request_id="ask-2",
        expected_revision=done["revision"],
        capability="orders",
        question="again",
        reply_to=done["result_ref"],
    )
    s.execute(follow_up)
    assert set(seen[0]["previous"]) == {
        "kind",
        "columns",
        "rows",
        "mandatory_scope",
        "timezone",
        "original_question",
    }


def test_an_entry_the_host_cannot_vouch_for_is_dropped_and_counted(service):
    bad = [
        {**CALL, "extra": 1},
        {**CALL, "turn": True},
        {**CALL, "status": "x" * 33},
        {**CALL, "stopReason": "Tool Use"},
        {**CALL, "output": -1},
        {**CALL, "elapsedMs": 1.5},
        {k: v for k, v in CALL.items() if k != "reasoning"},
        "ok",
        None,
    ]
    s = service(runtime_path=FAKE_RUNTIME)
    done = s.execute(scripted_ask(s, scripted([run_count_step()], calls=[CALL, *bad])))
    assert done["status"] == "completed"
    assert [e["turn"] for e in events_named(s, "model_call")] == [1]
    assert events_named(s, "model_calls_dropped")[0]["count"] == len(bad)
    garbled = service(runtime_path=FAKE_RUNTIME)
    garbled.execute(scripted_ask(garbled, scripted([run_count_step()], calls={"a": 1})))
    assert not events_named(garbled, "model_call")
    assert events_named(garbled, "model_calls_dropped")[0]["count"] == 1


def test_a_runtime_that_reports_no_usage_is_not_an_error(service):
    s = service(runtime_path=FAKE_RUNTIME)
    done = s.execute(scripted_ask(s, scripted([run_count_step()])))
    assert done["status"] == "completed"
    assert not events_named(s, "model_call") and not events_named(
        s, "model_calls_dropped"
    )


def test_a_failed_task_logs_its_calls_first_then_the_counters_and_the_runtime_code(
    service,
):
    s = service(runtime_path=FAKE_RUNTIME)
    fail = {
        "diagnostic": "turn_limit",
        "calls": [CALL, SECOND_CALL],
        "turns": 12,
        "toolCalls": 7,
    }
    r = scripted_ask(s, scripted([run_count_step()], fail=fail))
    out = asyncio.run(safe(s.execute, r))
    assert out == {"status": "unavailable", "reason": "worker"}
    names = audit_names(s)
    assert [e["turn"] for e in events_named(s, "model_call")] == [1, 2]
    assert names.index("model_call") < names.index("task_failed")
    failed = events_named(s, "task_failed")[-1]
    assert failed["reason"] == "runtime_unavailable"
    assert failed["detail"] == "service_unavailable:turn_limit"
    assert (failed["turns"], failed["tool_calls"], failed["sql_attempts"]) == (12, 7, 1)


def test_counters_that_are_not_plain_integers_are_recorded_as_unknown(service):
    s = service(runtime_path=FAKE_RUNTIME)
    fail = {"diagnostic": "deadline", "calls": [], "turns": "12", "toolCalls": True}
    asyncio.run(safe(s.execute, scripted_ask(s, scripted([], fail=fail))))
    failed = events_named(s, "task_failed")[-1]
    assert (failed["turns"], failed["tool_calls"], failed["sql_attempts"]) == (
        None,
        None,
        0,
    )
    assert failed["detail"] == "service_unavailable:deadline"


def test_a_task_the_host_ends_reports_its_attempts_but_no_runtime_counters(
    service, monkeypatch
):
    s = service(profile="adhoc", example_presets=True, preset="hidden")

    def invoke(callback):
        for _ in range(3):
            callback("run_sql", {"sql": "SELECT COUNT(*) FROM orders"})

    worker_sees(monkeypatch, s, invoke)
    with pytest.raises(BudgetExhausted):
        s.execute(asking(s, s.open()["session_id"], 0, "one"))
    failed = events_named(s, "task_failed")[-1]
    assert failed["detail"] == "budget_exhausted:rejected"
    assert (failed["turns"], failed["tool_calls"], failed["sql_attempts"]) == (
        None,
        None,
        3,
    )


def test_a_denied_task_still_says_how_many_statements_it_tried(service, monkeypatch):
    s = service(profile="adhoc")

    def invoke(callback):
        callback("run_sql", {"sql": "SELECT COUNT(*) FROM orders"})
        callback("run_sql", {"sql": "SELECT email FROM customers"})

    worker_sees(monkeypatch, s, invoke)
    with pytest.raises(PermissionError):
        s.execute(asking(s, s.open()["session_id"], 0, "one"))
    failed = events_named(s, "task_failed")[-1]
    assert failed["reason"] == "denied" and failed["sql_attempts"] == 2


def test_an_invalid_evidence_failure_carries_the_same_counters(service, monkeypatch):
    s = service()
    install_invoker(monkeypatch, s, lambda callback: {"value": 1})
    with pytest.raises(ValueError, match="invalid_evidence"):
        s.execute(ask_request(s))
    failed = events_named(s, "task_failed")[-1]
    assert (failed["turns"], failed["tool_calls"], failed["sql_attempts"]) == (
        None,
        None,
        0,
    )


# -- the same, against the real runtime and a local stand-in for the model platform ----------------


def runtime_reports_calls():
    """True for a runtime build that sends per-attempt usage (``rawStopReason`` is in its code)."""
    dist = Path(os.environ["WARBLE_SERVICE"]).parent
    return any("rawStopReason" in p.read_text() for p in dist.glob("*.js"))


class StubProvider:
    """A local OpenAI-compatible streaming endpoint, standing in for the model platform."""

    def __init__(self, respond):
        outer = self
        self.requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append(body)
                respond(len(outer.requests) - 1, body, self)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def base_url(self):
        return f"http://127.0.0.1:{self.server.server_address[1]}/v1"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def stream(handler, events, usage=None):
    handler.send_response(200)
    handler.send_header("content-type", "text/event-stream")
    handler.send_header("connection", "close")
    handler.end_headers()
    for index, (delta, finish) in enumerate(events):
        chunk = {
            "id": "stub",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "stub",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        }
        if usage and index == len(events) - 1:
            chunk["usage"] = usage
        handler.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
    handler.wfile.write(b"data: [DONE]\n\n")


def scripted_model(sql):
    """The root delegates once; the worker runs ``sql`` and answers with the host's token."""

    def respond(n, body, handler):
        names = [t["function"]["name"] for t in body.get("tools") or []]
        tool_results = [m for m in body["messages"] if m.get("role") == "tool"]
        usage = {"prompt_tokens": 100 + n, "completion_tokens": 10}
        if tool_results:
            token = re.findall(
                r"[0-9a-f]{8}-[0-9a-f-]{27}", str(tool_results[-1]["content"])
            )[0]
            return stream(
                handler,
                [
                    ({"role": "assistant"}, None),
                    ({"content": json.dumps({"evidence": token})}, None),
                    ({}, "stop"),
                ],
                usage,
            )
        name, args = (
            ("run_sql", {"sql": sql})
            if "run_sql" in names
            else (names[0], {"request": "go"})
        )
        call = {
            "index": 0,
            "id": f"call-{n}",
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)},
        }
        stream(
            handler,
            [
                ({"role": "assistant"}, None),
                ({"tool_calls": [call]}, None),
                ({}, "tool_calls"),
            ],
            usage,
        )

    return respond


@pytest.fixture
def real_runtime_service(service, monkeypatch):
    monkeypatch.setenv("PRIVATE_MODEL_KEY", "stub")
    stubs = []

    def make(respond, execution=None, **kwargs):
        stub = StubProvider(respond)
        stubs.append(stub)
        updates = {
            "private_model": {
                "id": "stub",
                "base_url": stub.base_url,
                "credential_env": "PRIVATE_MODEL_KEY",
            },
            "execution": execution or {"deadline_ms": 30000},
        }
        return service(mode="agent", updates=updates, **kwargs), stub

    yield make
    for stub in stubs:
        stub.close()


@needs_policy_runtime
def test_the_real_runtime_reports_usage_for_a_completed_task(real_runtime_service):
    s, stub = real_runtime_service(scripted_model(COUNTS["orders"]))
    r = ask_request(s)
    done = s.execute(r)
    assert done["status"] == "completed" and done["result"]["rows"] == [{"c1": 12}]
    events = events_named(s, "model_call")
    if not runtime_reports_calls():
        assert events == []
        return
    # one worker call that asked for the tool, one that answered, then the same for the root
    assert len(events) == len(stub.requests) == 4
    assert [e["stop_reason"] for e in events] == ["tooluse", "stop", "tooluse", "stop"]
    assert all(e["status"] == "ok" and e["output"] == 10 for e in events)
    assert sorted(e["input"] for e in events) == [100, 101, 102, 103]
    assert not events_named(s, "model_calls_dropped")
    names = audit_names(s)
    assert max(i for i, n in enumerate(names) if n == "model_call") < names.index(
        "task_completed"
    )
    assert "stub" not in json.dumps(done) and "elapsed" not in json.dumps(done)


@needs_policy_runtime
def test_the_real_runtime_reports_each_retried_provider_attempt(real_runtime_service):
    def refuse(n, body, handler):
        handler.send_response(429 if n == 0 else 503)
        handler.send_header("retry-after-ms", "50")
        handler.send_header("connection", "close")
        handler.end_headers()
        handler.wfile.write(b'{"error": {"message": "PROVIDER_TEXT"}}')

    s, stub = real_runtime_service(
        refuse,
        {
            "deadline_ms": 30000,
            "provider_max_retries": 1,
            "provider_max_retry_delay_ms": 100,
        },
    )
    out = asyncio.run(safe(s.execute, ask_request(s)))
    assert out == {"status": "unavailable", "reason": "provider"}
    failed = events_named(s, "task_failed")[-1]
    assert failed["detail"] == "service_unavailable:provider_http"
    assert "PROVIDER_TEXT" not in json.dumps(s.audit)
    if not runtime_reports_calls():
        assert not events_named(s, "model_call")
        return
    assert [e["status"] for e in events_named(s, "model_call")] == [
        "http_429",
        "http_503",
    ]
    assert (failed["turns"], failed["tool_calls"], failed["sql_attempts"]) == (1, 0, 0)
    names = audit_names(s)
    assert names.index("model_call") < names.index("task_failed")


# -- the coarse reason of an unavailable task, from the runtime's exact code -----------------------

RUNTIME_CODES = {
    "provider_http": "provider",
    "provider_stream": "provider",
    "model_error": "provider",
    "deadline": "timeout",
    "cancelled": "timeout",
    "invalid_json": "worker",
    "empty_output": "worker",
    "turn_limit": "worker",
    "incomplete_child": "worker",
    "model_length": "worker",
    "output_limit": "worker",
    "request_limit": "worker",
    "response_limit": "worker",
    "missing_response": "worker",
    "tool_failure": "worker",
    "destination_denied": "worker",
    "child_exit": "worker",
    "protocol": "worker",
}
HOST_CODES = {
    "ipc_timeout:host": "timeout",
    "budget_exhausted:rejected": "worker",
    "budget_exhausted:undetermined": "worker",
    "budget_exhausted:query_unavailable": "worker",
    "budget_exhausted:sql_attempts": "worker",
    "status_scope_unresolved": "worker",
    "invalid_evidence": "worker",
}


def failure_with(detail):
    failure = RuntimeError("runtime_unavailable")
    if detail is not None:
        failure.detail = detail
    return failure


@pytest.mark.parametrize(("code", "reason"), sorted(RUNTIME_CODES.items()))
def test_every_runtime_failure_code_has_one_coarse_reason(code, reason):
    assert unavailable_reason(failure_with(f"service_unavailable:{code}")) == reason


@pytest.mark.parametrize(
    "detail",
    [
        "service_unavailable",
        "service_unavailable:something_new",
        "service_unavailable:unsupported_limit:reasoningBudgetTokens",
        "runtime_unavailable",
        "provider_http 429",
        None,
    ],
)
def test_anything_the_table_does_not_name_is_a_service_failure(detail):
    assert unavailable_reason(failure_with(detail)) == "service"


def test_the_host_ended_tasks_map_to_the_coarse_reasons_the_readme_lists():
    assert unavailable_reason(failure_with("ipc_timeout:host")) == "timeout"
    for kind in ("rejected", "undetermined", "query_unavailable", "sql_attempts"):
        assert unavailable_reason(BudgetExhausted(kind, 3)) == "worker"
    assert unavailable_reason(StatusScopeUnresolved()) == "worker"
    assert unavailable_reason(ValueError("invalid_evidence")) == "worker"
    union = set().union(*UNAVAILABLE_REASONS.values())
    assert union - {"host"} == set(RUNTIME_CODES)


def test_the_readme_table_matches_the_code_to_reason_mapping():
    text = (EXAMPLES / "README.md").read_text()
    rows = dict(
        re.findall(
            r"^\| `([a-z_:]+)` \| (provider|timeout|worker|service) \|", text, re.M
        )
    )
    assert {**RUNTIME_CODES, **HOST_CODES} == rows


def test_plain_serve_mcp_refuses_a_warble_path_it_would_ignore(tmp_path):
    from typer.testing import CliRunner  # noqa: PLC0415

    from wren.serve_cli import serve_app  # noqa: PLC0415

    out = CliRunner().invoke(serve_app, ["mcp", "--warble", str(tmp_path / "warble")])
    assert out.exit_code == 1
    assert "--warble" in out.output and "--service-config" in out.output


def test_a_missing_service_config_is_a_controlled_error(tmp_path):
    from typer.testing import CliRunner  # noqa: PLC0415

    from wren.serve_cli import serve_app  # noqa: PLC0415

    missing = CliRunner().invoke(
        serve_app, ["agent-presets", "--service-config", str(tmp_path / "absent.yml")]
    )
    assert missing.exit_code == 1
    assert isinstance(missing.exception, SystemExit)
    assert "Cannot read service config" in missing.output


def test_malformed_presets_yaml_is_a_controlled_cli_error(tmp_path):
    import yaml  # noqa: PLC0415
    from typer.testing import CliRunner  # noqa: PLC0415

    from wren.cli import app  # noqa: PLC0415

    path = tmp_path / "malformed.yml"
    path.write_text("policy_presets: [not closed")
    result = CliRunner().invoke(
        app, ["serve", "agent-presets", "--service-config", str(path)]
    )
    assert result.exit_code == 1
    assert "Cannot parse service config YAML." in result.output
    assert not isinstance(result.exception, yaml.YAMLError)


def test_authorization_wait_is_inside_the_task_deadline(service, monkeypatch):
    from dataclasses import replace  # noqa: PLC0415

    instance = service(runtime_path=FAKE_RUNTIME)
    value = sql_request(instance, "SELECT COUNT(*) FROM customers")
    instance.execution = replace(instance.execution, deadline_ms=300)
    original = instance.ipc._send

    def delayed(frame):
        if frame.get("op") == "authorize":
            frame["request"]["__test_delay_ms"] = 800
        return original(frame)

    monkeypatch.setattr(instance.ipc, "_send", delayed)
    started = time.monotonic()
    result = asyncio.run(safe(instance.execute, value, direct={"sql": value.sql}))
    assert time.monotonic() - started < 0.7
    assert result == {"status": "unavailable", "reason": "timeout"}
    assert not instance.sessions[value.session_id]["results"]


def test_close_interrupts_authorization_and_keeps_the_shared_runtime(
    service, monkeypatch
):
    instance = service(runtime_path=FAKE_RUNTIME)
    request = sql_request(instance, "SELECT COUNT(*) FROM customers")
    session = instance.sessions[request.session_id]
    entered = threading.Event()
    original = instance.ipc._send

    def delay_authorization(frame):
        if frame.get("op") == "authorize":
            frame["request"]["__test_delay_ms"] = 5000
            original(frame)
            entered.set()
        else:
            original(frame)

    monkeypatch.setattr(instance.ipc, "_send", delay_authorization)
    outcome = []

    def execute():
        outcome.append(
            asyncio.run(safe(instance.execute, request, direct={"sql": request.sql}))
        )

    thread = threading.Thread(target=execute)
    thread.start()
    try:
        assert entered.wait(5)
        instance.close(request.session_id)
        thread.join(0.7)
        assert not thread.is_alive()
        assert session["lock"].acquire(blocking=False)
        session["lock"].release()
        assert not session["results"] and not session["evidence"]
        monkeypatch.setattr(instance.ipc, "_send", original)
        assert instance.ipc.call("authorize", request={}) is True
        assert instance.ipc.process.poll() is None
    finally:
        instance.ipc.close()
        thread.join(5)


@pytest.mark.parametrize(
    "text", ["", "# comment only\n", "[]", "a string", "123", "true"]
)
def test_agent_presets_rejects_non_mapping_yaml_as_controlled_error(tmp_path, text):
    from typer.testing import CliRunner  # noqa: PLC0415

    from wren.serve_cli import serve_app  # noqa: PLC0415

    config = tmp_path / "config.yml"
    config.write_text(text)
    result = CliRunner().invoke(
        serve_app, ["agent-presets", "--service-config", str(config)]
    )
    assert result.exit_code == 1
    assert isinstance(result.exception, SystemExit)
    assert "Invalid presets: invalid_service_config." in result.output


def test_agent_presets_empty_mapping_remains_valid(tmp_path):
    from typer.testing import CliRunner  # noqa: PLC0415

    from wren.serve_cli import serve_app  # noqa: PLC0415

    config = tmp_path / "config.yml"
    config.write_text("{}")
    result = CliRunner().invoke(
        serve_app, ["agent-presets", "--service-config", str(config)]
    )
    assert result.exit_code == 0
    assert json.loads(result.output) == {"default": None, "presets": []}


@pytest.mark.parametrize("retry", [False, True])
def test_status_scopes_survive_two_clarifications_and_follow_up(
    service, monkeypatch, tmp_path, retry
):
    extra = tmp_path / "fixture/project/knowledge/rules/z-second-status.md"
    extra.write_text(
        "---\ndefaults:\n  - id: second-status\n    kind: sale_statuses\n    column: orders.status\n    values: [shipped]\n    overridable_by_caller: true\n---\nAnother declared status comparison.\n"
    )
    s = service(profile="adhoc", runtime_path=FAKE_RUNTIME)
    session = s.open()["session_id"]
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    first = s.execute(asking(s, session, 0, "one"))
    second = s.continue_task(answering(first, session, 1, "two", "paid"))
    assert second["status"] == "needs_clarification"
    assert s.sessions[session]["pending"][second["continuation_ref"]][
        "status_scopes"
    ] == {RULE: ["paid"]}
    revision = 2
    if retry:
        second = s.continue_task(
            answering(second, session, revision, "retry", "unknown status")
        )
        revision += 1
        assert second["status"] == "needs_clarification"
    worker_sees(monkeypatch, s, finishing(PAID))
    done = s.continue_task(answering(second, session, revision, "three", "paid"))
    assert done["status"] == "completed"
    for rule in (RULE, "second-status"):
        assert internal_of(s, done)["checks"][rule] == {
            "applicable": True,
            "result": "satisfied_by_caller_scope",
            "scope": ["paid"],
        }
    follow = s.execute(asking(s, session, revision + 1, "four", done["result_ref"]))
    assert follow["status"] == "completed"
    assert all(
        internal_of(s, follow)["checks"][rule]["result"] == "satisfied_by_caller_scope"
        for rule in (RULE, "second-status")
    )


def test_restored_status_scope_cannot_introduce_unconfirmed_domain_values(
    service, monkeypatch
):
    s = service(profile="adhoc", runtime_path=FAKE_RUNTIME)
    session = s.open()["session_id"]
    worker_sees(monkeypatch, s, clarifying(PAID, []))
    first = s.execute(asking(s, session, 0, "one"))
    pending = s.sessions[session]["pending"][first["continuation_ref"]]
    pending["status_scopes"] = {RULE: ["not-a-declared-status"]}
    with pytest.raises(ValueError, match="context_changed"):
        s.continue_task(answering(first, session, 1, "two", "paid"))
    assert not events_named(s, "private_sql")


@pytest.mark.parametrize("default", [[], {}, 1, False])
def test_default_policy_preset_requires_string_before_lookup(default):
    with pytest.raises(ValueError, match="invalid_policy_preset"):
        read_policy_presets({"default_preset": default})


@pytest.mark.parametrize(
    "failure,expected",
    [
        ("cancel", {"status": "unavailable", "reason": "timeout"}),
        ("deadline", {"status": "unavailable", "reason": "timeout"}),
        ("changed", {"status": "context_changed"}),
        ("typed_changed", {"status": "context_changed"}),
    ],
)
def test_direct_query_terminal_errors_do_not_become_engine_rewrites(
    service, monkeypatch, failure, expected
):
    from wren.context_adapter import ContextChanged  # noqa: PLC0415
    from wren.governed_query import QueryCancelled  # noqa: PLC0415
    from wren.model.error import DatabaseTimeoutError  # noqa: PLC0415

    s = service(runtime_path=FAKE_RUNTIME)
    errors = {
        "cancel": QueryCancelled("query_cancelled"),
        "deadline": DatabaseTimeoutError("deadline"),
        "changed": ValueError("context_changed"),
        "typed_changed": ContextChanged("private source changed"),
    }

    def fail(prepared):
        raise errors[failure]

    monkeypatch.setattr(s.sql, "execute", fail)
    result = sent(s, sql_request(s, JOINED))
    assert result == expected
    assert not events_named(s, "private_sql_failed")


@pytest.mark.parametrize("close_fails", [False, True])
def test_service_constructor_failure_closes_its_actual_runtime_and_keeps_primary_error(
    service, monkeypatch, close_fails
):
    import wren.agent_service as module  # noqa: PLC0415

    made = []
    original = module.RuntimeIPC

    def create(*args, **kwargs):
        runtime = original(*args, **kwargs)
        made.append(runtime)
        close = runtime.close

        def cleanup():
            close()
            if close_fails:
                raise RuntimeError("cleanup failure")

        monkeypatch.setattr(runtime, "close", cleanup)
        return runtime

    def fail_constructor(*args, **kwargs):
        raise RuntimeError("constructor failure")

    monkeypatch.setattr(module, "RuntimeIPC", create)
    monkeypatch.setattr(module, "Service", fail_constructor)
    try:
        with pytest.raises(RuntimeError, match="constructor failure"):
            service(runtime_path=FAKE_RUNTIME)
        assert len(made) == 1
        assert made[0].process.poll() is not None
        assert not made[0].reader.is_alive()
    finally:
        for runtime in made:
            try:
                runtime.close()
            except RuntimeError:
                pass


@pytest.mark.parametrize("timing", ["before", "after"])
def test_source_edit_during_final_startup_fingerprint_cannot_anchor_stale_catalog(
    service, monkeypatch, timing
):
    import wren.agent_service as module  # noqa: PLC0415
    from wren.context_adapter import ContextChanged  # noqa: PLC0415

    original = module.Project.fingerprint
    changed = []
    spawned = []
    create_ipc = module.RuntimeIPC

    def capture_ipc(*args, **kwargs):
        spawned.append(True)
        return create_ipc(*args, **kwargs)

    def fingerprint(project):
        final = any(path.name == "policy-0.cedar" for path in project.paths)

        def edit():
            rule = project.root / "knowledge/rules/conventions.md"
            rule.write_text(rule.read_text() + "\nChanged after catalog capture.\n")
            changed.append(True)

        if final and not changed and timing == "before":
            edit()
        value = original(project)
        if final and not changed and timing == "after":
            edit()
        return value

    monkeypatch.setattr(module.Project, "fingerprint", fingerprint)
    monkeypatch.setattr(module, "RuntimeIPC", capture_ipc)
    with pytest.raises(ContextChanged):
        service(runtime_path=FAKE_RUNTIME)
    assert changed
    assert not spawned


@pytest.mark.parametrize(
    "idle", ["abc", "1800", None, True, [], {}, float("nan"), float("inf")]
)
def test_idle_seconds_invalid_values_fail_config_validation(idle):
    from wren.agent_service import check_service_config  # noqa: PLC0415

    config = {
        "config_version": 2,
        "caller": "planner",
        "project_id": "fixture",
        "policy": "policy.cedar",
        "private_model": {},
    }
    config["idle_seconds"] = idle
    with pytest.raises(ValueError, match="invalid_service_config: idle_seconds"):
        check_service_config(config)


@pytest.mark.parametrize("idle", [0, -1, 0.5, 1800])
def test_numeric_idle_seconds_and_omitted_default_remain_valid(idle):
    from wren.agent_service import check_service_config  # noqa: PLC0415

    config = {
        "config_version": 2,
        "caller": "planner",
        "project_id": "fixture",
        "policy": "policy.cedar",
        "private_model": {},
    }
    config.pop("idle_seconds", None)
    check_service_config(config)
    check_service_config({**config, "idle_seconds": idle})


@pytest.mark.parametrize("restore_disk", [False, True])
def test_engine_manifest_replacement_cannot_anchor_a_different_snapshot(
    service, monkeypatch, restore_disk
):
    import wren.agent_service as module  # noqa: PLC0415
    from wren.context_adapter import ContextChanged  # noqa: PLC0415

    original = module.open_engine
    engines = []

    def replace_then_open(root, *args):
        path = root / "target/mdl.json"
        before = path.read_text()
        manifest = json.loads(before)
        manifest["models"][0]["refSql"] = (
            "SELECT * FROM ("
            + manifest["models"][0]["refSql"]
            + ") changed WHERE FALSE"
        )
        path.write_text(json.dumps(manifest))
        engine = original(root, *args)
        engines.append(engine)
        if restore_disk:
            path.write_text(before)
        return engine

    monkeypatch.setattr(module, "open_engine", replace_then_open)
    try:
        with pytest.raises(ContextChanged):
            service(runtime_path=FAKE_RUNTIME)
        assert engines
    finally:
        for engine in engines:
            engine.close()


@needs_policy_runtime
@pytest.mark.parametrize(
    "preset,selected",
    [("structure", {"structure"}), ("rules", {"rules"}), ("hidden", set())],
)
def test_adhoc_planner_metadata_still_obeys_preset_selection(service, preset, selected):
    s = service(profile="adhoc", example_presets=True, preset=preset)
    visible = {d["id"] for d in s.capabilities_public()["metadata_documents"]}
    assert visible == selected
    if selected:
        documents = s.metadata(None, sorted(selected), "planner")
        assert {d["id"] for d in documents} == selected
    assert not s.allowed(None, "receive_metadata", "schema.denied", "unknown")
