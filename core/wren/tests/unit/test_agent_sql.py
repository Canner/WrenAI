"""Real synthetic queries and Cedar decisions; only private model calls are stubbed."""

import asyncio
import importlib.util
import json
import os
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlglot
import yaml
from sqlglot import exp
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import traverse_scope

pytest.importorskip("mcp")
from wren.agent_service import Ask, Ref, build_mcp, create_service, safe  # noqa: E402
from wren.agent_sql import (  # noqa: E402
    AdHocSQL,
    DeclaredDefaultMissing,
    DeclaredDefaultUndetermined,
    QueryDenied,
    QueryFormError,
    QueryShapeError,
)
from wren.context import build_json  # noqa: E402
from wren.declared_default_check import DefaultsChecker, _Statement  # noqa: E402
from wren.declared_default_fx import VIEW_MARK, evaluate  # noqa: E402
from wren.declared_default_status import _Status, display  # noqa: E402

needs_policy_runtime = pytest.mark.skipif(
    Path(os.getenv("WARBLE_SERVICE", "")).name == "fake_runtime.js",
    reason="the scripted runtime evaluates no Cedar policy",
)


@pytest.mark.parametrize(
    "value,kind",
    [
        (Decimal("42"), int),
        (Decimal("9007199254740991"), int),
        (Decimal("-9007199254740991"), int),
        (Decimal("9007199254740992"), str),
        (Decimal("-9007199254740992"), str),
        (Decimal("9007199254740993"), str),
        (Decimal("123456789012345.678901"), str),
    ],
)
def test_decimal_results_retain_their_exact_value(monkeypatch, value, kind):
    import pyarrow as pa  # noqa: PLC0415

    import wren.agent_sql as agent_sql  # noqa: PLC0415

    query = AdHocSQL.__new__(AdHocSQL)
    query.project = SimpleNamespace(engine=object(), current=lambda: None)
    monkeypatch.setattr(
        agent_sql, "governed_query", lambda *_: pa.table({"value": [value]})
    )
    result, _ = query.execute(("SELECT value", [], [], ["value"], {}, {}, []))
    actual = result["rows"][0]["c1"]
    assert Decimal(str(actual)) == value
    assert isinstance(actual, kind)


@pytest.fixture
def adhoc(tmp_path):
    runtime, compiler = os.getenv("WARBLE_SERVICE"), os.getenv("WARBLE_BIN")
    if not runtime or not compiler:
        pytest.skip("Set WARBLE_SERVICE and WARBLE_BIN")
    examples = Path(__file__).resolve().parents[4] / "examples/serve-agent"
    spec = importlib.util.spec_from_file_location("adhoc_setup", examples / "setup.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    services = []

    def make(policy="", files=None, excluded_orders=False):
        dest = tmp_path / f"fixture{len(services)}"
        module.prepare_adhoc(dest)
        root = dest / "project"
        if excluded_orders:
            import duckdb  # noqa: PLC0415

            with duckdb.connect(str(dest / "data/synthetic.duckdb")) as db:
                db.execute(
                    "INSERT INTO raw_orders VALUES (101,1,'2026-01-01',1000,FALSE,'cancelled'), (102,1,'2026-01-01',1000,FALSE,'pending')"
                )
                assert db.execute("SELECT COUNT(*) FROM raw_orders").fetchone() == (14,)
        for name, text in (files or {}).items():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_text(text)
        if files:
            (root / "target/mdl.json").write_text(json.dumps(build_json(root)))
        with (root / "policy.cedar").open("a") as f:
            f.write(policy)
        s = create_service(
            root,
            examples / "profiles/adhoc",
            root / "service.yml",
            Path(runtime),
            compiler,
        )
        services.append(s)
        original = s.ipc.call
        s.test_sql = "SELECT SUM(amount) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')"

        def call(op, **kwargs):
            if op == "invoke":
                cb = kwargs["callback"]
                cb("__delegate", {"component": "data_worker"})
                cb("list_context", {})
                cb("read_context", {"ids": ["orders", "customers"]})
                result = cb("run_sql", {"sql": s.test_sql})
                return (
                    {"evidence": result["evidence"]} if "evidence" in result else result
                )
            return original(op, **kwargs)

        s.ipc.call = call
        return s

    yield make
    for s in services:
        s.shutdown()


def ask(s, sql, session=None, revision=0, reply=None, request_id="one"):
    s.test_sql = sql
    return s.execute(
        Ask(
            session_id=session or s.open()["session_id"],
            request_id=request_id,
            expected_revision=revision,
            capability="analytics",
            question="analyze data",
            reply_to=reply,
        )
    )


@pytest.mark.parametrize(
    ("sql", "rows"),
    [
        (
            "SELECT SUM(amount), AVG(amount), COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
            [{"c1": 780.0, "c2": 65.0, "c3": 12}],
        ),
        (
            "SELECT c.region, SUM(o.amount) revenue FROM orders o JOIN customers c ON o.customer_id=c.id WHERE NOT o.is_test AND o.status IN ('paid', 'shipped') GROUP BY c.region ORDER BY revenue DESC",
            [
                {"c1": "East", "c2": 300.0},
                {"c1": "South", "c2": 260.0},
                {"c1": "North", "c2": 220.0},
            ],
        ),
        (
            "WITH totals AS (SELECT customer_id, SUM(amount) AS revenue FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped') GROUP BY customer_id) SELECT c.region, t.revenue FROM totals t JOIN customers c ON t.customer_id=c.id ORDER BY t.revenue DESC LIMIT 2",
            [{"c1": "East", "c2": 300.0}, {"c1": "South", "c2": 260.0}],
        ),
        (
            "SELECT SUM(CASE WHEN amount >= 50 THEN amount ELSE 0 END) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
            [{"c1": 680.0}],
        ),
        (
            "SELECT COUNT(*) FROM orders o JOIN customers c ON o.customer_id=c.id WHERE c.region='North' AND NOT o.is_test AND o.status IN ('paid', 'shipped')",
            [{"c1": 4}],
        ),
    ],
)
def test_actual_adhoc_queries(adhoc, sql, rows):
    result = ask(adhoc(), sql)
    assert result["status"] == "completed"
    assert result["result"]["rows"] == rows


def test_executed_status_filter_excludes_rows_present_in_the_database(adhoc):
    s = adhoc(excluded_orders=True)
    result = ask(
        s,
        "SELECT COUNT(*), SUM(amount) FROM orders WHERE NOT is_test AND status IN ('paid','shipped')",
    )
    assert result["status"] == "completed"
    assert result["result"]["rows"] == [{"c1": 12, "c2": 780.0}]


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM orders",
        "DROP TABLE orders",
        "UPDATE orders SET amount=0",
        "CREATE TABLE stolen AS SELECT * FROM orders",
        "COPY orders TO '/tmp/stolen.csv'",
        "SELECT * INTO stolen FROM orders",
        "SELECT * FROM orders; SELECT 1",
        "SELECT * FROM read_csv('/etc/passwd')",
        "SELECT * FROM read_parquet('https://example.com/x')",
        "SELECT * FROM synthetic.main.raw_orders",
        "SELECT * FROM information_schema.tables",
        "SELECT * FROM customers",
        "SELECT email FROM customers",
        "SELECT COUNT(*) FROM customers WHERE email LIKE '%@%'",
        "SELECT COUNT(*) FROM customers ORDER BY MIN(email)",
        "WITH a AS (SELECT email FROM customers) SELECT COUNT(*) FROM a",
        "SELECT 1",
        "SELECT 'PRIVATE_SQL' FROM orders",
        "SELECT MIN('PRIVATE_SQL') FROM orders",
        "SELECT CASE WHEN amount>0 THEN 'PRIVATE_RULE' ELSE 'ok' END FROM orders",
        "WITH x AS (SELECT 'PRIVATE_SQL' AS value FROM orders) SELECT value FROM x",
        "SELECT x.a FROM orders, (VALUES ('PRIVATE_SQL')) AS x(a)",
        "SELECT CONCAT('PRIVATE_', 'SQL', region) FROM customers",
        "SELECT CAST(amount AS VARCHAR) FROM orders",
        "SELECT CHR(83) FROM orders",
        "WITH RECURSIVE t(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM t) SELECT x FROM t",
        "SELECT * FROM orders o JOIN missing m ON o.id=m.id",
    ],
)
def test_admission_denies_unsafe_or_unapproved_sql(adhoc, sql):
    s = adhoc()
    with pytest.raises((PermissionError, ValueError)):
        ask(s, sql)
    assert not any(a.get("event") == "private_sql" for a in s.audit)


@needs_policy_runtime
def test_alias_cannot_leak_sql_and_evidence_is_host_owned(adhoc):
    s = adhoc()
    session = s.open()["session_id"]
    result = ask(
        s,
        "SELECT SUM(amount) AS \"SELECT PRIVATE SQL FROM secret\" FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
        session,
    )
    evidence = s.evidence(Ref(session_id=session, evidence_ref=result["evidence_ref"]))
    assert result["result"]["columns"] == [{"key": "c1", "label": "sum_amount"}]
    assert "PRIVATE" not in json.dumps([result, evidence])
    assert "sql" not in json.dumps(evidence).lower()
    assert s.capabilities_public()["metadata_documents"] == []
    with pytest.raises(PermissionError):
        s.metadata(None, ["structure"], "planner")


@pytest.mark.parametrize(
    "action,kind", [("execute_query", "query"), ("receive_answer", "answer.sql_result")]
)
@needs_policy_runtime
def test_cedar_column_boundary_before_execution(adhoc, action, kind):
    s = adhoc(
        f'\nforbid(principal, action == Service::Action::"{action}", resource) when {{ resource.kind == "{kind}" && resource.columns.contains("amount") }};'
    )
    with pytest.raises(PermissionError):
        ask(
            s,
            "SELECT SUM(amount) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
        )
    assert not any(a.get("event") == "private_sql" for a in s.audit)


DENIED_REFERENCES = [
    "SELECT email FROM customers",
    "SELECT c.email FROM customers c",
    'SELECT "email" FROM customers',
    "SELECT customers.email FROM customers",
    "SELECT * FROM customers",
    "SELECT c.* FROM customers c",
    "SELECT COUNT(*) FROM customers WHERE email LIKE '%@%'",
    "SELECT COUNT(*) FROM customers ORDER BY MIN(email)",
    "SELECT region, COUNT(*) FROM customers GROUP BY region HAVING MAX(email) > ''",
    "WITH a AS (SELECT email FROM customers) SELECT COUNT(*) FROM a",
    "WITH a AS (SELECT email AS e FROM customers) SELECT COUNT(e) FROM a",
    "WITH a AS (SELECT * FROM customers) SELECT COUNT(*) FROM a",
    "SELECT COUNT(*) FROM (SELECT email FROM customers) t",
    "SELECT COUNT(*) FROM (SELECT * FROM customers) t",
    "SELECT COUNT(*) FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE email IS NOT NULL)",
    "SELECT COUNT(*) FROM orders o WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.email LIKE 'p%')",
    "SELECT COUNT(*) FROM orders o JOIN customers c ON o.customer_id = c.id AND c.email IS NOT NULL",
    "SELECT COUNT(*) FROM customers c1 JOIN customers c2 ON c1.email = c2.email",
    "SELECT COUNT(DISTINCT email) FROM customers",
    "SELECT COUNT(*) FROM customers UNION ALL SELECT COUNT(email) FROM customers",
    "SELECT MIN(LENGTH(email)) FROM customers",
]


@pytest.mark.parametrize("sql", DENIED_REFERENCES)
def test_a_denied_column_is_refused_in_every_reference_form(adhoc, sql):
    s = adhoc()
    with pytest.raises(PermissionError, match="denied_column"):
        s.sql.prepare(sql)
    with pytest.raises(PermissionError):
        ask(s, sql)
    assert not any(a.get("event") == "private_sql" for a in s.audit)
    assert not any(a.get("event") == "private_sql_rejected" for a in s.audit)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT customers FROM customers",
        "SELECT c FROM customers c",
        "SELECT COLUMNS('.*') FROM customers",
        "SELECT COLUMNS(c -> c LIKE '%mail') FROM customers",
        "SELECT TO_JSON(c) FROM customers c",
        "SELECT STRUCT_PACK(a := email) FROM customers",
        "SELECT * EXCLUDE (region) FROM customers",
    ],
)
def test_row_valued_and_pattern_forms_do_not_reach_a_denied_column(adhoc, sql):
    s = adhoc()
    with pytest.raises((PermissionError, ValueError)):
        ask(s, sql)
    assert not any(a.get("event") == "private_sql" for a in s.audit)


def test_a_non_denied_column_of_the_same_model_stays_queryable(adhoc):
    result = ask(adhoc(), "SELECT COUNT(*) FROM customers WHERE region = 'North'")
    assert result["result"]["rows"] == [{"c1": 1}]
    result = ask(adhoc(), "SELECT * EXCLUDE (email) FROM customers ORDER BY id LIMIT 2")
    assert [c["label"] for c in result["result"]["columns"]] == ["id", "region"]


def test_a_denied_column_is_in_no_worker_visible_projection(adhoc):
    s = adhoc()
    seen = []
    original = s.ipc.call

    def call(op, **kwargs):
        if op == "invoke":
            cb = kwargs["callback"]
            seen.append(json.loads(kwargs["request"])["context_index"])
            seen.append(cb("list_context", {}))
            seen.append(cb("select_context", {"ids": ["customers"]}))
            seen.append(cb("read_context", {"ids": ["customers", "orders"]}))
            seen.append(
                cb("read_context", {"ids": ["rule:knowledge/rules/conventions.md"]})
            )
            out = cb("run_sql", {"sql": "SELECT COUNT(*) FROM customers"})
            return {"evidence": out["evidence"]}
        return original(op, **kwargs)

    s.ipc.call = call
    ask(s, "ignored")
    assert "email" not in json.dumps(seen).lower()
    assert "private-" not in json.dumps(seen)


def test_followup_cache_and_evidence_reauthorize_lineage(adhoc):
    s = adhoc()
    session = s.open()["session_id"]
    sql = "SELECT SUM(amount) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')"
    first = ask(s, sql, session)
    assert ask(s, sql, session) == first
    second = ask(
        s,
        "SELECT AVG(amount) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
        session,
        1,
        first["result_ref"],
        "two",
    )
    assert second["result"]["rows"] == [{"c1": 65.0}]
    allowed = s.allowed
    s.allowed = lambda session, action, kind, *a, **kw: (
        False
        if kind == "answer.sql_result"
        else allowed(session, action, kind, *a, **kw)
    )
    with pytest.raises(PermissionError):
        s.evidence(Ref(session_id=session, evidence_ref=first["evidence_ref"]))
    with pytest.raises(PermissionError):
        ask(s, sql, session)
    with pytest.raises(PermissionError):
        ask(s, sql, session, 2, first["result_ref"], "three")


def test_public_mcp_has_no_sql_execution_tool(adhoc):
    mcp = build_mcp(adhoc())
    assert {t.name for t in asyncio.run(mcp.list_tools())} == {
        "capabilities",
        "open_session",
        "ask_data",
        "continue_task",
        "get_evidence",
        "read_metadata",
        "close_session",
    }


def test_private_can_repair_shape_without_executing_or_disclosing_literal(adhoc):
    s = adhoc()
    original = s.ipc.call

    def call(op, **kwargs):
        if op == "invoke":
            cb = kwargs["callback"]
            rejected = cb(
                "run_sql",
                {"sql": "SELECT 'PRIVATE_SQL' AS metric, SUM(amount) FROM orders"},
            )
            assert rejected["error"] == "unsupported_result_shape"
            assert "PRIVATE_SQL" not in json.dumps(rejected)
            result = cb(
                "run_sql",
                {
                    "sql": "SELECT SUM(amount) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')"
                },
            )
            return {"evidence": result["evidence"]}
        return original(op, **kwargs)

    s.ipc.call = call
    result = ask(s, "ignored")
    assert result["result"]["rows"] == [{"c1": 780.0}]
    assert len([a for a in s.audit if a.get("event") == "private_sql"]) == 1
    assert "PRIVATE_SQL" not in json.dumps(result)


@pytest.mark.parametrize(
    "sql,code",
    [
        (
            "SELECT SUM(amt) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
            "unresolved_column",
        ),
        (
            "WITH x AS (SELECT SUM(amount) AS total FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')) SELECT grand_total FROM x",
            "unresolved_column",
        ),
        (
            "SELECT SUM(o.amount * (SELECT COUNT(*) FROM customers c WHERE c.id = o.customer_id)) FROM orders o WHERE NOT o.is_test AND o.status IN ('paid', 'shipped')",
            "unresolved_column",
        ),
        ("SELECT SUM(amount) FROM orders WHERE", "invalid_sql"),
    ],
)
def test_private_can_repair_planning_failure_without_authorization_change(
    adhoc, sql, code
):
    s = adhoc()
    original = s.ipc.call

    def call(op, **kwargs):
        if op == "invoke":
            cb = kwargs["callback"]
            rejected = cb("run_sql", {"sql": sql})
            assert rejected["error"] == "unsupported_query"
            assert rejected["code"] == code
            assert set(rejected) == {"error", "code", "hint"}
            result = cb(
                "run_sql",
                {
                    "sql": "SELECT SUM(amount) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')"
                },
            )
            return {"evidence": result["evidence"]}
        return original(op, **kwargs)

    s.ipc.call = call
    result = ask(s, "ignored")
    assert result["result"]["rows"] == [{"c1": 780.0}]
    events = [a.get("event") for a in s.audit]
    assert events.count("private_sql_rejected") == 1
    assert events.count("private_sql") == 1
    assert not any(a.get("reason") == "denied" for a in s.audit)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT email FROM customers",
        "SELECT * FROM orders o JOIN missing m ON o.id=m.id",
        "SELECT * FROM read_csv('/etc/passwd')",
        "UPDATE orders SET amount=0",
    ],
)
def test_authorization_failures_still_end_the_task(adhoc, sql):
    s = adhoc()
    s.test_sql = sql
    with pytest.raises(PermissionError):
        ask(s, "ignored")
    assert not any(a.get("event") == "private_sql_rejected" for a in s.audit)


def test_weekly_native_dates_and_target_expression(adhoc):
    s = adhoc()
    result = ask(
        s,
        "SELECT DATE_TRUNC('week', order_date) AS week, SUM(amount), COUNT(*), COUNT(*) >= 4 FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped') GROUP BY 1 ORDER BY 1",
    )
    assert [r["c2"] for r in result["result"]["rows"]] == [60.0, 220.0, 500.0]
    assert [r["c3"] for r in result["result"]["rows"]] == [3, 4, 5]
    assert [r["c4"] for r in result["result"]["rows"]] == [False, True, True]
    assert result["result"]["rows"][0]["c1"].startswith("2025-12-29")


def test_followup_has_original_question_even_if_prior_result_has_no_date(adhoc):
    s = adhoc()
    session = s.open()["session_id"]
    first = ask(
        s,
        "SELECT SUM(amount) FROM orders WHERE order_date >= TIMESTAMP '2026-01-05' AND order_date < TIMESTAMP '2026-01-12' AND NOT is_test AND status IN ('paid', 'shipped')",
        session,
    )
    original = s.ipc.call

    def call(op, **kwargs):
        if op == "invoke":
            assert (
                json.loads(kwargs["request"])["previous"]["original_question"]
                == "analyze data"
            )
        return original(op, **kwargs)

    s.ipc.call = call
    ask(
        s,
        "SELECT AVG(amount) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
        session,
        1,
        first["result_ref"],
        "two",
    )


def worker(s, *statements):
    """The answers a worker gets for these statements, in order, within one task.

    The last answer carrying an evidence token is returned as the worker's final output."""
    answers = []
    original = s.ipc.call

    def call(op, **kwargs):
        if op != "invoke":
            return original(op, **kwargs)
        cb = kwargs["callback"]
        for sql in statements:
            answers.append(cb("run_sql", {"sql": sql}))
        tokens = [a["evidence"] for a in answers if "evidence" in a]
        return {"evidence": tokens[-1]} if tokens else {"value": None}

    s.ipc.call = call
    return answers


def run(s, *statements, session=None):
    answers = worker(s, *statements)
    try:
        result = s.execute(
            Ask(
                session_id=session or s.open()["session_id"],
                request_id="gate",
                expected_revision=0,
                capability="analytics",
                question="analyze data",
            )
        )
    except (ValueError, PermissionError) as exc:
        return answers, exc
    return answers, result


def events(s, name):
    return [a for a in s.audit if a.get("event") == name]


JOIN = "r.currency = i.currency AND i.invoice_date >= r.rate_date"
FX = "convert-invoices-to-usd"
STATUS = "count-paid-and-shipped"
RATE_COUNTEREXAMPLES = [
    pytest.param(
        "SELECT SUM(i.amount * r.rate_to_usd) FROM invoices i JOIN fx_rates r ON r.currency = i.currency AND r.rate_date <= i.invoice_date",
        [f"{FX}:rate_multi_match", f"{FX}:base_currency_dropped"],
        id="ordinary-date-join-multi-match",
    ),
    pytest.param(
        f"SELECT SUM(i.amount * r.rate_to_usd) FROM invoices i ASOF JOIN fx_rates r ON {JOIN}",
        [f"{FX}:base_currency_dropped"],
        id="inner-asof-drops-usd-rows",
    ),
    pytest.param(
        f"SELECT SUM(i.amount * COALESCE(r.rate_to_usd, 1)) FROM invoices i ASOF LEFT JOIN fx_rates r ON {JOIN}",
        [f"{FX}:rate_default_literal"],
        id="coalesce-1-for-every-currency",
    ),
    pytest.param(
        "SELECT SUM(i.amount) FROM invoices i",
        [FX],
        id="no-rate-join-at-all",
    ),
    pytest.param(
        "SELECT SUM(amount) FROM orders WHERE status IN ('paid', 'shipped')",
        ["exclude-test-orders"],
        id="test-orders-not-excluded",
    ),
    pytest.param(
        "SELECT SUM(amount) FROM orders WHERE NOT is_test",
        ["count-paid-and-shipped:missing"],
        id="no-status-filter",
    ),
]


@pytest.mark.parametrize(("sql", "rules"), RATE_COUNTEREXAMPLES)
def test_declared_default_counterexamples_are_rejected_and_not_executed(
    adhoc, sql, rules
):
    s = adhoc()
    answers, _ = run(s, sql)
    assert answers == [
        {
            "error": "declared_default_missing",
            "code": "rule_violation",
            "rules": rules,
            "hint": answers[0]["hint"],
        }
    ]
    assert not events(s, "private_sql")
    rejected = events(s, "private_sql_rejected")
    assert [(e["code"], e["sub_code"], e["rules"], e["attempt"]) for e in rejected] == [
        ("declared_default_missing", "rule_violation", rules, 1)
    ]


FX_GUARDED = f"SELECT SUM(CASE WHEN i.currency = 'USD' THEN i.amount ELSE i.amount * r.rate_to_usd END) FROM invoices i ASOF LEFT JOIN fx_rates r ON {JOIN}"
FX_UNGUARDED = f"SELECT SUM(i.amount * r.rate_to_usd) FROM invoices i ASOF LEFT JOIN fx_rates r ON {JOIN}"


def test_a_rejected_rate_query_is_rewritten_into_the_base_currency_form(adhoc):
    s = adhoc()
    answers, result = run(
        s,
        f"SELECT SUM(i.amount * COALESCE(r.rate_to_usd, 1)) FROM invoices i ASOF LEFT JOIN fx_rates r ON {JOIN}",
        FX_GUARDED,
    )
    assert answers[0]["rules"] == [f"{FX}:rate_default_literal"]
    assert result["status"] == "completed"
    # USD 100 + 50 untouched, EUR 200 at 1.0, GBP 300 at 2.0, EUR 400 at 1.5.
    assert result["result"]["rows"] == [{"c1": 1550.0}]
    internal = s.sessions[result["session_id"]]["evidence"][result["evidence_ref"]][
        "internal"
    ]
    assert internal["checks"] == {
        "exclude-test-orders": {"applicable": False, "result": "not_applicable"},
        FX: {"applicable": True, "result": "satisfied"},
        STATUS: {"applicable": False, "result": "not_applicable"},
    }
    assert (
        internal["observed"]["fx_missing_rate_handling"] == "guarded_by_base_currency"
    )


def test_a_left_join_without_a_guard_runs_and_records_how_a_missing_rate_is_handled(
    adhoc,
):
    s = adhoc()
    _, result = run(s, FX_UNGUARDED)
    assert result["status"] == "completed"
    internal = s.sessions[result["session_id"]]["evidence"][result["evidence_ref"]][
        "internal"
    ]
    assert internal["checks"][FX] == {"applicable": True, "result": "satisfied"}
    assert internal["observed"]["fx_missing_rate_handling"] == "unguarded_left_join"


def test_checks_and_observed_come_from_the_qualified_statement(adhoc):
    s = adhoc()
    _, result = run(
        s,
        "SELECT c.region, SUM(o.amount) FROM orders o JOIN customers c ON o.customer_id = c.id "
        "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped') AND o.order_date >= TIMESTAMP '2026-01-05' GROUP BY c.region",
    )
    internal = s.sessions[result["session_id"]]["evidence"][result["evidence_ref"]][
        "internal"
    ]
    assert internal["checks"] == {
        "exclude-test-orders": {"applicable": True, "result": "satisfied"},
        FX: {"applicable": False, "result": "not_applicable"},
        STATUS: {"applicable": True, "result": "satisfied"},
    }
    assert internal["observed"] == {
        "models": ["customers", "orders"],
        "columns": {
            "customers": ["id", "region"],
            "orders": ["amount", "customer_id", "is_test", "order_date", "status"],
        },
        "joins": [["customers", "orders"]],
        "aggregated": True,
        "filters": [
            {"column": "orders.is_test", "operator": "is false"},
            {"column": "orders.status", "operator": "in"},
            {"column": "orders.order_date", "operator": ">="},
        ],
        "status_literals": {"orders.status": ["paid", "shipped"]},
        "date_windows": [
            {
                "column": "orders.order_date",
                "lower": "2026-01-05",
                "upper": None,
                "lower_inclusive": True,
                "upper_inclusive": False,
            }
        ],
    }
    text = json.dumps(internal["observed"])
    assert "email" not in text and "SELECT" not in text
    # A date literal reaches the record only as a window bound, from the AST.
    assert text.count("2026") == 1


FORM_ERRORS = [
    ("SELECT e FROM customers AS c(a, b, e)", "column_list_alias"),
    ("SELECT * FROM customers AS c(a, b, e)", "column_list_alias"),
    (
        "SELECT COUNT(*) FROM customers AS c(a, b, e) WHERE e IS NOT NULL",
        "column_list_alias",
    ),
    ("SELECT COUNT(*) FROM orders NATURAL JOIN customers", "natural_join"),
    ("SELECT COUNT(*) FROM customers c1 NATURAL JOIN customers c2", "natural_join"),
    ("SELECT COUNT(*) FROM orders o NATURAL LEFT JOIN customers c", "natural_join"),
    ("SELECT MAX(#1) FROM customers", "positional_reference"),
    ("SELECT #3 FROM customers", "positional_reference"),
    ("SELECT region FROM customers ORDER BY #1", "positional_reference"),
]


@pytest.mark.parametrize(("sql", "code"), FORM_ERRORS)
def test_forms_that_reach_a_column_without_naming_it_are_form_errors(adhoc, sql, code):
    s = adhoc()
    with pytest.raises(QueryFormError) as caught:
        s.sql.prepare(sql)
    assert (caught.value.error, caught.value.code) == ("unsupported_query", code)
    answers, _ = run(s, sql)
    assert (answers[0]["error"], answers[0]["code"]) == ("unsupported_query", code)
    assert set(answers[0]) == {"error", "code", "hint"}
    assert not events(s, "private_sql")
    assert [(e["code"], e["sub_code"]) for e in events(s, "private_sql_rejected")] == [
        ("unsupported_query", code)
    ]
    assert not any(a.get("reason") == "denied" for a in s.audit)


def test_a_column_list_alias_on_a_derived_table_is_not_a_table_alias(adhoc):
    s = adhoc()
    _, result = run(s, "SELECT t.a FROM (SELECT region FROM customers) AS t(a)")
    assert result["status"] == "completed"
    assert result["result"]["columns"] == [{"key": "c1", "label": "region"}]


PIVOT = "SELECT SUM(CASE WHEN region = 'North' THEN id ELSE 0 END), SUM(CASE WHEN region = 'South' THEN id ELSE 0 END), SUM(CASE WHEN region = 'East' THEN id ELSE 0 END) FROM customers"


def test_a_pivot_with_one_label_per_literal_is_rewritten_with_group_by(adhoc):
    s = adhoc()
    answers, result = run(
        s,
        PIVOT,
        "SELECT region, SUM(id) FROM customers GROUP BY region ORDER BY region",
    )
    assert answers[0] == {
        "error": "unsupported_result_shape",
        "code": "duplicate_label",
        "hint": "This SQL was NOT executed: two result columns would carry the same label. Use GROUP BY so the key is a data column instead of one column per literal.",
    }
    assert result["status"] == "completed"
    assert result["result"]["columns"] == [
        {"key": "c1", "label": "region"},
        {"key": "c2", "label": "sum_id"},
    ]
    rejected = events(s, "private_sql_rejected")
    assert [(e["code"], e["sub_code"]) for e in rejected] == [
        ("unsupported_result_shape", "duplicate_label")
    ]


def test_every_other_shape_rejection_names_its_code(adhoc):
    s = adhoc()
    answers, _ = run(s, "SELECT 'PRIVATE_SQL' AS metric, SUM(amount) FROM orders")
    assert (answers[0]["error"], answers[0]["code"]) == (
        "unsupported_result_shape",
        "literal_disclosure",
    )
    assert "PRIVATE_SQL" not in json.dumps(answers)


def test_the_three_error_kinds_each_finish_inside_one_task(adhoc):
    s = adhoc()
    engine = "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped') AND CAST('abc' AS INTEGER) = 1"
    answers, result = run(
        s,
        "SELECT SUM(amt) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
        engine,
        "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
    )
    assert [a.get("error") for a in answers] == [
        "unsupported_query",
        "query_unavailable",
        None,
    ]
    assert answers[1] == {
        "error": "query_unavailable",
        "hint": answers[1]["hint"],
    }
    assert result["status"] == "completed" and result["result"]["rows"] == [{"c1": 12}]
    sequence = [
        e["event"]
        for e in s.audit
        if e.get("event", "").startswith(("private_sql", "task_"))
    ]
    assert sequence == [
        "private_sql_attempt",
        "private_sql_rejected",
        "private_sql_attempt",
        "private_sql_failed",
        "private_sql_attempt",
        "private_sql",
        "task_completed",
    ]
    failed = events(s, "private_sql_failed")[0]
    assert set(failed) == {"t", "event", "request_id", "error_class", "attempt"}
    assert failed["attempt"] == 2 and failed["error_class"] not in ("", None)
    assert "abc" not in json.dumps(failed)


@needs_policy_runtime
def test_a_cedar_denial_ends_the_task_as_denied(adhoc):
    s = adhoc(
        '\nforbid(principal, action == Service::Action::"execute_query", resource);'
    )
    answers, caught = run(
        s,
        "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
    )
    assert answers == []
    assert isinstance(caught, PermissionError) and str(caught) == "denied"
    failed = [e for e in s.audit if e.get("event") == "task_failed"]
    assert [(e["reason"], e["detail"]) for e in failed] == [("denied", "denied")]
    assert not events(s, "private_sql")


def test_a_denied_statement_after_a_rewrite_still_ends_the_task(adhoc):
    s = adhoc()
    original = s.ipc.call
    seen = []

    def call(op, **kwargs):
        if op != "invoke":
            return original(op, **kwargs)
        cb = kwargs["callback"]
        seen.append(cb("run_sql", {"sql": "SELECT SUM(amt) FROM orders"})["error"])
        with pytest.raises(PermissionError, match="query_denied:denied_column"):
            cb("run_sql", {"sql": "SELECT email FROM customers"})
        with pytest.raises(PermissionError):
            cb("run_sql", {"sql": "SELECT COUNT(*) FROM customers"})
        return {"evidence": "forged"}

    s.ipc.call = call
    with pytest.raises(PermissionError, match="denied"):
        s.execute(
            Ask(
                session_id=s.open()["session_id"],
                request_id="one",
                expected_revision=0,
                capability="analytics",
                question="analyze data",
            )
        )
    assert seen == ["unsupported_query"]
    assert not events(s, "private_sql")


def test_only_declared_values_of_an_enumerated_column_are_recorded_as_literals():
    from types import SimpleNamespace  # noqa: PLC0415

    from wren.agent_sql import AdHocSQL  # noqa: PLC0415

    catalog = {
        "models": [
            {
                "name": "tickets",
                "columns": [
                    {"name": "id", "type": "INTEGER"},
                    {
                        "name": "status",
                        "type": "VARCHAR",
                        "enum_values": [
                            {"value": "open", "meaning": "Not resolved"},
                            {"value": "closed", "meaning": "Resolved"},
                        ],
                    },
                    {"name": "note", "type": "VARCHAR"},
                ],
            }
        ]
    }
    gate = AdHocSQL(
        SimpleNamespace(
            snapshot=SimpleNamespace(
                catalog=catalog, denied=frozenset(), declarations=()
            )
        )
    )
    prepared = gate.prepare(
        "SELECT COUNT(*) FROM tickets WHERE status IN ('open', 'PRIVATE SQL') "
        "AND status <> 'closed' AND note = 'open'"
    )
    observed = prepared.observed
    assert observed["status_literals"] == {"tickets.status": ["closed", "open"]}
    assert observed["filters"] == [
        {"column": "tickets.status", "operator": "in"},
        {"column": "tickets.status", "operator": "<>"},
        {"column": "tickets.note", "operator": "="},
    ]
    assert "PRIVATE" not in json.dumps(observed)
    assert prepared.checks == {}


SET_OPERATIONS = {
    "union all": "SELECT id, region FROM customers UNION ALL SELECT id, region FROM customers",
    "union": "SELECT id, region FROM customers UNION SELECT id, region FROM customers",
    "except": "SELECT id, region FROM customers EXCEPT SELECT id, region FROM customers",
    "intersect": "SELECT id, region FROM customers INTERSECT SELECT id, region FROM customers",
}


@pytest.mark.parametrize("sql", SET_OPERATIONS.values(), ids=SET_OPERATIONS.keys())
def test_a_multi_column_set_operation_keeps_the_catalog_column_names(adhoc, sql):
    s = adhoc()
    assert s.sql.prepare(sql).labels == ["id", "region"]
    _, result = run(s, sql)
    assert result["status"] == "completed"
    assert result["result"]["columns"] == [
        {"key": "c1", "label": "id"},
        {"key": "c2", "label": "region"},
    ]


def test_duplicate_labels_are_judged_in_each_select_of_a_set_operation(adhoc):
    s = adhoc()
    for sql in (
        "SELECT id, id FROM customers UNION ALL SELECT id, id FROM customers",
        "SELECT id, region FROM customers UNION ALL SELECT id, id FROM customers",
        PIVOT,
    ):
        with pytest.raises(QueryShapeError, match="duplicate_label"):
            s.sql.prepare(sql)


FUNCTION_MISSES = {
    "now": "SELECT now() FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
    "random": "SELECT random() FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
    "arg_max": "SELECT arg_max(id, amount) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
    "string_agg": "SELECT string_agg(region, ',') FROM customers",
    "mode": "SELECT mode(region) FROM customers",
    "first": "SELECT first(region) FROM customers",
    "corr": "SELECT corr(id, id) FROM customers",
    "epoch": "SELECT epoch(order_date) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
    "list_value": "SELECT list_value(id, id) FROM customers",
    "unnest": "SELECT unnest(list_value(id, id)) FROM customers",
    "any array": "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped') AND id = ANY([1, 2])",
    "parenthesised select": "(SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped'))",
}


@pytest.mark.parametrize("sql", FUNCTION_MISSES.values(), ids=FUNCTION_MISSES.keys())
def test_a_function_outside_the_allowlist_is_a_rewritable_form_error(adhoc, sql):
    s = adhoc()
    with pytest.raises(QueryFormError) as caught:
        s.sql.prepare(sql)
    assert (caught.value.error, caught.value.code) == (
        "unsupported_query",
        "unsupported_function",
    )


def test_a_function_miss_is_rewritten_inside_the_same_task(adhoc):
    s = adhoc()
    answers, result = run(
        s,
        "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped') AND order_date < now()",
        "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
    )
    assert (answers[0]["error"], answers[0]["code"]) == (
        "unsupported_query",
        "unsupported_function",
    )
    assert result["status"] == "completed" and result["result"]["rows"] == [{"c1": 12}]
    assert [(e["code"], e["sub_code"]) for e in events(s, "private_sql_rejected")] == [
        ("unsupported_query", "unsupported_function")
    ]
    assert not events(s, "task_failed")


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT email, now() FROM customers",
        "SELECT COUNT(*) FROM read_csv('x') WHERE now() > 1",
        "WITH x AS (DELETE FROM orders RETURNING *) SELECT now() FROM orders",
    ],
)
def test_a_function_miss_does_not_hide_a_denial(adhoc, sql):
    with pytest.raises(PermissionError, match="query_denied"):
        adhoc().sql.prepare(sql)


def test_an_unknown_model_is_terminal_even_beside_a_function_miss(adhoc):
    s = adhoc()
    for sql in (
        "SELECT now() FROM ghosts",
        "SELECT now() FROM orders o JOIN ghosts g ON g.id = o.id",
        "SELECT COUNT(*) FROM orders WHERE id IN (SELECT id FROM ghosts) AND now() > 1",
    ):
        with pytest.raises(PermissionError, match="query_denied:unknown_model"):
            s.sql.prepare(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT missing_field FROM missing_model",
        "SELECT g.missing_field FROM orders o JOIN missing_model g ON g.id=o.id",
    ],
)
def test_unknown_source_is_terminal_before_bad_column_qualification(adhoc, sql):
    s = adhoc()
    with pytest.raises(PermissionError, match="query_denied:unknown_model"):
        s.sql.prepare(sql)
    assert asyncio.run(safe(ask, s, sql)) == {"status": "denied"}
    assert not any(event.get("event") == "private_sql" for event in s.audit)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT missing_field FROM orders",
        'WITH VirtualOnly AS (SELECT 1 AS id) SELECT missing_field FROM "virtualonly"',
    ],
)
def test_known_source_bad_column_remains_rewritable(adhoc, sql):
    with pytest.raises(QueryFormError, match="unresolved_column"):
        adhoc().sql.prepare(sql)


def test_an_unexpected_planner_error_is_rewritable_never_terminal(adhoc, monkeypatch):
    s = adhoc()
    for error in (RuntimeError("boom"), KeyError("x"), ValueError("anything")):

        def fail(expr, error=error):
            raise error

        monkeypatch.setattr(s.sql, "_projection", fail)
        with pytest.raises(QueryFormError) as caught:
            s.sql.prepare(
                "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')"
            )
        assert (caught.value.error, caught.value.code) == (
            "unsupported_query",
            "unsupported",
        )
    monkeypatch.undo()
    _, result = run(
        s,
        "SELECT COUNT(*) FROM orders ANTI JOIN customers c USING (id) WHERE NOT is_test AND status IN ('paid', 'shipped')",
    )
    assert result["status"] == "completed"


def test_a_semi_or_anti_join_target_no_column_names_is_still_a_source(adhoc):
    s = adhoc()
    for kind in ("SEMI", "ANTI"):
        prepared = s.sql.prepare(
            f"SELECT COUNT(*) FROM orders o {kind} JOIN customers c ON 1 = 1 WHERE NOT o.is_test AND o.status IN ('paid', 'shipped')"
        )
        assert prepared.sources == {"orders": ["is_test", "status"], "customers": []}
        assert prepared.observed["models"] == ["customers", "orders"]


@needs_policy_runtime
def test_a_cedar_forbid_on_a_model_only_a_semi_join_reads_ends_the_task(adhoc):
    s = adhoc(
        '\nforbid(principal, action == Service::Action::"execute_query", resource) '
        'when { resource.name == "customers" };'
    )
    ok, _ = run(
        s,
        "SELECT COUNT(*) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
    )
    assert ok[0]["evidence"]
    s = adhoc(
        '\nforbid(principal, action == Service::Action::"execute_query", resource) '
        'when { resource.name == "customers" };'
    )
    answers, caught = run(
        s,
        "SELECT COUNT(*) FROM orders o SEMI JOIN customers c ON 1 = 1 WHERE NOT o.is_test AND o.status IN ('paid', 'shipped')",
    )
    assert answers == []
    assert isinstance(caught, PermissionError) and str(caught) == "denied"
    assert not events(s, "private_sql")
    failed = events(s, "task_failed")
    assert [(e["reason"], e["detail"]) for e in failed] == [("denied", "denied")]


# -- sale statuses: what the filter actually keeps ------------------------------------------

SALES = "status IN ('paid', 'shipped')"
SCOPED = f"NOT is_test AND {SALES}"


def refused(s, sql, error=QueryFormError):
    with pytest.raises(error) as caught:
        s.sql.prepare(sql)
    return caught.value


@pytest.mark.parametrize(
    ("where", "sub"),
    [
        ("status = 'paid'", "subset"),
        ("lower(status) IN ('paid')", "subset"),
        ("status NOT IN ('cancelled', 'pending', 'shipped')", "subset"),
        ("status NOT IN ('cancelled')", "superset"),
        ("status IN ('paid', 'shipped', 'pending')", "superset"),
        ("amount > 0", "missing"),
    ],
)
def test_a_status_filter_that_keeps_the_wrong_set_is_a_violation(adhoc, where, sub):
    s = adhoc()
    error = refused(s, f"SELECT SUM(amount) FROM orders WHERE NOT is_test AND {where}")
    assert isinstance(error, DeclaredDefaultMissing)
    assert (error.error, error.code) == ("declared_default_missing", "rule_violation")
    assert error.rules == (f"{STATUS}:{sub}",)


@pytest.mark.parametrize(
    "where",
    [
        "lower(status) NOT IN ('cancelled', 'pending')",
        "status <> 'cancelled' AND status <> 'pending'",
        "UPPER(status) IN ('PAID', 'SHIPPED')",
        "status IN ('paid', 'shipped') AND amount > 0",
    ],
)
def test_a_filter_that_keeps_exactly_the_declared_set_passes(adhoc, where):
    s = adhoc()
    prepared = s.sql.prepare(
        f"SELECT SUM(amount) FROM orders WHERE NOT is_test AND {where}"
    )
    assert prepared.checks[STATUS] == {"applicable": True, "result": "satisfied"}


def test_a_status_compared_with_a_column_has_no_verdict(adhoc):
    s = adhoc()
    error = refused(
        s,
        "SELECT SUM(amount) FROM orders WHERE NOT is_test AND status = customer_id",
        DeclaredDefaultUndetermined,
    )
    assert (error.error, error.code, error.rules) == (
        "declared_default_undetermined",
        "no_verdict",
        (STATUS,),
    )


def test_a_status_violation_is_answered_before_anything_runs_and_points_at_clarify(
    adhoc,
):
    s = adhoc()
    answers, result = run(
        s,
        "SELECT SUM(amount) FROM orders WHERE NOT is_test AND status = 'paid'",
        f"SELECT SUM(amount) FROM orders WHERE {SCOPED}",
    )
    assert answers[0]["rules"] == [f"{STATUS}:subset"]
    assert "clarify with missing=status_scope" in answers[0]["hint"]
    assert result["status"] == "completed"
    assert len(events(s, "private_sql")) == 1
    (rejected,) = events(s, "private_sql_rejected")
    assert rejected["rules"] == [f"{STATUS}:subset"]


def test_an_undetermined_status_filter_is_answered_with_its_rule_and_no_clarify_hint(
    adhoc,
):
    s = adhoc()
    answers, result = run(
        s,
        "SELECT SUM(amount) FROM orders WHERE NOT is_test AND status = customer_id",
        f"SELECT SUM(amount) FROM orders WHERE {SCOPED}",
    )
    assert answers[0]["error"] == "declared_default_undetermined"
    assert answers[0]["rules"] == [STATUS]
    assert "status_scope" not in answers[0]["hint"]
    assert result["status"] == "completed"


def test_the_rule_set_is_judged_together_so_a_missing_test_filter_is_still_named(adhoc):
    s = adhoc()
    error = refused(s, f"SELECT SUM(amount) FROM orders WHERE {SALES}")
    assert error.rules == ("exclude-test-orders",)
    error = refused(s, "SELECT SUM(amount) FROM orders")
    assert error.rules == ("exclude-test-orders", f"{STATUS}:missing")


# -- views, cubes and the semantics that no check covers --------------------------------------

ORDER_FACTS = {
    "views/order_facts/metadata.yml": "name: order_facts\nproperties:\n  description: Orders with their status.\n",
    "views/order_facts/sql.yml": "statement: SELECT id, customer_id, amount, is_test, status FROM orders\n",
}
CLEAN_ORDERS = {
    "views/clean_orders/metadata.yml": "name: clean_orders\nguarantees: [exclude-test-orders]\n",
    "views/clean_orders/sql.yml": "statement: SELECT id, customer_id, amount, status FROM orders WHERE NOT is_test\n",
}
CONTACTS = {
    "views/contacts/metadata.yml": "name: contacts\n",
    "views/contacts/sql.yml": "statement: SELECT id, email FROM customers\n",
}
CUBE = {
    "cubes/revenue_cube/metadata.yml": "name: revenue_cube\nbase_object: orders\nmeasures:\n  - name: total_revenue\n    expression: SUM(amount)\n    type: DOUBLE\n",
}
VIEWS = {**ORDER_FACTS, **CLEAN_ORDERS, **CONTACTS, **CUBE}


def test_a_view_guarantee_exempts_only_the_rule_it_names(adhoc):
    s = adhoc()
    prepared = s.sql.prepare("SELECT SUM(v.usd_value) FROM usd_line_value v")
    assert prepared.checks == {
        "exclude-test-orders": {"applicable": False, "result": "not_applicable"},
        FX: {"applicable": True, "result": "satisfied_by_definition"},
        STATUS: {"applicable": False, "result": "not_applicable"},
    }
    assert sorted(prepared.sources) == ["fx_rates", "invoices"]
    assert prepared.unverified == ["revenue_definition_match"]


def test_a_view_runs_as_the_models_behind_it(adhoc):
    s = adhoc()
    _, result = run(s, "SELECT SUM(v.usd_value) FROM usd_line_value v")
    assert result["result"]["rows"] == [{"c1": 1550.0}]
    internal = s.sessions[result["session_id"]]["evidence"][result["evidence_ref"]][
        "internal"
    ]
    assert internal["checks"][FX]["result"] == "satisfied_by_definition"
    assert internal["observed"]["models"] == ["fx_rates", "invoices"]
    assert "usd_line_value" not in json.dumps(internal["observed"])


def test_reads_the_view_does_not_cover_are_still_checked(adhoc):
    s = adhoc()
    raw_and_view = (
        "SELECT SUM(i.amount) FROM invoices i UNION ALL "
        "SELECT SUM(v.usd_value) FROM usd_line_value v"
    )
    assert refused(s, raw_and_view).rules == (FX,)


def test_a_status_filter_on_top_of_a_view_is_judged_like_any_other(adhoc):
    s = adhoc(files=VIEWS)
    sql = "SELECT SUM(amount) FROM order_facts WHERE NOT is_test AND status = 'paid'"
    assert refused(s, sql).rules == (f"{STATUS}:subset",)
    ok = s.sql.prepare(f"SELECT SUM(amount) FROM order_facts WHERE {SCOPED}")
    assert ok.checks[STATUS]["result"] == "satisfied"
    assert ok.checks["exclude-test-orders"]["result"] == "satisfied"
    assert ok.observed["models"] == ["orders"]


def test_a_view_that_does_not_guarantee_the_exclusion_leaves_it_to_the_outer_query(
    adhoc,
):
    s = adhoc(files=VIEWS)
    assert refused(s, f"SELECT SUM(amount) FROM order_facts WHERE {SALES}").rules == (
        "exclude-test-orders",
    )


def test_a_view_guaranteeing_one_rule_does_not_excuse_the_others(adhoc):
    s = adhoc(files=VIEWS)
    assert refused(s, "SELECT SUM(amount) FROM clean_orders").rules == (
        f"{STATUS}:missing",
    )
    prepared = s.sql.prepare(f"SELECT SUM(amount) FROM clean_orders WHERE {SALES}")
    assert prepared.checks["exclude-test-orders"] == {
        "applicable": True,
        "result": "satisfied_by_definition",
    }
    assert prepared.checks[STATUS]["result"] == "satisfied"


def test_a_view_over_a_denied_column_ends_the_task_like_the_column_itself(adhoc):
    s = adhoc(files=VIEWS)
    error = refused(s, "SELECT COUNT(*) FROM contacts", QueryDenied)
    assert str(error) == "query_denied:denied_column"


@needs_policy_runtime
def test_the_models_a_view_reads_are_authorized_as_sources(adhoc):
    s = adhoc(
        '\nforbid(principal, action == Service::Action::"execute_query", resource) '
        'when { resource.name == "fx_rates" };'
    )
    answers, caught = run(s, "SELECT SUM(v.usd_value) FROM usd_line_value v")
    assert answers == []
    assert isinstance(caught, PermissionError) and str(caught) == "denied"
    assert not events(s, "private_sql")


def test_a_view_joined_to_a_model_keeps_that_model_as_a_source(adhoc):
    s = adhoc()
    prepared = s.sql.prepare(
        "SELECT c.region, SUM(v.usd_value) FROM usd_line_value v "
        "JOIN customers c ON v.customer_id = c.id GROUP BY c.region"
    )
    assert sorted(prepared.sources) == ["customers", "fx_rates", "invoices"]
    assert "duplicate_aggregation" not in prepared.unverified
    assert "duplicate_aggregation" not in prepared.observed


def test_a_cte_named_like_a_view_shadows_it(adhoc):
    s = adhoc()
    prepared = s.sql.prepare(
        "WITH usd_line_value AS (SELECT id, id AS usd_value FROM customers) "
        "SELECT SUM(usd_value) FROM usd_line_value"
    )
    assert prepared.observed["models"] == ["customers"]
    assert prepared.unverified == []


def test_cte_reference_in_view_body_is_not_external(adhoc):
    cte_view = {
        "views/paid_ids/metadata.yml": "name: paid_ids\n",
        "views/paid_ids/sql.yml": yaml.safe_dump(
            {
                "statement": "WITH x AS (SELECT id, customer_id FROM orders "
                f"WHERE {SCOPED}) SELECT id, customer_id FROM x"
            }
        ),
    }
    s = adhoc(files=cte_view)
    assert s.sql.broken_views == set()
    prepared = s.sql.prepare("SELECT COUNT(*) FROM paid_ids")
    assert prepared.observed["models"] == ["orders"]


def test_a_cte_defined_later_or_elsewhere_is_still_external(adhoc):
    unresolved = {
        "views/ghost_cte/metadata.yml": "name: ghost_cte\n",
        "views/ghost_cte/sql.yml": yaml.safe_dump(
            {
                "statement": "WITH x AS (SELECT id FROM ghosts) SELECT id FROM x",
            }
        ),
        "views/bare_ghost/metadata.yml": "name: bare_ghost\n",
        "views/bare_ghost/sql.yml": yaml.safe_dump(
            {"statement": "SELECT id FROM (SELECT id FROM orders) o, missing_cte"}
        ),
    }
    s = adhoc(files=unresolved)
    assert s.sql.broken_views == {"ghost_cte", "bare_ghost"}


def test_a_cte_shadows_a_view_only_where_it_is_visible(adhoc):
    s = adhoc()
    tree, read = s.sql._expand_views(
        sqlglot.parse_one(
            "SELECT COUNT(*) FROM usd_line_value v JOIN "
            "(WITH usd_line_value AS (SELECT id FROM customers) "
            "SELECT id FROM usd_line_value) c ON c.id = v.id",
            read="duckdb",
        )
    )
    assert read == ["usd_line_value"]
    assert len([n for n in tree.walk() if n.meta.get(VIEW_MARK)]) == 1
    assert [t.name for t in tree.find_all(exp.Table)].count("usd_line_value") == 1
    cte_body = tree.find(exp.CTE).this
    assert cte_body.find(exp.Table, bfs=False) is not None
    assert not any(n.meta.get(VIEW_MARK) for n in tree.find(exp.CTE).walk())


def test_a_view_the_host_cannot_read_is_not_a_source(adhoc):
    broken = {
        "views/ghost_view/metadata.yml": "name: ghost_view\n",
        "views/ghost_view/sql.yml": "statement: SELECT id FROM ghosts\n",
    }
    s = adhoc(files=broken)
    assert s.sql.broken_views == {"ghost_view"}
    assert refused(s, "SELECT COUNT(*) FROM ghost_view").code == "unsupported_source"


def test_a_view_value_joined_to_a_many_side_model_is_marked_duplicated(adhoc):
    s = adhoc()
    sql = (
        "SELECT SUM(v.usd_value) FROM usd_line_value v JOIN orders o "
        "ON v.customer_id = o.customer_id WHERE NOT o.is_test AND o.status IN ('paid', 'shipped')"
    )
    answers, result = run(s, sql)
    assert answers[0].get("evidence")
    internal = s.sessions[result["session_id"]]["evidence"][result["evidence_ref"]][
        "internal"
    ]
    assert internal["observed"]["duplicate_aggregation"] is True
    assert internal["unverified"] == [
        "duplicate_aggregation",
        "fiscal_calendar_bounds",
        "revenue_definition_match",
    ]


@pytest.mark.parametrize(
    "sql",
    [
        # joined on the model's key: one model row per view row
        "SELECT SUM(v.usd_value) FROM usd_line_value v JOIN invoices i ON v.invoice_id = i.id",
        # nothing is aggregated from the view
        "SELECT COUNT(*) FROM usd_line_value v JOIN orders o ON v.customer_id = o.customer_id "
        "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped')",
        # the aggregate reads the model, not the view
        "SELECT SUM(o.amount) FROM usd_line_value v JOIN orders o ON v.customer_id = o.customer_id "
        "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped')",
    ],
)
def test_other_joins_with_a_view_are_not_marked(adhoc, sql):
    s = adhoc()
    prepared = s.sql.prepare(sql)
    assert "duplicate_aggregation" not in prepared.unverified
    assert "duplicate_aggregation" not in prepared.observed


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT SUM(total_revenue) FROM orders WHERE " + SCOPED,
        "SELECT SUM(total_revenue) FROM revenue_cube",
        "SELECT SUM(r.total_revenue) FROM revenue_cube r JOIN orders o ON r.id = o.id",
    ],
)
def test_a_cube_is_not_a_table_and_a_measure_is_not_a_column(adhoc, sql):
    s = adhoc(files=VIEWS)
    error = refused(s, sql)
    assert (error.error, error.code) == ("unsupported_query", "cube_not_a_table")


def test_a_cube_refusal_is_rewritable_and_nothing_else_changes(adhoc):
    s = adhoc(files=VIEWS)
    answers, result = run(
        s,
        "SELECT SUM(total_revenue) FROM revenue_cube",
        f"SELECT SUM(amount) FROM orders WHERE {SCOPED}",
    )
    assert (answers[0]["error"], answers[0]["code"]) == (
        "unsupported_query",
        "cube_not_a_table",
    )
    assert "cube is not a table" in answers[0]["hint"]
    assert result["status"] == "completed"
    assert not events(s, "task_failed")
    ok = s.sql.prepare(
        f"SELECT SUM(amount) AS total_revenue FROM orders WHERE {SCOPED}"
    )
    assert ok.labels == ["sum_amount"]


def test_the_semantics_a_statement_touches_are_listed_as_unverified(adhoc):
    s = adhoc()
    touching = s.sql.prepare(f"SELECT SUM(amount) FROM orders WHERE {SCOPED}")
    assert touching.unverified == ["fiscal_calendar_bounds"]
    customers = s.sql.prepare("SELECT COUNT(*) FROM customers")
    assert customers.unverified == []
    invoices = s.sql.prepare(FX_GUARDED)
    assert invoices.unverified == []
    view = s.sql.prepare("SELECT COUNT(*) FROM usd_line_value")
    assert view.unverified == ["revenue_definition_match"]


def test_unverified_reaches_the_internal_evidence_and_never_names_a_denied_column(
    adhoc,
):
    s = adhoc()
    _, result = run(s, f"SELECT SUM(amount) FROM orders WHERE {SCOPED}")
    internal = s.sessions[result["session_id"]]["evidence"][result["evidence_ref"]][
        "internal"
    ]
    assert internal["unverified"] == ["fiscal_calendar_bounds"]
    assert "email" not in json.dumps(internal)


FX_SHAPES = {
    "coalesce to arithmetic": "COALESCE(r.rate_to_usd, 2 - 1)",
    "coalesce to a column": "COALESCE(r.rate_to_usd, i.amount / i.amount)",
    "nested case": "CASE WHEN r.rate_to_usd IS NULL THEN CASE WHEN i.amount > 0 THEN 1 ELSE 1 END ELSE r.rate_to_usd END",
    "case on a comparison": "CASE WHEN r.rate_to_usd > 0 THEN r.rate_to_usd ELSE 1 END",
    "null test with a column default": "CASE WHEN r.rate_to_usd IS NULL THEN i.amount ELSE r.rate_to_usd END",
    "inverse null test with a column default": "CASE WHEN r.rate_to_usd IS NOT NULL THEN r.rate_to_usd ELSE i.amount END",
}


@pytest.mark.parametrize("rate", FX_SHAPES.values(), ids=FX_SHAPES.keys())
def test_a_default_shape_the_rate_checks_do_not_read_is_unverified(adhoc, rate):
    s = adhoc()
    sql = (
        "SELECT SUM(CASE WHEN i.currency = 'USD' THEN i.amount ELSE i.amount * "
        f"{rate} END) FROM invoices i ASOF LEFT JOIN fx_rates r ON {JOIN}"
    )
    prepared = s.sql.prepare(sql)
    assert prepared.checks[FX]["result"] == "satisfied"
    assert "fx_default_shape_unverified" in prepared.unverified


def test_the_plain_guarded_form_has_nothing_unverified_and_the_unguarded_one_is_named(
    adhoc,
):
    s = adhoc()
    assert s.sql.prepare(FX_GUARDED).unverified == []
    assert s.sql.prepare(FX_UNGUARDED).unverified == ["fx_missing_rate_handling"]
    literal_null = (
        "SELECT SUM(CASE WHEN i.currency = 'USD' THEN i.amount ELSE "
        f"i.amount * CASE WHEN r.rate_to_usd IS NULL THEN NULL ELSE r.rate_to_usd END END) "
        f"FROM invoices i ASOF LEFT JOIN fx_rates r ON {JOIN}"
    )
    assert s.sql.prepare(literal_null).unverified == []


def test_a_views_own_columns_are_not_judged_like_text_the_worker_writes(adhoc):
    labelled = {
        "views/labelled/metadata.yml": "name: labelled\n",
        "views/labelled/sql.yml": "statement: SELECT id, CAST(amount AS VARCHAR) AS amount_text, is_test, status FROM orders\n",
    }
    s = adhoc(files=labelled)
    prepared = s.sql.prepare(f"SELECT COUNT(*) FROM labelled WHERE {SCOPED}")
    assert prepared.checks[STATUS]["result"] == "satisfied"
    # the same cast written by the worker is still refused
    assert (
        refused(
            s,
            f"SELECT CAST(amount AS VARCHAR) FROM orders WHERE {SCOPED}",
            QueryShapeError,
        ).code
        == "text_cast"
    )


TRUSTED_ORDERS = {
    "views/trusted_orders/metadata.yml": "name: trusted_orders\nguarantees: [exclude-test-orders, count-paid-and-shipped]\n",
    "views/trusted_orders/sql.yml": "statement: SELECT id, customer_id, amount FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')\n",
}


def test_a_guarantee_covering_some_reads_of_the_model_leaves_the_others_to_the_plain_check(
    adhoc,
):
    s = adhoc(files=TRUSTED_ORDERS)
    whole = s.sql.prepare("SELECT SUM(amount) FROM trusted_orders")
    assert whole.checks[STATUS]["result"] == "satisfied_by_definition"
    assert whole.checks["exclude-test-orders"]["result"] == "satisfied_by_definition"
    both = (
        "SELECT SUM(o.amount) FROM orders o JOIN trusted_orders t ON t.id = o.id "
        "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped')"
    )
    prepared = s.sql.prepare(both)
    assert prepared.checks[STATUS]["result"] == "satisfied"
    assert prepared.checks["exclude-test-orders"]["result"] == "satisfied"
    unfiltered = both.replace(" AND o.status IN ('paid', 'shipped')", "")
    assert refused(s, unfiltered).rules == (f"{STATUS}:missing",)
    unexcluded = both.replace("NOT o.is_test AND ", "")
    assert refused(s, unexcluded).rules == ("exclude-test-orders",)


# -- filters that filter nothing, NULL statuses, expanded joins and rate defaults --------------

OUTER_ON = [
    pytest.param(
        "SELECT SUM(o.amount) FROM orders o LEFT JOIN customers c ON c.id = o.customer_id "
        "AND NOT o.is_test AND o.status IN ('paid', 'shipped')",
        ("exclude-test-orders", f"{STATUS}:missing"),
        id="left",
    ),
    pytest.param(
        "SELECT SUM(o.amount) FROM orders o FULL JOIN customers c ON c.id = o.customer_id "
        "AND NOT o.is_test AND o.status IN ('paid', 'shipped')",
        ("exclude-test-orders", f"{STATUS}:missing"),
        id="full",
    ),
    pytest.param(
        "SELECT SUM(o.amount) FROM customers c RIGHT JOIN orders o ON c.id = o.customer_id "
        "AND NOT o.is_test AND o.status IN ('paid', 'shipped')",
        ("exclude-test-orders", f"{STATUS}:missing"),
        id="right",
    ),
    pytest.param(
        "SELECT SUM(o.amount) FROM orders o ANTI JOIN customers c ON c.id = o.customer_id "
        "AND NOT o.is_test AND o.status IN ('paid', 'shipped')",
        ("exclude-test-orders", f"{STATUS}:missing"),
        id="bare-anti",
    ),
    pytest.param(
        "SELECT SUM(o.amount) FROM orders o SEMI JOIN customers c ON c.id = o.customer_id "
        "AND NOT o.is_test AND o.status IN ('paid', 'shipped')",
        ("exclude-test-orders", f"{STATUS}:missing"),
        id="bare-semi",
    ),
    pytest.param(
        "SELECT SUM(o.amount) FROM customers c RIGHT JOIN (orders o JOIN customers d ON d.id = o.customer_id) "
        "ON c.id = o.customer_id AND NOT o.is_test AND o.status IN ('paid', 'shipped')",
        ("exclude-test-orders", f"{STATUS}:missing"),
        id="right-to-group",
    ),
    pytest.param(
        "SELECT SUM(o.amount) FROM orders o LEFT JOIN (customers c JOIN customers d ON d.id = c.id) "
        "ON c.id = o.customer_id AND NOT o.is_test AND o.status IN ('paid', 'shipped')",
        ("exclude-test-orders", f"{STATUS}:missing"),
        id="left-to-group",
    ),
    pytest.param(
        "SELECT SUM(o.amount) FROM orders o LEFT JOIN customers c ON c.id = o.customer_id "
        "AND o.status IN ('paid', 'shipped') WHERE NOT o.is_test",
        (f"{STATUS}:missing",),
        id="left-status-only",
    ),
    pytest.param(
        "SELECT SUM(o.amount) FROM orders o LEFT JOIN customers c ON c.id = o.customer_id "
        "AND NOT o.is_test WHERE o.status IN ('paid', 'shipped')",
        ("exclude-test-orders",),
        id="left-exclusion-only",
    ),
]


@pytest.mark.parametrize(("sql", "rules"), OUTER_ON)
def test_a_filter_in_the_on_of_an_outer_join_does_not_filter_its_preserved_side(
    adhoc, sql, rules
):
    error = refused(adhoc(), sql)
    assert isinstance(error, DeclaredDefaultMissing)
    assert error.rules == rules


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT SUM(o.amount) FROM orders o LEFT JOIN customers c ON c.id = o.customer_id "
        "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped')",
        "SELECT SUM(o.amount) FROM customers c JOIN orders o ON o.customer_id = c.id "
        "AND NOT o.is_test AND o.status IN ('paid', 'shipped')",
        "SELECT SUM(o.amount) FROM customers c, orders o WHERE o.customer_id = c.id "
        "AND NOT o.is_test AND o.status IN ('paid', 'shipped')",
    ],
)
def test_a_filter_in_the_where_or_an_inner_join_counts(adhoc, sql):
    prepared = adhoc().sql.prepare(sql)
    assert prepared.checks[STATUS]["result"] == "satisfied"
    assert prepared.checks["exclude-test-orders"]["result"] == "satisfied"


NULLABLE_ON = (
    "SELECT SUM(o.amount) FROM customers c LEFT JOIN orders o ON o.customer_id = c.id "
    "AND NOT o.is_test AND o.status IN ('paid', 'shipped')"
)


def test_a_nullable_side_on_predicate_restricts_a_status_but_is_not_an_exclusion(adhoc):
    s = adhoc()
    error = refused(s, NULLABLE_ON)
    assert isinstance(error, DeclaredDefaultMissing)
    assert error.rules == ("exclude-test-orders",)
    status_only = NULLABLE_ON.replace("NOT o.is_test AND ", "") + " WHERE NOT o.is_test"
    prepared = s.sql.prepare(status_only)
    assert prepared.checks[STATUS]["result"] == "satisfied"
    assert prepared.checks["exclude-test-orders"]["result"] == "satisfied"


@pytest.mark.parametrize(
    ("where", "sub"),
    [
        ("status IN ('paid', 'shipped') OR status IS NULL", "superset"),
        ("status = 'paid' OR status = 'shipped' OR status IS NULL", "superset"),
        ("status IS NULL", "superset"),
    ],
)
def test_a_filter_that_keeps_null_statuses_is_a_violation(adhoc, where, sub):
    error = refused(
        adhoc(), f"SELECT COUNT(*) FROM orders WHERE NOT is_test AND ({where})"
    )
    assert isinstance(error, DeclaredDefaultMissing)
    assert error.rules == (f"{STATUS}:{sub}",)


@pytest.mark.parametrize(
    "where",
    [
        "status IS NOT NULL AND status IN ('paid', 'shipped')",
        "NOT (status IS NULL) AND status IN ('paid', 'shipped')",
    ],
)
def test_a_filter_that_removes_null_statuses_passes(adhoc, where):
    prepared = adhoc().sql.prepare(
        f"SELECT COUNT(*) FROM orders WHERE NOT is_test AND {where}"
    )
    assert prepared.checks[STATUS]["result"] == "satisfied"


def test_the_join_cap_counts_the_joins_a_view_brings(adhoc):
    s = adhoc()
    twice = "SELECT COUNT(*) FROM usd_line_value a JOIN usd_line_value b ON a.invoice_id = b.invoice_id"
    assert s.sql.prepare(twice)
    # 2 joins written, 3 views of 1 join each: 5 once expanded
    thrice = "SELECT COUNT(*) FROM usd_line_value a, usd_line_value b, usd_line_value c"
    error = refused(s, thrice)
    assert error.code == "join_limit"


def test_the_join_cap_still_counts_the_joins_written_out(adhoc):
    s = adhoc()
    joins = " ".join(
        f"JOIN customers c{i} ON c{i}.id = o.customer_id" for i in range(5)
    )
    assert refused(s, f"SELECT COUNT(*) FROM orders o {joins}").code == "join_limit"


@pytest.mark.parametrize("fn", ["GREATEST", "LEAST"])
def test_a_rate_bounded_by_a_literal_is_a_default_in_disguise(adhoc, fn):
    s = adhoc()
    sql = (
        "SELECT SUM(CASE WHEN i.currency = 'USD' THEN i.amount ELSE i.amount * "
        f"{fn}(r.rate_to_usd, 1) END) FROM invoices i ASOF LEFT JOIN fx_rates r ON {JOIN}"
    )
    prepared = s.sql.prepare(sql)
    assert prepared.checks[FX]["result"] == "satisfied"
    assert "fx_default_shape_unverified" in prepared.unverified


@pytest.mark.parametrize("fn", ["GREATEST", "LEAST"])
def test_a_rate_bounded_by_a_non_literal_is_unverified_too(adhoc, fn):
    sql = (
        "SELECT SUM(CASE WHEN i.currency = 'USD' THEN i.amount ELSE i.amount * "
        f"{fn}(r.rate_to_usd, 2 - 1) END) FROM invoices i ASOF LEFT JOIN fx_rates r ON {JOIN}"
    )
    assert "fx_default_shape_unverified" in adhoc().sql.prepare(sql).unverified


def test_greatest_over_two_rates_or_inside_the_base_branch_is_not_a_default(adhoc):
    s = adhoc()
    two_rates = (
        "SELECT SUM(CASE WHEN i.currency = 'USD' THEN i.amount ELSE i.amount * "
        f"GREATEST(r.rate_to_usd, r.rate_to_usd) END) FROM invoices i ASOF LEFT JOIN fx_rates r ON {JOIN}"
    )
    assert "fx_default_shape_unverified" not in s.sql.prepare(two_rates).unverified
    guarded = (
        "SELECT SUM(CASE WHEN i.currency = 'USD' THEN i.amount * GREATEST(r.rate_to_usd, 1) "
        f"ELSE i.amount * r.rate_to_usd END) FROM invoices i ASOF LEFT JOIN fx_rates r ON {JOIN}"
    )
    assert "fx_default_shape_unverified" not in s.sql.prepare(guarded).unverified


@pytest.mark.parametrize(
    "sql",
    [
        f"WITH t AS (SELECT amount AS total_revenue FROM orders WHERE {SCOPED}) "
        "SELECT SUM(total_revenue) FROM t",
        f"SELECT SUM(t.total_revenue) FROM (SELECT amount AS total_revenue FROM orders WHERE {SCOPED}) t",
        f"SELECT SUM(amount) AS total_revenue FROM orders WHERE {SCOPED} HAVING SUM(amount) > 0",
        f"WITH revenue_cube AS (SELECT amount FROM orders WHERE {SCOPED}) "
        "SELECT SUM(amount) FROM revenue_cube",
    ],
)
def test_an_alias_or_cte_named_like_a_cube_is_not_the_cube(adhoc, sql):
    s = adhoc(files=VIEWS)
    prepared = s.sql.prepare(sql)
    assert prepared.checks[STATUS]["result"] == "satisfied"


# -- a status filter written outside the view or derived table that reads the status model ------

ORDER_VALUE_BODY = """SELECT order_id, customer_id, status, is_test, usd_amount FROM (
  SELECT o.id AS order_id, o.customer_id AS customer_id, o.status AS status, o.is_test AS is_test,
         CASE WHEN i.currency = 'USD' THEN i.amount ELSE i.amount * r.rate_to_usd END AS usd_amount,
         ROW_NUMBER() OVER (PARTITION BY i.id ORDER BY r.rate_date DESC) AS rn
  FROM invoices i
  JOIN orders o ON o.customer_id = i.customer_id
  LEFT JOIN fx_rates r ON r.currency = i.currency AND r.rate_date <= i.invoice_date
) ranked WHERE rn = 1"""
ORDER_VALUE = {
    "views/order_value/metadata.yml": "name: order_value\nguarantees: [convert-invoices-to-usd]\n",
    "views/order_value/sql.yml": yaml.safe_dump({"statement": ORDER_VALUE_BODY}),
}
NOT_TEST = "NOT v.is_test"


def status_result(s, sql):
    """The count-paid-and-shipped verdict of sql as prepare computes it (the statement
    after view expansion), whatever the other declared rules say about the statement."""
    tree, _ = s.sql._expand_views(sqlglot.parse_one(sql, read="duckdb"))
    evaluation = evaluate(s.sql.checker, tree, None)
    found = [r for r in evaluation.violations if r.split(":")[0] == STATUS]
    if found:
        return found[0].split(":", 1)[1]
    return evaluation.checks[STATUS]["result"]


def outer_filter_statements(source):
    def sql(where):
        return f"SELECT SUM(v.usd_amount) FROM {source} v WHERE {NOT_TEST}{where}"

    return {
        "in": sql(" AND v.status IN ('paid', 'shipped')"),
        "lower-in": sql(" AND lower(v.status) IN ('paid', 'shipped')"),
        "eq-or": sql(" AND (v.status = 'paid' OR v.status = 'shipped')"),
        "not-in": sql(" AND v.status NOT IN ('cancelled', 'pending')"),
        "subset": sql(" AND v.status = 'paid'"),
        "superset": sql(" AND v.status <> 'cancelled'"),
        "none": sql(""),
    }


DERIVED_ORDER_VALUE = f"({ORDER_VALUE_BODY})"
EXPECTED_OUTER_FILTER = {
    "in": "satisfied",
    "lower-in": "satisfied",
    "eq-or": "satisfied",
    "not-in": "satisfied",
    "subset": "subset",
    "superset": "superset",
    "none": "missing",
}


@pytest.mark.parametrize("name", EXPECTED_OUTER_FILTER)
def test_a_status_filter_on_a_view_column_counts_for_the_read_inside_the_view(
    adhoc, name
):
    s = adhoc(files=ORDER_VALUE)
    sql = outer_filter_statements("order_value")[name]
    assert status_result(s, sql) == EXPECTED_OUTER_FILTER[name]


@pytest.mark.parametrize("name", EXPECTED_OUTER_FILTER)
def test_a_status_filter_on_a_derived_table_column_counts_for_the_read_inside_it(
    adhoc, name
):
    s = adhoc(files=ORDER_VALUE)
    sql = outer_filter_statements(DERIVED_ORDER_VALUE)[name]
    assert status_result(s, sql) == EXPECTED_OUTER_FILTER[name]


@pytest.mark.parametrize("name", EXPECTED_OUTER_FILTER)
def test_a_status_filter_on_a_cte_column_counts_for_the_read_inside_it(adhoc, name):
    s = adhoc(files=ORDER_VALUE)
    sql = outer_filter_statements("ov")[name]
    cte = f"WITH ov AS ({ORDER_VALUE_BODY}) {sql}"
    assert status_result(s, cte) == EXPECTED_OUTER_FILTER[name]


def status_reads(s, sql):
    """Per read of the status model: whether it sits inside a view, and what its filters keep
    (``None`` when no filter reaches it)."""
    tree, _ = s.sql._expand_views(sqlglot.parse_one(sql, read="duckdb"))
    checker = s.sql.checker
    qualified = qualify(
        tree.copy(),
        dialect="duckdb",
        schema=checker.schema,
        validate_qualify_columns=True,
        identify=False,
    )
    rule = next(r for r in checker.rules if r.id == STATUS)
    status = _Status(_Statement(qualified, checker), checker, rule, frozenset())
    kept = status.retained()
    reads = []
    instances = {id(read): read for read in status.instances}
    for index, (read, _path) in enumerate(status.paths):
        node, view = instances[read], None
        while node is not None and view is None:
            view = node.meta.get(VIEW_MARK)
            node = node.parent
        entry = kept.get(index)
        reads.append((view, None if entry is None else display(rule, entry[0])))
    return reads


JOINED_BACK = (
    "SELECT SUM(v.usd_amount) FROM order_value v JOIN orders o ON v.order_id = o.id "
    "JOIN customers c ON o.customer_id = c.id WHERE {where} AND NOT o.is_test"
)
ALL_PASSING = ["paid", "shipped"]


def test_a_filter_on_the_model_joined_to_the_view_does_not_reach_the_read_inside_the_view(
    adhoc,
):
    s = adhoc(files=ORDER_VALUE)
    for status in (
        "lower(o.status) IN ('paid', 'shipped')",
        "o.status IN ('paid', 'shipped')",
    ):
        sql = JOINED_BACK.format(where=f"{status} AND NOT v.is_test")
        assert sorted(status_reads(s, sql), key=lambda read: read[0] is None) == [
            ("order_value", None),
            (None, ALL_PASSING),
        ]
        assert status_result(s, sql) == "missing"
        assert refused(s, sql).rules == (f"{STATUS}:missing",)


def test_each_read_of_the_status_model_needs_its_own_filter(adhoc):
    s = adhoc(files=ORDER_VALUE)
    on_view = "lower(v.status) IN ('paid', 'shipped') AND NOT v.is_test"
    sql = JOINED_BACK.format(where=on_view)
    assert sorted(status_reads(s, sql), key=lambda read: read[0] is None) == [
        ("order_value", ALL_PASSING),
        (None, None),
    ]
    assert status_result(s, sql) == "missing"
    both = JOINED_BACK.format(where=f"{on_view} AND o.status IN ('paid', 'shipped')")
    assert status_result(s, both) == "satisfied"
    assert s.sql.prepare(both).checks[STATUS]["result"] == "satisfied"


def test_grouping_by_a_view_status_column_filters_nothing(adhoc):
    s = adhoc(files=ORDER_VALUE)
    sql = f"SELECT v.status, COUNT(*) FROM order_value v WHERE {NOT_TEST} GROUP BY v.status"
    assert status_result(s, sql) == "missing"


# -- date windows: the range the statement itself puts on a date column ------------------------

DATE_WINDOW_UNVERIFIED = "date_window_unverified"
JUNE = "order_date >= DATE '2026-06-01' AND order_date < DATE '2026-07-01'"


def window(column, lower, upper, lower_inclusive=True, upper_inclusive=False):
    return {
        "column": column,
        "lower": lower,
        "upper": upper,
        "lower_inclusive": lower_inclusive,
        "upper_inclusive": upper_inclusive,
    }


def windows_of(s, sql):
    prepared = s.sql.prepare(sql)
    return prepared.observed["date_windows"], prepared.unverified


def test_a_half_open_literal_range_is_one_window(adhoc):
    found, unverified = windows_of(
        adhoc(), f"SELECT COUNT(*) FROM orders WHERE {SCOPED} AND {JUNE}"
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_a_statement_with_no_date_filter_has_no_window_and_nothing_unverified(adhoc):
    found, unverified = windows_of(
        adhoc(), f"SELECT COUNT(*) FROM orders WHERE {SCOPED}"
    )
    assert found == []
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_between_is_inclusive_at_both_ends(adhoc):
    found, _ = windows_of(
        adhoc(),
        f"SELECT COUNT(*) FROM orders WHERE {SCOPED} "
        "AND order_date BETWEEN DATE '2026-06-01' AND DATE '2026-06-30'",
    )
    assert found == [
        window("orders.order_date", "2026-06-01", "2026-06-30", True, True)
    ]


def test_a_filter_inside_a_cte_or_a_subquery_is_found(adhoc):
    s = adhoc()
    cte = (
        f"WITH june AS (SELECT amount FROM orders WHERE {SCOPED} AND {JUNE}) "
        "SELECT SUM(amount) FROM june"
    )
    assert windows_of(s, cte)[0] == [
        window("orders.order_date", "2026-06-01", "2026-07-01")
    ]
    nested = f"SELECT COUNT(*) FROM (SELECT id FROM orders WHERE {SCOPED} AND {JUNE}) t"
    assert windows_of(s, nested)[0] == [
        window("orders.order_date", "2026-06-01", "2026-07-01")
    ]


def test_the_filter_on_a_cte_column_is_a_window_on_the_model_column_it_passes(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"WITH o AS (SELECT order_date AS placed, amount FROM orders WHERE {SCOPED}) "
        "SELECT SUM(amount) FROM o WHERE placed >= DATE '2026-06-01'",
    )
    assert found == [window("orders.order_date", "2026-06-01", None, True, False)]
    assert DATE_WINDOW_UNVERIFIED not in unverified


@pytest.mark.parametrize(
    "predicate",
    [
        "DATE '2026-06-01' <= order_date AND DATE '2026-07-01' > order_date",
        "order_date >= '2026-06-01' AND order_date < '2026-07-01'",
        "order_date >= CAST('2026-06-01' AS DATE) AND order_date < CAST('2026-07-01' AS DATE)",
        "order_date >= TIMESTAMP '2026-06-01' AND order_date < TIMESTAMP '2026-07-01'",
        "(order_date >= DATE '2026-06-01') AND (order_date < DATE '2026-07-01')",
    ],
)
def test_the_literal_forms_that_read_as_the_same_range(adhoc, predicate):
    found, _ = windows_of(
        adhoc(), f"SELECT COUNT(*) FROM orders WHERE {SCOPED} AND {predicate}"
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]


def test_a_timestamp_literal_keeps_its_time_and_an_equality_is_closed_both_ends(
    adhoc,
):
    s = adhoc()
    found, _ = windows_of(
        s,
        f"SELECT COUNT(*) FROM orders WHERE {SCOPED} "
        "AND order_date >= TIMESTAMP '2026-06-01 08:30:00' AND order_date <= '2026-06-02'",
    )
    assert found == [
        window("orders.order_date", "2026-06-01T08:30:00", "2026-06-02", True, True)
    ]
    day, _ = windows_of(
        s,
        f"SELECT COUNT(*) FROM orders WHERE {SCOPED} AND order_date = DATE '2026-06-15'",
    )
    assert day == [window("orders.order_date", "2026-06-15", "2026-06-15", True, True)]


def test_two_bounds_on_one_side_keep_the_narrower_and_a_tie_keeps_the_exclusive(
    adhoc,
):
    s = adhoc()
    narrower, _ = windows_of(
        s,
        f"SELECT COUNT(*) FROM orders WHERE {SCOPED} AND order_date >= DATE '2026-01-01' "
        "AND order_date >= DATE '2026-03-01' AND order_date < DATE '2026-09-01' "
        "AND order_date < DATE '2026-07-01'",
    )
    assert narrower == [window("orders.order_date", "2026-03-01", "2026-07-01")]
    tie, _ = windows_of(
        s,
        f"SELECT COUNT(*) FROM orders WHERE {SCOPED} AND order_date >= DATE '2026-03-01' "
        "AND order_date > DATE '2026-03-01'",
    )
    assert tie == [window("orders.order_date", "2026-03-01", None, False, False)]


def test_the_branches_of_a_union_are_listed_separately_and_an_equal_one_once(adhoc):
    s = adhoc()
    branch = "SELECT amount FROM orders WHERE {scoped} AND order_date >= DATE '{a}' AND order_date < DATE '{b}'"
    differing = " UNION ALL ".join(
        branch.format(scoped=SCOPED, a=a, b=b)
        for a, b in (("2026-05-01", "2026-06-01"), ("2026-06-01", "2026-07-01"))
    )
    found, _ = windows_of(s, f"SELECT SUM(amount) FROM ({differing}) u")
    assert found == [
        window("orders.order_date", "2026-05-01", "2026-06-01"),
        window("orders.order_date", "2026-06-01", "2026-07-01"),
    ]
    same = " UNION ALL ".join(
        branch.format(scoped=SCOPED, a="2026-06-01", b="2026-07-01") for _ in range(2)
    )
    assert windows_of(s, f"SELECT SUM(amount) FROM ({same}) u")[0] == [
        window("orders.order_date", "2026-06-01", "2026-07-01")
    ]


UNPINNED = [
    f"DATE_TRUNC('month', order_date) = DATE '2026-06-01' AND {SALES}",
    f"EXTRACT(month FROM order_date) = 6 AND {SALES}",
    f"order_date >= DATE '2026-06-01' + INTERVAL 1 MONTH AND {SALES}",
    f"(order_date >= DATE '2026-06-01' OR order_date < DATE '2025-01-01') AND {SALES}",
    f"order_date NOT BETWEEN DATE '2026-06-01' AND DATE '2026-06-30' AND {SALES}",
    f"order_date IN (DATE '2026-06-01', DATE '2026-06-02') AND {SALES}",
    f"order_date >= (SELECT MIN(invoice_date) FROM invoices) AND {SALES}",
    f"order_date <> DATE '2026-06-01' AND {SALES}",
]


@pytest.mark.parametrize("predicate", UNPINNED)
def test_a_date_filter_the_host_cannot_pin_is_not_a_window_and_is_unverified(
    adhoc, predicate
):
    found, unverified = windows_of(
        adhoc(), f"SELECT COUNT(*) FROM orders WHERE NOT is_test AND {predicate}"
    )
    assert found == []
    # Before the semantics ids; the sample project declares one for orders.
    assert unverified == [DATE_WINDOW_UNVERIFIED, "fiscal_calendar_bounds"]


@pytest.mark.parametrize("test", ["order_date IS NOT NULL", "NOT (order_date IS NULL)"])
def test_a_null_test_on_a_date_column_is_neither_a_window_nor_unverified(adhoc, test):
    s = adhoc()
    found, unverified = windows_of(
        s, f"SELECT COUNT(*) FROM orders WHERE {SCOPED} AND {test}"
    )
    assert found == []
    assert DATE_WINDOW_UNVERIFIED not in unverified
    both, unverified = windows_of(
        s, f"SELECT COUNT(*) FROM orders WHERE {SCOPED} AND {test} AND {JUNE}"
    )
    assert both == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_a_literal_range_does_not_survive_another_kind_of_filter_on_the_same_column(
    adhoc,
):
    found, unverified = windows_of(
        adhoc(),
        f"SELECT COUNT(*) FROM orders WHERE {SCOPED} AND {JUNE} "
        "AND DATE_TRUNC('month', order_date) = DATE '2026-06-01'",
    )
    assert found == []
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_a_date_column_compared_with_another_column_in_where_is_unverified(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"SELECT COUNT(*) FROM orders o JOIN invoices i ON o.customer_id = i.customer_id "
        f"WHERE NOT o.is_test AND o.{SALES} AND o.order_date >= i.invoice_date",
    )
    assert found == []
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_a_date_compared_with_a_column_in_a_join_condition_is_the_join_not_a_filter(
    adhoc,
):
    found, unverified = windows_of(
        adhoc(),
        f"SELECT COUNT(*) FROM orders o JOIN invoices i ON o.customer_id = i.customer_id "
        f"AND o.order_date >= i.invoice_date WHERE NOT o.is_test AND o.{SALES}",
    )
    assert found == []
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_a_literal_in_a_join_condition_is_a_window(adhoc):
    found, _ = windows_of(
        adhoc(),
        "SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.id "
        "AND o.order_date >= DATE '2026-06-01' WHERE NOT o.is_test AND o.status IN ('paid', 'shipped')",
    )
    assert found == [window("orders.order_date", "2026-06-01", None, True, False)]


@pytest.mark.parametrize(
    "form",
    [
        "SUM(CASE WHEN order_date >= DATE '2026-06-01' THEN amount ELSE 0 END)",
        "SUM(amount) FILTER (WHERE order_date >= DATE '2026-06-01')",
    ],
)
def test_a_date_condition_inside_an_aggregate_is_not_a_window_and_is_unverified(
    adhoc, form
):
    found, unverified = windows_of(adhoc(), f"SELECT {form} FROM orders WHERE {SCOPED}")
    assert found == []
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_a_value_derived_from_a_date_column_carries_its_unverified_filter_outward(
    adhoc,
):
    found, unverified = windows_of(
        adhoc(),
        "WITH m AS (SELECT DATE_TRUNC('month', order_date) AS month, amount FROM orders "
        f"WHERE {SCOPED}) SELECT SUM(amount) FROM m WHERE month >= DATE '2026-06-01'",
    )
    assert found == []
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_ranking_rows_by_a_date_is_not_a_date_filter(adhoc):
    found, unverified = windows_of(
        adhoc(),
        "SELECT COUNT(*) FROM (SELECT customer_id, ROW_NUMBER() OVER "
        f"(PARTITION BY customer_id ORDER BY order_date DESC) AS rn FROM orders WHERE {SCOPED}) t "
        "WHERE rn = 1",
    )
    assert found == []
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_a_non_date_column_compared_with_a_date_looking_string_is_ignored(adhoc):
    found, unverified = windows_of(
        adhoc(), "SELECT COUNT(*) FROM customers WHERE region >= '2026-06-01'"
    )
    assert found == []
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_two_columns_with_different_ranges_are_two_windows(adhoc):
    s = adhoc()
    sql = (
        "SELECT COUNT(*) FROM orders o JOIN invoices i ON o.customer_id = i.customer_id "
        "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped') "
        "AND o.order_date >= DATE '2026-06-01' AND o.order_date < DATE '2026-07-01' "
        "AND i.invoice_date >= DATE '2026-05-01' AND i.invoice_date < DATE '2026-06-01'"
    )
    found, unverified = windows_of(s, sql)
    assert found == [
        window("orders.order_date", "2026-06-01", "2026-07-01"),
        window("invoices.invoice_date", "2026-05-01", "2026-06-01"),
    ]
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_a_pinned_column_stays_listed_beside_an_unpinned_one(adhoc):
    found, unverified = windows_of(
        adhoc(),
        "SELECT COUNT(*) FROM orders o JOIN invoices i ON o.customer_id = i.customer_id "
        "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped') "
        "AND DATE_TRUNC('month', o.order_date) = DATE '2026-06-01' "
        "AND i.invoice_date >= DATE '2026-06-01'",
    )
    assert found == [window("invoices.invoice_date", "2026-06-01", None, True, False)]
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_a_window_comes_from_the_ast_not_from_text_the_statement_carries(adhoc):
    found, _ = windows_of(
        adhoc(),
        f"SELECT COUNT(*) FROM orders WHERE {SCOPED} AND {JUNE} /* order_date >= DATE '1999-01-01' */",
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]


def test_the_date_windows_of_a_view_statement_follow_the_expanded_body(adhoc):
    s = adhoc()
    found, unverified = windows_of(
        s, "SELECT COUNT(*) FROM usd_line_value WHERE invoice_date >= DATE '2026-01-01'"
    )
    assert found == [window("invoices.invoice_date", "2026-01-01", None, True, False)]
    assert DATE_WINDOW_UNVERIFIED not in unverified


# -- a period must bound every read of the statement ----------------------------------------------

JUNE_BRANCH = f"SELECT COUNT(*) AS n FROM orders WHERE {SCOPED} AND {JUNE}"
ALL_TIME_BRANCH = f"SELECT COUNT(*) AS n FROM orders WHERE {SCOPED}"


def test_an_unwindowed_union_branch_over_a_windowed_model_is_unpinned(adhoc):
    found, unverified = windows_of(
        adhoc(), f"{JUNE_BRANCH} UNION ALL {ALL_TIME_BRANCH}"
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_a_june_numerator_over_an_all_time_denominator_is_unpinned(adhoc):
    s = adhoc()
    scalar = (
        f"SELECT (SELECT COUNT(*) FROM orders WHERE {SCOPED} AND {JUNE}) * 1.0 "
        f"/ (SELECT COUNT(*) FROM orders WHERE {SCOPED}) AS share"
    )
    ctes = (
        f"WITH june AS (SELECT COUNT(*) AS n FROM orders WHERE {SCOPED} AND {JUNE}), "
        f"everything AS (SELECT COUNT(*) AS n FROM orders WHERE {SCOPED}) "
        "SELECT june.n * 1.0 / everything.n AS share FROM june, everything"
    )
    for sql in (scalar, ctes):
        found, unverified = windows_of(s, sql)
        assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
        assert DATE_WINDOW_UNVERIFIED in unverified


def test_a_window_beside_an_unreadable_filter_on_another_model_is_unpinned(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"{JUNE_BRANCH} UNION ALL SELECT COUNT(*) AS n FROM invoices "
        "WHERE DATE_TRUNC('month', invoice_date) = DATE '2026-06-01'",
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_two_branches_with_the_same_window_are_one_pinned_window(adhoc):
    found, unverified = windows_of(adhoc(), f"{JUNE_BRANCH} UNION ALL {JUNE_BRANCH}")
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_a_window_on_a_derived_column_covers_the_select_it_passes_through(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"WITH base AS (SELECT order_date AS placed, amount FROM orders WHERE {SCOPED}), "
        "june AS (SELECT amount FROM base WHERE placed >= DATE '2026-06-01') "
        "SELECT SUM(amount) FROM june",
    )
    assert found == [window("orders.order_date", "2026-06-01", None, True, False)]
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_a_model_without_a_window_anywhere_does_not_make_the_period_unpinned(adhoc):
    found, unverified = windows_of(
        adhoc(),
        "SELECT COUNT(*) FROM orders o JOIN customers c ON o.customer_id = c.id "
        f"WHERE NOT o.is_test AND o.{SALES} AND o.order_date >= DATE '2026-06-01'",
    )
    assert found == [window("orders.order_date", "2026-06-01", None, True, False)]
    assert DATE_WINDOW_UNVERIFIED not in unverified


# -- null tests inside aggregates are as neutral as in WHERE; HAVING and QUALIFY are scanned ---------


@pytest.mark.parametrize(
    "form",
    [
        "COUNT(*) FILTER (WHERE order_date IS NULL)",
        "COUNT(*) FILTER (WHERE order_date IS NOT NULL)",
        "SUM(CASE WHEN order_date IS NULL THEN 1 ELSE 0 END)",
        "SUM(CASE WHEN NOT (order_date IS NULL) THEN 1 ELSE 0 END)",
    ],
)
def test_a_null_test_in_filter_or_case_is_neither_a_window_nor_unverified(adhoc, form):
    found, unverified = windows_of(adhoc(), f"SELECT {form} FROM orders WHERE {SCOPED}")
    assert found == []
    assert DATE_WINDOW_UNVERIFIED not in unverified


@pytest.mark.parametrize(
    "form",
    [
        "COUNT(*) FILTER (WHERE order_date IS NULL OR order_date >= DATE '2026-06-01')",
        "COUNT(*) FILTER (WHERE order_date IS NOT NULL AND order_date >= DATE '2026-06-01')",
        "SUM(CASE WHEN order_date IS NULL OR order_date < DATE '2026-06-01' THEN 1 ELSE 0 END)",
    ],
)
def test_a_date_comparison_beside_a_null_test_in_an_aggregate_is_still_unpinned(
    adhoc, form
):
    found, unverified = windows_of(adhoc(), f"SELECT {form} FROM orders WHERE {SCOPED}")
    assert found == []
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_having_on_a_grouped_date_column_is_a_window(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"SELECT order_date, COUNT(*) FROM orders WHERE {SCOPED} GROUP BY order_date "
        "HAVING order_date >= DATE '2026-06-01'",
    )
    assert found == [window("orders.order_date", "2026-06-01", None, True, False)]
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_having_on_an_aggregate_of_a_date_column_is_not_a_window(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"SELECT customer_id, COUNT(*) FROM orders WHERE {SCOPED} GROUP BY customer_id "
        "HAVING MIN(order_date) >= DATE '2026-06-01'",
    )
    assert found == []
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_qualify_on_a_date_column_is_a_window(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"SELECT amount FROM orders WHERE {SCOPED} QUALIFY order_date >= DATE '2026-06-01'",
    )
    assert found == [window("orders.order_date", "2026-06-01", None, True, False)]
    assert DATE_WINDOW_UNVERIFIED not in unverified


# -- coverage is per consuming edge ---------------------------------------------------------------

BASE_CTE = (
    "WITH base AS (SELECT id, customer_id, order_date, amount FROM orders "
    f"WHERE {SCOPED})"
)
JUNE_ON_BASE = "order_date >= DATE '2026-06-01' AND order_date < DATE '2026-07-01'"


def test_a_shared_cte_filtered_by_one_consumer_only_is_unpinned(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"{BASE_CTE} SELECT COUNT(*) AS n FROM base WHERE {JUNE_ON_BASE} "
        "UNION ALL SELECT COUNT(*) AS n FROM base",
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_a_ratio_of_two_consumers_of_one_cte_is_unpinned(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"{BASE_CTE}, jn AS (SELECT COUNT(*) AS jc FROM base WHERE {JUNE_ON_BASE}), "
        "an AS (SELECT COUNT(*) AS ac FROM base) "
        "SELECT jn.jc * 1.0 / an.ac AS share FROM jn, an",
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_two_consumers_of_one_cte_with_the_same_window_are_pinned(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"{BASE_CTE} SELECT COUNT(*) AS n FROM base WHERE {JUNE_ON_BASE} "
        f"UNION ALL SELECT COUNT(*) AS n FROM base WHERE {JUNE_ON_BASE}",
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_two_consumers_of_one_cte_with_different_windows_list_both(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"{BASE_CTE} SELECT COUNT(*) AS n FROM base WHERE {JUNE_ON_BASE} "
        "UNION ALL SELECT COUNT(*) AS n FROM base "
        "WHERE order_date >= DATE '2026-05-01' AND order_date < DATE '2026-06-01'",
    )
    assert found == [
        window("orders.order_date", "2026-06-01", "2026-07-01"),
        window("orders.order_date", "2026-05-01", "2026-06-01"),
    ]
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_a_filter_inside_a_shared_cte_bounds_every_consumer(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"WITH june AS (SELECT amount FROM orders WHERE {SCOPED} AND {JUNE}) "
        "SELECT COUNT(*) AS n FROM june UNION ALL SELECT COUNT(*) AS n FROM june",
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED not in unverified


def test_a_cte_filtered_by_its_only_consumer_through_a_derived_table_is_pinned(adhoc):
    found, unverified = windows_of(
        adhoc(),
        f"{BASE_CTE} SELECT COUNT(*) AS n FROM "
        "(SELECT order_date FROM base) t "
        "WHERE t.order_date >= DATE '2026-06-01' AND t.order_date < DATE '2026-07-01'",
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED not in unverified


@pytest.mark.parametrize(
    "unused", [f"SELECT id FROM orders WHERE {SCOPED}", "SELECT id FROM orders"]
)
def test_a_cte_that_nothing_reads_does_not_matter(adhoc, unused):
    found, unverified = windows_of(
        adhoc(),
        f"WITH unused AS ({unused}) "
        f"SELECT COUNT(*) AS n FROM orders WHERE {SCOPED} AND {JUNE}",
    )
    assert found == [window("orders.order_date", "2026-06-01", "2026-07-01")]
    assert DATE_WINDOW_UNVERIFIED not in unverified


def _windows_over_a_mixed_case_model(sql):
    """``_date_windows`` on a statement over a model whose catalog name is ``Orders``."""
    schema = {"Orders": {"order_date": "DATE", "amount": "INT"}}
    tree = qualify(
        sqlglot.parse_one(sql, read="duckdb"),
        dialect="duckdb",
        schema=schema,
        validate_qualify_columns=True,
        identify=True,
    )
    checker = AdHocSQL.__new__(AdHocSQL)
    checker.date_columns = frozenset({("orders", "order_date")})
    found, pinned = checker._date_windows(list(traverse_scope(tree)))
    return len(found), pinned


def test_the_case_of_a_model_name_does_not_change_the_verdict():
    june = (
        "SELECT SUM(amount) AS n FROM Orders WHERE order_date >= DATE '2026-06-01' "
        "AND order_date < DATE '2026-07-01'"
    )
    everything = "SELECT SUM(amount) AS n FROM Orders"
    assert _windows_over_a_mixed_case_model(f"{june} UNION ALL {june}") == (1, True)
    assert _windows_over_a_mixed_case_model(f"{june} UNION ALL {everything}") == (
        1,
        False,
    )


def test_a_self_join_is_judged_per_alias(adhoc):
    found, unverified = windows_of(
        adhoc(),
        "SELECT COUNT(*) AS n FROM orders o JOIN orders p ON p.customer_id = o.customer_id "
        "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped') "
        "AND NOT p.is_test AND p.status IN ('paid', 'shipped') "
        "AND o.order_date >= DATE '2026-06-01'",
    )
    assert found == [window("orders.order_date", "2026-06-01", None, True, False)]
    assert DATE_WINDOW_UNVERIFIED in unverified


def test_a_self_join_with_a_window_on_each_alias_is_pinned(adhoc):
    found, unverified = windows_of(
        adhoc(),
        "SELECT COUNT(*) AS n FROM orders o JOIN orders p ON p.customer_id = o.customer_id "
        "AND p.order_date >= DATE '2026-06-01' "
        "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped') "
        "AND NOT p.is_test AND p.status IN ('paid', 'shipped') "
        "AND o.order_date >= DATE '2026-06-01'",
    )
    assert found == [window("orders.order_date", "2026-06-01", None, True, False)]
    assert DATE_WINDOW_UNVERIFIED not in unverified


JOIN_ON_JUNE_ORDERS = "AND o.order_date >= DATE '2026-06-01'"
OWN_ROWS = "WHERE NOT o.is_test AND o.status IN ('paid', 'shipped')"


@pytest.mark.parametrize(
    "join",
    [
        f"orders o LEFT JOIN invoices i ON o.customer_id = i.customer_id {JOIN_ON_JUNE_ORDERS}",
        f"invoices i RIGHT JOIN orders o ON o.customer_id = i.customer_id {JOIN_ON_JUNE_ORDERS}",
        f"orders o FULL JOIN invoices i ON o.customer_id = i.customer_id {JOIN_ON_JUNE_ORDERS}",
    ],
)
def test_an_on_literal_on_the_preserved_side_of_an_outer_join_is_no_window(adhoc, join):
    found, unverified = windows_of(adhoc(), f"SELECT COUNT(*) FROM {join} {OWN_ROWS}")
    assert found == []
    assert DATE_WINDOW_UNVERIFIED not in unverified


@pytest.mark.parametrize(
    "join",
    [
        f"orders o JOIN invoices i ON o.customer_id = i.customer_id {JOIN_ON_JUNE_ORDERS}",
        "orders o LEFT JOIN invoices i ON o.customer_id = i.customer_id "
        "AND i.invoice_date >= DATE '2026-06-01'",
        "invoices i RIGHT JOIN orders o ON o.customer_id = i.customer_id "
        "AND i.invoice_date >= DATE '2026-06-01'",
    ],
)
def test_an_on_literal_that_filters_a_kept_side_stays_a_window(adhoc, join):
    found, _ = windows_of(adhoc(), f"SELECT COUNT(*) FROM {join} {OWN_ROWS}")
    assert len(found) == 1


@pytest.mark.parametrize(
    "predicate,partition",
    [
        ("r.rn = 1 OR i.amount > 0", "currency"),
        ("1 <= r.rn", "currency"),
        ("r.rn = 1", "currency, rate_date"),
    ],
)
def test_ranked_fx_counterexamples_never_mint_satisfied_evidence(
    adhoc, predicate, partition
):
    service = adhoc()
    sql = f"""SELECT SUM(CASE WHEN i.currency = 'USD' THEN i.amount ELSE i.amount * r.rate_to_usd END)
        FROM invoices i LEFT JOIN (SELECT currency, rate_date, rate_to_usd,
        ROW_NUMBER() OVER (PARTITION BY {partition} ORDER BY rate_date DESC) AS rn FROM fx_rates) r
        ON r.currency = i.currency AND r.rate_date <= i.invoice_date WHERE {predicate}"""
    with pytest.raises(DeclaredDefaultMissing) as raised:
        service.sql.prepare(sql)
    assert "convert-invoices-to-usd:rate_multi_match" in raised.value.rules
    assert not events(service, "private_sql")
    result = ask(service, FX_GUARDED)
    assert result["result"]["rows"] == [{"c1": 1550.0}]
    assert result["evidence"]["checks_summary"] == "all_satisfied"
    assert result["evidence"]["has_unverified_semantics"] is False


def test_explicit_wrong_status_case_cannot_mint_zero_count_evidence(adhoc):
    service = adhoc()
    with pytest.raises(DeclaredDefaultMissing) as raised:
        service.sql.prepare(
            "SELECT COUNT(*) FROM orders WHERE NOT is_test AND UPPER(status) IN ('paid', 'shipped')"
        )
    assert "count-paid-and-shipped:subset" in raised.value.rules
    result = ask(
        service,
        "SELECT COUNT(*) FROM orders WHERE NOT is_test AND UPPER(status) IN ('PAID', 'SHIPPED')",
    )
    assert result["result"]["rows"] == [{"c1": 12}]


@pytest.mark.parametrize("action", ["deadline", "session_close", "shutdown"])
def test_governed_direct_sql_owns_and_reaps_its_query_process(adhoc, action):
    import threading  # noqa: PLC0415
    import time  # noqa: PLC0415
    from dataclasses import replace  # noqa: PLC0415

    import duckdb  # noqa: PLC0415

    from wren.agent_service import SQL  # noqa: PLC0415

    service = adhoc(
        policy='permit(principal, action, resource) when { principal.role == "planner" && ((action == Service::Action::"invoke_tool" && resource.name == "run_sql") || action == Service::Action::"execute_query") };'
    )
    service.execution = replace(
        service.execution, deadline_ms=1500 if action == "deadline" else 30000
    )
    with duckdb.connect(
        str(service.project.root.parent / "data/synthetic.duckdb")
    ) as db:
        db.execute("DROP TABLE raw_orders")
        db.execute(
            "CREATE VIEW raw_orders AS SELECT (i % 1000)::INTEGER id, 1::INTEGER customer_id, TIMESTAMP '2026-01-06' order_date, i::DOUBLE amount, FALSE is_test, 'paid' status FROM range(1000000000000) t(i)"
        )
    sid = service.open()["session_id"]
    request = SQL(
        session_id=sid,
        request_id="slow",
        expected_revision=0,
        capability="analytics",
        sql="SELECT SUM(amount) FROM orders WHERE NOT is_test AND status IN ('paid', 'shipped')",
    )
    outcome = []

    def run_direct():
        try:
            outcome.append(service.execute(request, direct={"sql": request.sql}))
        except Exception as error:
            outcome.append(error)

    thread = threading.Thread(target=run_direct)
    thread.start()
    try:
        end = time.monotonic() + 5
        lifetime = None
        children = []
        while time.monotonic() < end:
            lifetime = service.sessions[sid].get("query_lifetime")
            children = list(lifetime.children) if lifetime else []
            if children:
                break
            time.sleep(0.01)
        assert children
        if action == "session_close":
            service.close(sid)
        elif action == "shutdown":
            service.shutdown()
        thread.join(5)
        assert not thread.is_alive()
        assert len(outcome) == 1 and isinstance(outcome[0], Exception)
        assert not lifetime.children
        assert all(child.poll() is not None for child in children)
        assert not service.sessions[sid]["results"]
        assert not service.sessions[sid]["evidence"]
        assert not events(service, "task_completed")
    finally:
        if lifetime:
            lifetime.cancel()
        thread.join(5)


def test_ranked_rate_sources_cannot_prove_each_others_partition_keys(adhoc):
    service = adhoc()
    sql = """WITH ranked AS (
        SELECT currency, rate_date, rate_to_usd,
        ROW_NUMBER() OVER (PARTITION BY currency, rate_date ORDER BY rate_date DESC) AS rn
        FROM fx_rates)
        SELECT SUM(CASE WHEN i.currency='USD' THEN i.amount ELSE i.amount*r.rate_to_usd END)
        FROM invoices i
        LEFT JOIN ranked r ON r.currency=i.currency AND r.rate_date<=i.invoice_date
        LEFT JOIN ranked s ON s.currency=i.currency AND s.rate_date<=i.invoice_date
        WHERE r.rn=1 AND s.rn=1 AND r.rate_date=s.rate_date"""
    with pytest.raises(DeclaredDefaultMissing) as raised:
        service.sql.prepare(sql)
    assert "convert-invoices-to-usd:rate_multi_match" in raised.value.rules


def date_window_proof(sql):
    tree = qualify(
        sqlglot.parse_one(sql, read="duckdb"),
        dialect="duckdb",
        schema={
            "orders": {"id": "INT", "order_date": "DATE"},
            "customers": {"id": "INT"},
        },
        validate_qualify_columns=True,
        identify=False,
    )
    gate = AdHocSQL.__new__(AdHocSQL)
    gate.date_columns = frozenset({("orders", "order_date")})
    return gate._date_windows(list(traverse_scope(tree)))


def test_date_coverage_tracks_each_alias_of_the_same_cte():
    prefix = "WITH shared AS (SELECT id,order_date FROM orders) SELECT COUNT(*) FROM shared a JOIN shared b ON a.id=b.id WHERE "
    one = "a.order_date >= DATE '2026-06-01'"
    assert date_window_proof(prefix + one)[1] is False
    assert (
        date_window_proof(prefix + one + " AND b.order_date >= DATE '2026-06-01'")[1]
        is True
    )


def test_different_self_join_windows_are_kept_separate():
    sql = "SELECT COUNT(*) FROM orders a JOIN orders b ON a.id=b.id WHERE a.order_date >= DATE '2026-06-01' AND b.order_date >= DATE '2026-05-01'"
    windows, _ = date_window_proof(sql)
    assert {entry["lower"] for entry in windows} == {"2026-06-01", "2026-05-01"}


def test_nullable_side_on_window_cannot_certify_the_statement_period():
    sql = "SELECT COUNT(*) FROM customers c LEFT JOIN orders o ON c.id=o.id AND o.order_date >= DATE '2026-06-01'"
    windows, pinned = date_window_proof(sql)
    assert len(windows) == 1 and pinned is False


def test_real_adhoc_preserves_entity_keys_and_manifest_relationships(adhoc):
    service = adhoc()
    full = DefaultsChecker(
        service.project.snapshot.declarations,
        service.project.snapshot.manifest,
        "duckdb",
    )
    assert service.sql.checker.joins == full.joins and full.joins
    assert ("orders", "id") in service.sql.checker.entity_keys
    sql = "SELECT COUNT(*) FROM orders o WHERE o.id IN (SELECT x.id FROM orders x WHERE NOT x.is_test AND x.status IN ('paid','shipped')) AND o.status IN ('paid','shipped')"
    assert full.check(sqlglot.parse_one(sql, dialect="duckdb")) == []
    assert service.sql.prepare(sql)


def test_real_adhoc_relationship_exclusion_matches_governed_checker(adhoc):
    template = adhoc()
    root = template.project.root
    customers = yaml.safe_load((root / "models/customers/metadata.yml").read_text())
    customers["columns"].append({"name": "is_test", "type": "BOOLEAN"})
    rule = """---
defaults:
  - id: exclude-test-customers
    kind: exclude_rows
    column: customers.is_test
    exclude: true
    covers: {reaching: customers, via: many_to_one}
    unless: [addresses_column]
---
Test customers are excluded from business orders.
"""
    service = adhoc(
        files={
            "models/customers/metadata.yml": yaml.safe_dump(customers),
            "models/customers/ref_sql.sql": "SELECT id, region, email, id = 1 AS is_test FROM synthetic.main.raw_customers",
            "knowledge/rules/customer-tests.md": rule,
        }
    )
    predicate = "o.customer_id NOT IN (SELECT c.id FROM customers c WHERE c.is_test)"
    sql = f"SELECT COUNT(*) FROM orders o WHERE NOT o.is_test AND o.status IN ('paid','shipped') AND {predicate}"
    # Governed stdio constructs this checker from the full built manifest.
    checker = DefaultsChecker(
        service.project.snapshot.declarations,
        service.project.snapshot.manifest,
        "duckdb",
    )
    assert checker.check(sqlglot.parse_one(sql, dialect="duckdb")) == []
    without_relationships = DefaultsChecker(
        service.project.snapshot.declarations,
        {**service.project.snapshot.manifest, "relationships": []},
        "duckdb",
    )
    assert "exclude-test-customers" in without_relationships.check(
        sqlglot.parse_one(sql, dialect="duckdb")
    )
    assert service.sql.prepare(sql)


def _mixed_case_gate(denied=()):
    model = {"name": "Orders", "columns": [{"name": "id", "type": "INTEGER"}]}
    snap = SimpleNamespace(
        catalog={"models": [model]}, manifest={}, declarations=(), denied=denied
    )
    return AdHocSQL(SimpleNamespace(snapshot=snap))


@pytest.mark.parametrize("table", ["Orders", "orders", '"Orders"'])
def test_qualified_mixed_case_models_remain_queryable(table):
    prepared = _mixed_case_gate().prepare(f"SELECT COUNT(*) AS n FROM {table}")
    assert prepared.sources == {"orders": []}


def test_mixed_case_models_retain_rewritable_function_errors_and_denials():
    with pytest.raises(QueryFormError) as caught:
        _mixed_case_gate().prepare("SELECT now() FROM Orders")
    assert caught.value.code == "unsupported_function"
    with pytest.raises(PermissionError):
        _mixed_case_gate({("Orders", "id")}).prepare("SELECT id FROM Orders")
    with pytest.raises(PermissionError):
        _mixed_case_gate().prepare("SELECT COUNT(*) FROM unknown")


def _consumed_source_gate():
    models = [
        {"name": "customers", "columns": [{"name": "id", "type": "INT"}]},
        {
            "name": "orders",
            "columns": [
                {"name": "id", "type": "INT"},
                {"name": "order_date", "type": "DATE"},
            ],
        },
    ]
    snapshot = SimpleNamespace(
        catalog={"models": models},
        manifest={"models": models},
        declarations=(),
        denied=(),
    )
    return AdHocSQL(SimpleNamespace(snapshot=snapshot))


@pytest.mark.parametrize(
    "unused",
    [
        "SELECT id FROM orders",
        "SELECT COUNT(*) AS n FROM orders",
        "SELECT id FROM orders WHERE order_date >= DATE '2026-06-01' AND order_date < DATE '2026-07-01'",
    ],
)
def test_unused_cte_has_no_source_permission_or_observed_fact(unused):
    prepared = _consumed_source_gate().prepare(
        f"WITH unused AS ({unused}) SELECT id FROM customers"
    )
    assert prepared.sources == {"customers": ["id"]}
    assert prepared.observed["models"] == ["customers"]
    assert not prepared.observed["aggregated"]
    assert prepared.observed["filters"] == []
    assert prepared.observed["date_windows"] == []


@pytest.mark.parametrize(
    "sql",
    [
        "WITH live AS (SELECT id,order_date FROM orders), nested AS (SELECT id FROM live WHERE order_date >= DATE '2026-06-01') SELECT COUNT(*) FROM nested",
        "WITH live AS (WITH ignored AS (SELECT id FROM customers) SELECT id,order_date FROM orders WHERE order_date >= DATE '2026-06-01') SELECT COUNT(*) FROM live",
    ],
)
def test_consumed_nested_ctes_keep_their_sources_and_windows(sql):
    prepared = _consumed_source_gate().prepare(sql)
    assert prepared.sources.keys() == {"orders"}
    assert prepared.observed["models"] == ["orders"]
    assert prepared.observed["date_windows"]


@pytest.mark.parametrize(
    "sql",
    [
        "WITH unused AS (SELECT id FROM orders) SELECT COUNT(*) FROM customers",
        "SELECT COUNT(*) FROM customers SEMI JOIN orders ON orders.id = customers.id",
        "SELECT id FROM customers UNION ALL SELECT id FROM orders",
    ],
)
def test_scope_pruning_retains_consumed_join_and_set_sources(sql):
    prepared = _consumed_source_gate().prepare(sql)
    expected = {"customers"} if sql.startswith("WITH") else {"customers", "orders"}
    assert prepared.sources.keys() == expected


@pytest.mark.parametrize(
    "value,expected_type",
    [
        (2**53 + 1, str),
        (-(2**53 + 1), str),
        (2**53 - 1, int),
        (-(2**53 - 1), int),
        (True, bool),
        (False, bool),
    ],
)
def test_native_integer_wire_values_preserve_exactness_and_boolean_types(
    monkeypatch, value, expected_type
):
    import pyarrow as pa  # noqa: PLC0415

    import wren.agent_sql as module  # noqa: PLC0415

    query = AdHocSQL.__new__(AdHocSQL)
    query.project = SimpleNamespace(engine=object(), current=lambda: None)
    monkeypatch.setattr(
        module, "governed_query", lambda *_: pa.table({"value": [value]})
    )
    result, _ = query.execute(("SELECT value", [], [], ["value"], {}, {}, []))
    actual = result["rows"][0]["c1"]
    assert type(actual) is expected_type
    assert actual == (str(value) if expected_type is str else value)
