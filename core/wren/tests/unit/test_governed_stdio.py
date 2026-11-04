"""Exercise the transport with a captured synthetic binding; never open a database."""

import io
import json
import shutil
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner

from wren import cli
from wren import governed_stdio as transport
from wren.cli import app
from wren.context import build_json as build_project_manifest
from wren.declared_default_check import _Statement
from wren.declared_defaults import DeclarationError
from wren.model.error import ErrorCode, ErrorPhase, WrenError

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT COUNT(*) FROM main.orders",
        "SELECT COUNT(*) FROM external.orders",
        "SELECT COUNT(*) FROM memory.main.orders",
        'SELECT COUNT(*) FROM "external"."orders"',
        "WITH c AS (SELECT * FROM external.orders) SELECT COUNT(*) FROM c",
    ],
)
def test_qualified_physical_sources_never_reach_the_governed_engine(
    bound_transport, sql
):
    request = {"id": 1, "operation": "query", "sql": sql, "limit": 1}
    frames = bound_transport.run((json.dumps(request) + "\n").encode())
    assert frames[-1]["error"]["class"] == "model_not_found"
    bound_transport.engine.query.assert_not_called()


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT COUNT(*) FROM orders",
        'SELECT COUNT(*) FROM "orders"',
        "WITH c AS (SELECT * FROM orders) SELECT COUNT(*) FROM c",
    ],
)
def test_unqualified_models_and_ctes_keep_governed_support(bound_transport, sql):
    request = {"id": 1, "operation": "query", "sql": sql, "limit": 1}
    assert "result" in bound_transport.run((json.dumps(request) + "\n").encode())[-1]
    bound_transport.engine.query.assert_called_once()


@pytest.fixture
def bound_transport(tmp_path, monkeypatch):
    (tmp_path / "wren_project.yml").write_text("name: synthetic\nprofile: fixture\n")
    profile = MagicMock(
        return_value=("fixture", {"datasource": "duckdb", "path": "secret"})
    )
    manifest = {"models": [{"name": "orders"}]}
    build = MagicMock(return_value=manifest)
    engine = MagicMock()
    engine.__enter__.return_value = engine
    engine.query.return_value = SimpleNamespace(
        column_names=["n"], to_pylist=lambda: [{"n": 1}]
    )
    factory = MagicMock(return_value=engine)
    config = MagicMock(return_value={})
    monkeypatch.setattr(transport, "resolve_profile_for_project", profile)
    monkeypatch.setattr(
        transport, "expand_profile_secrets", lambda value, **_: dict(value)
    )
    monkeypatch.setattr(transport, "build_json", build)
    monkeypatch.setattr(transport, "load_config", config)
    monkeypatch.setattr(transport, "WrenEngine", factory)

    def run(messages):
        output = io.StringIO()
        monkeypatch.setattr(
            transport.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(messages))
        )
        monkeypatch.setattr(transport.sys, "stdout", output)
        transport.serve(tmp_path)
        return [json.loads(line) for line in output.getvalue().splitlines()]

    return SimpleNamespace(
        run=run,
        engine=engine,
        profile=profile,
        build=build,
        factory=factory,
        config=config,
        project=tmp_path,
    )


@pytest.mark.parametrize(
    "project_yml", ["name: synthetic\n", "name: synthetic\nprofile: ''\n", "[]"]
)
def test_a_project_without_a_profile_pin_never_falls_back_to_the_active_profile(
    bound_transport, project_yml
):
    f = bound_transport
    (f.project / "wren_project.yml").write_text(project_yml)
    with pytest.raises(ValueError, match="profile pin"):
        f.run(b'{"id":1,"operation":"inspect"}\n')
    f.profile.assert_not_called()
    f.factory.assert_not_called()


def test_captures_once_and_always_queries_read_only(bound_transport):
    f = bound_transport
    frames = f.run(
        b'{"id":1,"operation":"inspect"}\n{"id":2,"operation":"query","sql":"SELECT n FROM orders","limit":5}\n'
    )
    assert frames == [
        {"id": 0, "protocol": "wren-governed/2"},
        {"id": 1, "result": {"models": [{"name": "orders"}]}},
        {
            "id": 2,
            "result": {
                "columns": ["n"],
                "rows": [{"n": 1}],
                "definition": {
                    "sql": "SELECT n FROM orders",
                    "source_tables": ["orders"],
                    "filters": [],
                },
            },
        },
    ]
    for captured in (f.profile, f.build, f.config, f.factory):
        captured.assert_called_once()
    f.engine.query.assert_called_once_with(
        "SELECT n FROM orders", limit=5, read_only=True
    )
    f.engine.__exit__.assert_called_once()


def test_profile_secrets_come_from_the_bound_project_not_the_cwd(
    bound_transport, monkeypatch, tmp_path
):
    from wren.profile import expand_profile_secrets  # noqa: PLC0415

    f = bound_transport
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (f.project / ".env").write_text("BOUND_TRANSPORT_SECRET=project-secret\n")
    monkeypatch.chdir(elsewhere)
    monkeypatch.delenv("BOUND_TRANSPORT_SECRET", raising=False)
    f.profile.return_value = (
        "fixture",
        {"datasource": "duckdb", "path": "${BOUND_TRANSPORT_SECRET}"},
    )
    monkeypatch.setattr(transport, "expand_profile_secrets", expand_profile_secrets)
    f.run(b'{"id":1,"operation":"inspect"}\n')
    assert f.factory.call_args.args[2]["path"] == "project-secret"


@pytest.mark.parametrize(
    "payload",
    [
        {"operation": "query", "sql": "SELECT 1", "limit": True},
        {"operation": "query", "sql": "SELECT 1", "limit": 10001},
        {"operation": "query", "sql": "SELECT 1", "limit": 1, "project": "/elsewhere"},
        {"operation": "inspect", "connection": "secret"},
        {"operation": "shell", "command": "anything"},
    ],
)
def test_rejects_authority_inputs(bound_transport, payload):
    frames = bound_transport.run((json.dumps({"id": 1, **payload}) + "\n").encode())
    assert frames[-1] == {
        "id": 1,
        "error": {
            "class": "invalid_request",
            "message": transport.ERROR_MESSAGES["invalid_request"],
        },
    }
    bound_transport.engine.query.assert_not_called()


@pytest.mark.parametrize(
    "payload",
    [
        b'{"id":2,"operation":"inspect"}\n',
        b"[]\n",
        b"x" * (transport.MAX_REQUEST + 1),
        b'{"id":1}',
    ],
)
def test_closes_on_invalid_frame_or_correlation(bound_transport, payload):
    assert len(bound_transport.run(payload)) == 1
    bound_transport.engine.__exit__.assert_called_once()


def test_sanitizes_query_failure_and_oversized_output(bound_transport):
    bound_transport.engine.query.side_effect = RuntimeError(
        "credential secret /private/path"
    )
    frames = bound_transport.run(
        b'{"id":1,"operation":"query","sql":"SELECT n FROM orders","limit":1}\n'
    )
    assert frames[-1] == {
        "id": 1,
        "error": {"class": "internal", "message": transport.ERROR_MESSAGES["internal"]},
    }
    bound_transport.engine.query.side_effect = None
    bound_transport.engine.query.return_value = SimpleNamespace(
        column_names=["n"], to_pylist=lambda: [{"n": "x" * transport.MAX_RESULT}]
    )
    frames = bound_transport.run(
        b'{"id":1,"operation":"query","sql":"SELECT n FROM orders","limit":1}\n'
    )
    assert frames[-1] == {
        "id": 1,
        "error": {
            "class": "result_too_large",
            "message": transport.ERROR_MESSAGES["result_too_large"],
        },
    }


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (
            WrenError(
                ErrorCode.MODEL_NOT_FOUND,
                "Table 'revenue' is not defined in /private/manifest.json",
                phase=ErrorPhase.SQL_POLICY_CHECK,
            ),
            "model_not_found",
        ),
        (
            WrenError(
                ErrorCode.INVALID_SQL,
                "SQL is not supported by the read-only analytical query policy.",
                phase=ErrorPhase.SQL_POLICY_CHECK,
            ),
            "policy_rejected",
        ),
        (
            WrenError(
                ErrorCode.BLOCKED_FUNCTION,
                "read_csv",
                phase=ErrorPhase.SQL_POLICY_CHECK,
            ),
            "policy_rejected",
        ),
        (
            WrenError(ErrorCode.INVALID_SQL, "syntax", phase=ErrorPhase.SQL_PARSING),
            "invalid_sql",
        ),
        (
            WrenError(
                ErrorCode.GENERIC_USER_ERROR,
                'Binder Error: column "ltv" not found; SELECT secret FROM tenant_b',
                phase=ErrorPhase.SQL_EXECUTION,
            ),
            "execution_failed",
        ),
        (WrenError(ErrorCode.DATABASE_TIMEOUT, "slow"), "timeout"),
        (
            WrenError(ErrorCode.GET_CONNECTION_ERROR, "password=hunter2 host=10.0.0.9"),
            "datasource_unavailable",
        ),
        (WrenError(ErrorCode.GENERIC_INTERNAL_ERROR, "boom"), "internal"),
        (
            RuntimeError("Traceback (most recent call last): /home/x/.wren/.env"),
            "internal",
        ),
    ],
)
def test_query_failures_surface_a_bounded_class_and_nothing_else(
    bound_transport, error, expected
):
    bound_transport.engine.query.side_effect = error
    sql = "SELECT ltv FROM customers_of_tenant_a"
    raw = bound_transport.run(
        (
            json.dumps({"id": 1, "operation": "query", "sql": sql, "limit": 1}) + "\n"
        ).encode()
    )
    frame = raw[-1]
    assert frame == {
        "id": 1,
        "error": {"class": expected, "message": transport.ERROR_MESSAGES[expected]},
    }
    serialized = json.dumps(frame)
    for leak in (
        str(error),
        sql,
        "/private",
        "/Users",
        "Traceback",
        "hunter2",
        "tenant",
    ):
        assert leak not in serialized
    assert set(frame["error"]) == {"class", "message"}
    assert frame["error"]["class"] in transport.ERROR_MESSAGES


def test_sqlglot_parse_failure_is_invalid_sql_before_execution(bound_transport):
    frames = bound_transport.run(
        b'{"id":1,"operation":"query","sql":"SELECT FROM WHERE ((","limit":1}\n'
    )
    assert frames[-1]["error"]["class"] == "invalid_sql"
    bound_transport.engine.query.assert_not_called()


LITERAL_MONTHS = (
    "SELECT CASE month_num WHEN 1 THEN 424 WHEN 2 THEN 400 WHEN 3 THEN 279 "
    "ELSE 0 END AS monthly_revenue FROM (SELECT 1 AS month_num"
    + "".join(f" UNION ALL SELECT {n}" for n in range(2, 13))
    + ") months ORDER BY month_num"
)


@pytest.mark.parametrize(
    "sql",
    [
        LITERAL_MONTHS,
        "SELECT 1",
        "SELECT 1 AS x",
        "SELECT 9900 AS n",
        "WITH m AS (SELECT 1 AS n) SELECT n FROM m",
        # A reference differing from a CTE alias only in case or quoting is the CTE.
        "WITH months AS (SELECT 424 AS n) SELECT n FROM Months",
        "WITH M AS (SELECT 424 AS n) SELECT n FROM m",
        "WITH ORDERS AS (SELECT 424 AS revenue) SELECT revenue FROM orders",
        'WITH "Orders" AS (SELECT 424 AS revenue) SELECT revenue FROM orders',
        # Table functions parse as a table without a name.
        "SELECT * FROM generate_series(1, 12)",
        "SELECT * FROM read_csv('x')",
    ],
)
def test_query_reading_no_table_is_rejected_before_execution(bound_transport, sql):
    frames = bound_transport.run(
        (
            json.dumps({"id": 1, "operation": "query", "sql": sql, "limit": 5}) + "\n"
        ).encode()
    )
    assert frames[-1] == {
        "id": 1,
        "error": {
            "class": "ungrounded_literal",
            "message": transport.ERROR_MESSAGES["ungrounded_literal"],
        },
    }
    bound_transport.engine.query.assert_not_called()


def test_the_literal_class_tells_the_model_to_cite_or_compute_and_copies_nothing(
    bound_transport,
):
    sql = "SELECT 267919.19 AS secret_total_from_the_request"
    frames = bound_transport.run(
        (
            json.dumps({"id": 1, "operation": "query", "sql": sql, "limit": 5}) + "\n"
        ).encode()
    )
    frame = frames[-1]
    assert set(frame["error"]) == {"class", "message"}
    message = frame["error"]["message"]
    assert "query_id" in message and "one SELECT over the models" in message
    for leak in (sql, "267919", "secret_total", "NoSourceTables", "WrenError"):
        assert leak not in json.dumps(frame)


def test_a_policy_violation_keeps_the_policy_class(bound_transport):
    bound_transport.engine.query.side_effect = WrenError(
        ErrorCode.BLOCKED_FUNCTION, "x", phase=ErrorPhase.SQL_POLICY_CHECK
    )
    frames = bound_transport.run(
        b'{"id":1,"operation":"query","sql":"SELECT n FROM orders","limit":1}\n'
    )
    assert frames[-1]["error"]["class"] == "policy_rejected"


def test_a_query_over_a_model_next_to_a_literal_select_still_executes(
    bound_transport,
):
    frames = bound_transport.run(
        b'{"id":1,"operation":"query","sql":"SELECT 9900 AS n","limit":1}\n'
        b'{"id":2,"operation":"query","sql":"SELECT n FROM orders","limit":1}\n'
    )
    assert frames[1]["error"]["class"] == "ungrounded_literal"
    assert frames[2]["result"]["definition"]["source_tables"] == ["orders"]


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT n FROM orders",
        "WITH x AS (SELECT * FROM orders) SELECT n FROM x",
        "SELECT n FROM (SELECT n FROM orders) t",
        'SELECT n FROM "orders"',
        "WITH Totals AS (SELECT n FROM orders) SELECT n FROM totals",
    ],
)
def test_query_reading_a_model_executes(bound_transport, sql):
    frames = bound_transport.run(
        (
            json.dumps({"id": 1, "operation": "query", "sql": sql, "limit": 5}) + "\n"
        ).encode()
    )
    assert frames[-1]["result"]["definition"]["source_tables"] == ["orders"]
    bound_transport.engine.query.assert_called_once_with(sql, limit=5, read_only=True)


def test_cli_sanitizes_malformed_transport_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(transport, "serve", MagicMock(side_effect=ValueError("secret")))
    result = CliRunner().invoke(app, ["governed-stdio", "--project", str(tmp_path)])
    assert result.exit_code == 1
    assert "secret" not in result.output
    assert "unavailable" in result.output


@pytest.mark.parametrize("prefix", [[], ["query"]])
def test_cli_read_only_flag_reaches_engine(monkeypatch, prefix):
    engine = MagicMock()
    engine.__enter__.return_value = engine
    monkeypatch.setattr(cli, "_build_engine", MagicMock(return_value=engine))
    monkeypatch.setattr(cli, "_print_result", MagicMock())
    result = CliRunner().invoke(
        app, [*prefix, "--sql", "SELECT 1", "--read-only", "--quiet"]
    )
    assert result.exit_code == 0, result.output
    engine.query.assert_called_once_with("SELECT 1", limit=None, read_only=True)


def test_definition_comes_from_executed_sql(bound_transport):
    sql = "WITH totals AS (SELECT n FROM orders WHERE n > 0) SELECT n FROM totals"
    frames = bound_transport.run(
        (
            json.dumps({"id": 1, "operation": "query", "sql": sql, "limit": 5}) + "\n"
        ).encode()
    )
    assert frames[-1]["result"]["definition"] == {
        "sql": sql,
        "source_tables": ["orders"],
        "filters": ["n > 0"],
    }


@pytest.mark.parametrize("valid", [True, False])
def test_semantic_proof_is_derived_at_governed_transport_boundary(
    bound_transport, valid
):
    bound_transport.build.return_value = {
        "cubes": [
            {
                "name": "sales",
                "measures": [{"name": "revenue", "expression": "SUM(amount)"}],
                "dimensions": [{"name": "region"}],
                "timeDimensions": [{"name": "day"}],
            }
        ]
    }
    sql = "SELECT revenue FROM sales WHERE day > '2026-01-01' AND " + (
        "region = 'x'" if valid else "LOWER(region) = 'x'"
    )
    frames = bound_transport.run(
        (
            json.dumps({"id": 1, "operation": "query", "sql": sql, "limit": 5}) + "\n"
        ).encode()
    )
    result = frames[-1]["result"]
    assert result["definition"]["sql"] == sql
    if valid:
        assert result["semantics"] == {
            "version": "1",
            "sql": sql,
            "metrics": [{"owner": "sales", "name": "revenue"}],
            "dimensions": [{"owner": "sales", "name": "region"}],
            "temporal_dimensions": [{"owner": "sales", "name": "day"}],
        }
    else:
        assert "semantics" not in result


JAFFLE_SHAPED = {
    "models": [{"name": "orders"}, {"name": "customers"}],
    "views": [{"name": "example_view"}],
    "cubes": [
        {
            "name": "revenue",
            "baseObject": "orders",
            "measures": [{"name": "total_revenue", "expression": "SUM(amount)"}],
            "dimensions": [{"name": "status"}],
            "timeDimensions": [{"name": "order_date"}],
        }
    ],
}


def query_frame(f, sql):
    return f.run(
        (
            json.dumps({"id": 1, "operation": "query", "sql": sql, "limit": 5}) + "\n"
        ).encode()
    )[-1]


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT SUM(total_revenue) FROM revenue",
        'SELECT total_revenue FROM "Revenue"',
        "SELECT o.status FROM orders o JOIN revenue r ON TRUE",
        "WITH x AS (SELECT total_revenue FROM revenue) SELECT * FROM x",
    ],
)
def test_reading_a_cube_as_a_table_gets_the_cube_class(bound_transport, sql):
    f = bound_transport
    f.build.return_value = JAFFLE_SHAPED
    f.engine.query.side_effect = WrenError(
        ErrorCode.MODEL_NOT_FOUND,
        "Table 'revenue' is not defined in /private/manifest.json",
        phase=ErrorPhase.SQL_PLANNING,
    )
    frame = query_frame(f, sql)
    assert frame == {
        "id": 1,
        "error": {
            "class": "cube_not_queryable",
            "message": transport.ERROR_MESSAGES["cube_not_queryable"],
        },
    }
    message = frame["error"]["message"]
    assert "cube" in message and "base model" in message
    for leak in ("revenue", "/private", "manifest.json", "total_revenue"):
        assert leak not in message


@pytest.mark.parametrize(
    ("sql", "manifest", "error_code"),
    [
        ("SELECT 1 FROM missing_table", JAFFLE_SHAPED, ErrorCode.MODEL_NOT_FOUND),
        # A model that shares the cube's name is a table the engine can resolve.
        (
            "SELECT 1 FROM revenue",
            {**JAFFLE_SHAPED, "models": [{"name": "revenue"}]},
            ErrorCode.MODEL_NOT_FOUND,
        ),
    ],
)
def test_an_unknown_table_stays_model_not_found(
    bound_transport, sql, manifest, error_code
):
    f = bound_transport
    f.build.return_value = manifest
    f.engine.query.side_effect = WrenError(
        error_code, "x", phase=ErrorPhase.SQL_PLANNING
    )
    assert query_frame(f, sql)["error"]["class"] == "model_not_found"


def test_only_a_model_not_found_failure_is_refined_to_the_cube_class(bound_transport):
    f = bound_transport
    f.build.return_value = JAFFLE_SHAPED
    f.engine.query.side_effect = WrenError(
        ErrorCode.GENERIC_USER_ERROR, "boom", phase=ErrorPhase.SQL_EXECUTION
    )
    assert (
        query_frame(f, "SELECT 1 FROM revenue")["error"]["class"] == "execution_failed"
    )


def test_a_failure_before_any_table_is_read_is_not_attributed_to_the_previous_query(
    bound_transport,
):
    f = bound_transport
    f.build.return_value = JAFFLE_SHAPED
    f.engine.query.side_effect = WrenError(
        ErrorCode.MODEL_NOT_FOUND, "x", phase=ErrorPhase.SQL_PLANNING
    )
    frames = f.run(
        b'{"id":1,"operation":"query","sql":"SELECT 1 FROM revenue","limit":1}\n'
        b'{"id":2,"operation":"query","sql":"SELECT 1 FROM missing_table","limit":1}\n'
    )
    assert [frame["error"]["class"] for frame in frames[1:]] == [
        "cube_not_queryable",
        "model_not_found",
    ]


def test_a_model_next_to_a_cube_still_executes(bound_transport):
    f = bound_transport
    f.build.return_value = JAFFLE_SHAPED
    frame = query_frame(f, "SELECT n FROM orders")
    assert frame["result"]["definition"]["source_tables"] == ["orders"]
    f.engine.query.assert_called_once_with(
        "SELECT n FROM orders", limit=5, read_only=True
    )


@pytest.mark.parametrize(
    "cubes", [None, ["revenue", None, 3]], ids=["null", "non-dict-entries"]
)
def test_a_malformed_cube_list_keeps_model_not_found_and_the_loop_alive(
    bound_transport, cubes
):
    f = bound_transport
    f.build.return_value = {**JAFFLE_SHAPED, "cubes": cubes}
    f.engine.query.side_effect = WrenError(
        ErrorCode.MODEL_NOT_FOUND, "x", phase=ErrorPhase.SQL_PLANNING
    )
    frames = f.run(
        b'{"id":1,"operation":"query","sql":"SELECT 1 FROM revenue","limit":1}\n'
        b'{"id":2,"operation":"query","sql":"SELECT 1 FROM revenue","limit":1}\n'
    )
    assert [frame["error"]["class"] for frame in frames[1:]] == ["model_not_found"] * 2


DECLARED_FIXTURE = (
    Path(__file__).resolve().parent.parent / "fixtures" / "declared_defaults"
)
DECLARED_IDS = ["usd-at-transaction-date", "exclude-test-accounts"]
EXCLUDE_OK = (
    "SELECT COUNT(*) FROM orders o JOIN customers c ON o.customer_id = c.id "
    "WHERE NOT c.is_test"
)
EXCLUDE_MISSING = (
    "SELECT COUNT(*) FROM orders o JOIN customers c ON o.customer_id = c.id"
)


@pytest.fixture
def declaring(bound_transport):
    f = bound_transport
    shutil.copytree(DECLARED_FIXTURE / "knowledge", f.project / "knowledge")
    f.build.return_value = build_project_manifest(DECLARED_FIXTURE)
    return f


def test_a_project_without_declarations_keeps_the_two_key_hello_and_is_never_checked(
    bound_transport, monkeypatch
):
    f = bound_transport
    rules = f.project / "knowledge" / "rules"
    rules.mkdir(parents=True)
    (rules / "prose.md").write_text("# Rules\n\nExclude test accounts.\n")
    monkeypatch.setattr(
        transport.DefaultsChecker, "check", MagicMock(side_effect=AssertionError)
    )
    frames = f.run(
        b'{"id":1,"operation":"query","sql":"SELECT n FROM orders","limit":5}\n'
    )
    assert frames[0] == {"id": 0, "protocol": "wren-governed/2"}
    assert list(frames[1]) == ["id", "result"]


def test_a_declaring_project_speaks_protocol_3_and_names_its_rules(declaring):
    assert declaring.run(b"") == [
        {"id": 0, "protocol": "wren-governed/3", "declared_defaults": DECLARED_IDS}
    ]


def test_a_query_missing_a_declared_default_is_refused_before_execution(declaring):
    assert query_frame(declaring, EXCLUDE_MISSING) == {
        "id": 1,
        "error": {
            "class": "declared_default_missing",
            "message": transport.ERROR_MESSAGES["declared_default_missing"],
            "rule_ids": ["exclude-test-accounts"],
        },
    }
    declaring.engine.query.assert_not_called()


def test_every_broken_rule_is_named_in_declaration_order(declaring):
    frame = query_frame(declaring, "SELECT SUM(p.amount) FROM payments p")
    assert frame["error"]["rule_ids"] == DECLARED_IDS
    declaring.engine.query.assert_not_called()


def test_the_refusal_copies_nothing_from_the_request_beyond_project_authored_ids(
    declaring,
):
    sql = (
        "SELECT COUNT(*) /* secret-token */ FROM orders o JOIN customers c "
        "ON o.customer_id = c.id WHERE c.country = '/private/path'"
    )
    wire = json.dumps(query_frame(declaring, sql))
    for leak in (
        "secret-token",
        "/private/path",
        "SELECT",
        "is_test",
        "country",
        "customers",
    ):
        assert leak not in wire
    assert set(json.loads(wire)["error"]) == {"class", "message", "rule_ids"}


def test_a_query_applying_the_default_executes_and_keeps_its_definition(declaring):
    frame = query_frame(declaring, EXCLUDE_OK)
    assert frame["result"]["definition"]["source_tables"] == ["customers", "orders"]
    assert frame["result"]["definition"]["filters"] == ["NOT c.is_test"]
    declaring.engine.query.assert_called_once_with(EXCLUDE_OK, limit=5, read_only=True)


def test_a_refused_query_does_not_end_the_session_and_the_repair_executes(declaring):
    def frame(request_id, sql):
        return json.dumps(
            {"id": request_id, "operation": "query", "sql": sql, "limit": 5}
        )

    frames = declaring.run(
        (frame(1, EXCLUDE_MISSING) + "\n" + frame(2, EXCLUDE_OK) + "\n").encode()
    )
    assert frames[1]["error"]["class"] == "declared_default_missing"
    assert "result" in frames[2]
    assert declaring.engine.query.call_count == 1


def test_sql_the_checker_cannot_analyze_reaches_the_engine_which_reports_its_own_class(
    declaring,
):
    declaring.engine.query.side_effect = WrenError(
        ErrorCode.GENERIC_USER_ERROR, "x", phase=ErrorPhase.SQL_EXECUTION
    )
    frame = query_frame(declaring, "SELECT COUNT(nope) FROM orders")
    assert frame["error"]["class"] == "execution_failed"
    assert "rule_ids" not in frame["error"]
    declaring.engine.query.assert_called_once()


def test_other_classes_never_carry_rule_ids(declaring):
    assert query_frame(declaring, "SELECT 1")["error"] == {
        "class": "ungrounded_literal",
        "message": transport.ERROR_MESSAGES["ungrounded_literal"],
    }


def write_invalid_declaration(f):
    (f.project / "knowledge" / "rules" / "conventions.md").write_text(
        "---\ndefaults:\n  - id: secret-rule\n    kind: nonsense\n---\n"
    )


def test_an_invalid_declaration_refuses_to_start_before_any_frame(declaring):
    write_invalid_declaration(declaring)
    with pytest.raises(DeclarationError):
        declaring.run(b'{"id":1,"operation":"inspect"}\n')
    declaring.factory.assert_not_called()


def test_the_cli_reports_invalid_declarations_without_their_content(declaring):
    write_invalid_declaration(declaring)
    result = CliRunner().invoke(
        app, ["governed-stdio", "--project", str(declaring.project)]
    )
    assert result.exit_code == 1
    assert "declared default rules are invalid" in result.output
    assert "secret-rule" not in result.output and "nonsense" not in result.output


def test_the_checker_is_what_stops_a_missing_default(declaring, monkeypatch):
    monkeypatch.setattr(transport.DefaultsChecker, "check", lambda self, ast: [])
    assert "result" in query_frame(declaring, EXCLUDE_MISSING)
    declaring.engine.query.assert_called_once()


def test_a_checker_without_a_verdict_never_blocks_a_query(declaring, monkeypatch):
    monkeypatch.setattr(transport.DefaultsChecker, "check", lambda self, ast: None)
    assert "result" in query_frame(declaring, EXCLUDE_MISSING)


@pytest.mark.parametrize("fault", [RecursionError, RuntimeError, KeyError])
def test_a_checker_fault_earns_no_verdict_not_a_refusal(declaring, monkeypatch, fault):
    monkeypatch.setattr(_Statement, "fires_exclude", MagicMock(side_effect=fault))
    assert "result" in query_frame(declaring, EXCLUDE_MISSING)
