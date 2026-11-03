"""How the host ends a task: authorization failure, spent budgets, and what a runtime that
carries on afterwards can still do. The runtime is the scripted fake in
``fixtures/fake_runtime.js``: it calls tools in order whatever they answer and finally replies
a token, as a runtime that has not noticed a cancel yet would."""

import asyncio
import importlib.util
import json
import os
import time
from pathlib import Path

import pytest

pytest.importorskip("mcp")
from wren.agent_service import Ask, Continue, create_service, safe  # noqa: E402
from wren.context_adapter import ContextLoaderUnavailable, resolve_loader  # noqa: E402

EXAMPLES = Path(__file__).resolve().parents[4] / "examples/serve-agent"
FAKE_RUNTIME = Path(__file__).parent / "fixtures/fake_runtime.js"

GOOD = "SELECT COUNT(*) FROM customers"
ORDERS = (
    "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')"
)
REJECTED = (
    "SELECT SUM(amt) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')"
)
ENGINE_FAILS = "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped') AND CAST('abc' AS INTEGER) = 1"


@pytest.fixture
def scripted(tmp_path):
    compiler = os.getenv("WARBLE_BIN")
    if not compiler:
        pytest.skip("Set WARBLE_BIN")
    try:
        resolve_loader()
    except ContextLoaderUnavailable:
        pytest.skip("build core/wren-context-loader or set WREN_CONTEXT_LOADER_BIN")
    spec = importlib.util.spec_from_file_location("gate_setup", EXAMPLES / "setup.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    services = []

    def make(execution=None):
        dest = tmp_path / f"fixture{len(services)}"
        module.prepare_adhoc(dest)
        root = dest / "project"
        if execution:
            import yaml  # noqa: PLC0415

            config = yaml.safe_load((root / "service.yml").read_text())
            config["execution"] = execution
            (root / "service.yml").write_text(yaml.safe_dump(config))
        s = create_service(
            root,
            EXAMPLES / "profiles/adhoc",
            root / "service.yml",
            FAKE_RUNTIME,
            compiler,
        )
        services.append(s)
        return s

    yield make
    for s in services:
        s.shutdown()


def script(*statements):
    steps = [{"tool": "run_sql", "args": {"sql": sql}} for sql in statements]
    return json.dumps({"behavior": "script", "steps": steps})


def ask(s, *statements, session=None, revision=0, request_id="one"):
    return Ask(
        session_id=session or s.open()["session_id"],
        request_id=request_id,
        expected_revision=revision,
        capability="analytics",
        question=script(*statements),
    )


def events(s, name=None):
    return [e for e in s.audit if name is None or e.get("event") == name]


def runtime_ops(s):
    return s.ipc.call("ops")


def wait_for_tool_results(s, count, seconds=10):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        results = [o for o in runtime_ops(s) if o.get("type") == "tool_result"]
        if len(results) >= count:
            return results
        time.sleep(0.05)
    raise AssertionError(f"the runtime made fewer than {count} tool calls")


DENIED_SHAPES = [
    "SELECT email FROM customers",
    "WITH a AS (SELECT email FROM customers) SELECT COUNT(*) FROM a",
    "SELECT COUNT(*) FROM (SELECT email FROM customers) t",
    "SELECT * FROM customers",
]


@pytest.mark.parametrize("denied", DENIED_SHAPES)
def test_a_denied_column_ends_the_task_and_a_late_token_is_dropped(scripted, denied):
    s = scripted()
    r = ask(s, GOOD, denied, GOOD)
    with pytest.raises(PermissionError, match="denied"):
        s.execute(r)
    failed = events(s, "task_failed")
    assert [(e["reason"], e["detail"]) for e in failed] == [
        ("denied", "query_denied:denied_column")
    ]
    # Only the statement before the denial ran; the denied one never reached the engine.
    assert len(events(s, "private_sql")) == 1
    assert all(denied != e["sql"] for e in events(s, "private_sql"))
    for name in (
        "private_sql_rejected",
        "private_sql_failed",
        "private_sql_budget_exhausted",
        "task_completed",
    ):
        assert not events(s, name)
    session = s.sessions[r.session_id]
    assert session["revision"] == 0 and not session["results"]
    assert not session["evidence"]
    # The runtime was told to cancel, kept calling tools, and handed back a real token.
    assert any(o.get("op") == "cancel" for o in runtime_ops(s))
    results = wait_for_tool_results(s, 3)
    assert [bool(o["error"]) for o in results] == [False, True, True]
    assert s.ipc.process.poll() is None
    follow = s.execute(ask(s, GOOD, session=r.session_id, request_id="two"))
    assert follow["status"] == "completed" and follow["result"]["rows"] == [{"c1": 3}]


def test_a_denied_statement_that_comes_first_never_runs(scripted):
    s = scripted()
    with pytest.raises(PermissionError, match="denied"):
        s.execute(ask(s, "SELECT email FROM customers", GOOD))
    assert not events(s, "private_sql")
    assert [e["detail"] for e in events(s, "task_failed")] == [
        "query_denied:denied_column"
    ]


def test_a_token_returned_after_the_task_ended_is_dropped_even_if_abort_is_ignored(
    scripted, monkeypatch
):
    s = scripted()
    monkeypatch.setattr(s.ipc, "abort", lambda owner: None)
    r = ask(s, GOOD, "SELECT email FROM customers", GOOD)
    with pytest.raises(PermissionError, match="denied"):
        s.execute(r)
    session = s.sessions[r.session_id]
    assert not session["results"] and session["revision"] == 0
    assert not events(s, "task_completed")
    # No cancel was sent: the host's own check is what dropped the token.
    assert not any(o.get("op") == "cancel" for o in runtime_ops(s))


@pytest.mark.parametrize(
    ("sql", "detail"),
    [
        ("DELETE FROM orders", "query_denied:not_read_only"),
        ("SELECT * FROM synthetic.main.raw_orders", "query_denied:external_source"),
        (
            "SELECT * FROM orders o JOIN missing m ON o.id = m.id",
            "query_denied:unknown_model",
        ),
    ],
)
def test_every_authorization_failure_ends_the_task(scripted, sql, detail):
    s = scripted()
    with pytest.raises(PermissionError, match="denied"):
        s.execute(ask(s, sql, GOOD))
    assert [e["detail"] for e in events(s, "task_failed")] == [detail]
    assert any(o.get("op") == "cancel" for o in runtime_ops(s))


def finished(s, request):
    return asyncio.run(safe(s.execute, request))


def exhausted(s):
    return [
        {k: e[k] for k in ("kind", "attempts")}
        for e in events(s, "private_sql_budget_exhausted")
    ]


def test_the_third_rejection_before_execution_ends_the_task(scripted):
    s = scripted()
    out = finished(s, ask(s, REJECTED, REJECTED, REJECTED, GOOD))
    assert out == {"status": "unavailable", "reason": "worker"}
    assert len(events(s, "private_sql_rejected")) == 3
    assert exhausted(s) == [{"kind": "rejected", "attempts": 3}]
    assert [e["detail"] for e in events(s, "task_failed")] == [
        "budget_exhausted:rejected"
    ]
    assert not events(s, "private_sql")
    assert any(o.get("op") == "cancel" for o in runtime_ops(s))


def test_the_second_engine_failure_ends_the_task(scripted):
    s = scripted()
    out = finished(s, ask(s, ENGINE_FAILS, ENGINE_FAILS, GOOD))
    assert out == {"status": "unavailable", "reason": "worker"}
    assert [e["error_class"] for e in events(s, "private_sql_failed")] == [
        events(s, "private_sql_failed")[0]["error_class"]
    ] * 2
    assert exhausted(s) == [{"kind": "query_unavailable", "attempts": 2}]
    assert not events(s, "private_sql")


def test_the_seventh_statement_ends_the_task_at_the_default_total(scripted):
    s = scripted()
    out = finished(s, ask(s, *[GOOD] * 8))
    assert out == {"status": "unavailable", "reason": "worker"}
    assert len(events(s, "private_sql")) == 6
    assert exhausted(s) == [{"kind": "sql_attempts", "attempts": 7}]


def test_the_total_follows_max_sql_attempts(scripted):
    s = scripted(execution={"max_sql_attempts": 2})
    assert finished(s, ask(s, GOOD, GOOD, GOOD)) == {
        "status": "unavailable",
        "reason": "worker",
    }
    assert exhausted(s) == [{"kind": "sql_attempts", "attempts": 3}]


def test_a_statement_the_checker_cannot_judge_is_returned_once(scripted, monkeypatch):
    import wren.agent_sql as agent_sql  # noqa: PLC0415

    monkeypatch.setattr(agent_sql, "evaluate", lambda checker, ast, scopes=None: None)
    s = scripted()
    out = finished(s, ask(s, ORDERS, ORDERS, GOOD))
    assert out == {"status": "unavailable", "reason": "worker"}
    rejected = events(s, "private_sql_rejected")
    assert [(e["code"], e["sub_code"]) for e in rejected] == [
        ("declared_default_undetermined", "no_verdict")
    ] * 2
    assert exhausted(s) == [{"kind": "undetermined", "attempts": 2}]
    assert [e["detail"] for e in events(s, "task_failed")] == [
        "budget_exhausted:undetermined"
    ]
    assert not events(s, "private_sql")


def test_a_continued_task_keeps_its_budget(scripted):
    s = scripted()
    session = s.open()["session_id"]
    asking = json.dumps(
        {
            "behavior": "script",
            "steps": [
                {"tool": "run_sql", "args": {"sql": REJECTED}},
                {"tool": "run_sql", "args": {"sql": REJECTED}},
                {"tool": "clarify", "args": {"missing": "analysis_definition"}},
            ],
        }
    )
    first = s.execute(
        Ask(
            session_id=session,
            request_id="one",
            expected_revision=0,
            capability="analytics",
            question=asking,
        )
    )
    assert first["status"] == "needs_clarification"
    # The continued task replays the original question, so the worker rejects twice more:
    # the third rejection of the task, not the first of a fresh one, ends it.
    out = asyncio.run(
        safe(
            s.continue_task,
            Continue(
                session_id=session,
                request_id="two",
                expected_revision=1,
                continuation_ref=first["continuation_ref"],
                answer="anything",
            ),
        )
    )
    assert out == {"status": "unavailable", "reason": "worker"}
    assert exhausted(s) == [{"kind": "rejected", "attempts": 3}]
    assert len(events(s, "private_sql_rejected")) == 3


def test_a_function_miss_is_rewritten_inside_the_same_task_and_is_not_terminal(
    scripted,
):
    s = scripted()
    out = s.execute(
        ask(
            s,
            "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped') AND order_date < now()",
            ORDERS,
        )
    )
    assert out["status"] == "completed" and out["result"]["rows"] == [{"c1": 12}]
    assert [(e["code"], e["sub_code"]) for e in events(s, "private_sql_rejected")] == [
        ("unsupported_query", "unsupported_function")
    ]
    assert not events(s, "task_failed")
    assert not any(o.get("op") == "cancel" for o in runtime_ops(s))


def test_function_misses_consume_the_rejection_budget(scripted):
    s = scripted()
    miss = (
        "SELECT now() FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')"
    )
    out = finished(s, ask(s, miss, miss, miss, GOOD))
    assert out == {"status": "unavailable", "reason": "worker"}
    assert exhausted(s) == [{"kind": "rejected", "attempts": 3}]
    assert not events(s, "private_sql")


def test_an_unexpected_planner_error_is_not_terminal(scripted, monkeypatch):
    s = scripted()

    def fail(expr):
        raise RuntimeError("boom")

    monkeypatch.setattr(s.sql, "_projection", fail)
    out = finished(s, ask(s, ORDERS, ORDERS, ORDERS))
    assert out == {"status": "unavailable", "reason": "worker"}
    assert [(e["code"], e["sub_code"]) for e in events(s, "private_sql_rejected")] == [
        ("unsupported_query", "unsupported")
    ] * 3
    assert [e["detail"] for e in events(s, "task_failed")] == [
        "budget_exhausted:rejected"
    ]


def test_an_undetermined_statement_counts_toward_the_rejection_total(
    scripted, monkeypatch
):
    import wren.agent_sql as agent_sql  # noqa: PLC0415

    real = agent_sql.evaluate
    calls = []

    def first_undetermined(checker, ast, scopes=None):
        calls.append(1)
        return None if len(calls) == 1 else real(checker, ast, scopes)

    monkeypatch.setattr(agent_sql, "evaluate", first_undetermined)
    s = scripted()
    out = finished(s, ask(s, ORDERS, REJECTED, REJECTED, GOOD))
    assert out == {"status": "unavailable", "reason": "worker"}
    assert [e["code"] for e in events(s, "private_sql_rejected")] == [
        "declared_default_undetermined",
        "unsupported_query",
        "unsupported_query",
    ]
    assert exhausted(s) == [{"kind": "rejected", "attempts": 3}]
    assert not events(s, "private_sql")


def test_real_ipc_success_commits_evidence_before_lifetime_cleanup(scripted):
    service = scripted()
    request = ask(service, GOOD)
    result = service.execute(request)
    assert result["status"] == "completed"
    assert result["result"]["rows"] == [{"c1": 3}]
    assert result["evidence_ref"] in service.sessions[request.session_id]["evidence"]
    assert "query_lifetime" not in service.sessions[request.session_id]
    assert len(events(service, "task_completed")) == 1
    assert not events(service, "task_failed")
    assert not any(op.get("op") == "cancel" for op in runtime_ops(service))
    second = service.execute(
        ask(service, GOOD, session=request.session_id, revision=1, request_id="next")
    )
    assert second["status"] == "completed"
