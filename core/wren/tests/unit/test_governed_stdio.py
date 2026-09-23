"""Exercise the transport with a captured synthetic binding; never open a database."""

import io
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner

from wren import cli
from wren import governed_stdio as transport
from wren.cli import app

pytestmark = pytest.mark.unit


@pytest.fixture
def bound_transport(tmp_path, monkeypatch):
    (tmp_path / "wren_project.yml").write_text("name: synthetic")
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
    monkeypatch.setattr(transport, "expand_profile_secrets", lambda value: dict(value))
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


def test_captures_once_and_always_queries_read_only(bound_transport):
    f = bound_transport
    frames = f.run(
        b'{"id":1,"operation":"inspect"}\n{"id":2,"operation":"query","sql":"SELECT 1 AS n","limit":5}\n'
    )
    assert frames == [
        {"id": 0, "protocol": "wren-governed/1"},
        {"id": 1, "result": {"models": [{"name": "orders"}]}},
        {
            "id": 2,
            "result": {
                "columns": ["n"],
                "rows": [{"n": 1}],
                "definition": {
                    "sql": "SELECT 1 AS n",
                    "source_tables": [],
                    "filters": [],
                },
            },
        },
    ]
    for captured in (f.profile, f.build, f.config, f.factory):
        captured.assert_called_once()
    f.engine.query.assert_called_once_with("SELECT 1 AS n", limit=5, read_only=True)
    f.engine.__exit__.assert_called_once()


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
    assert frames[-1] == {"id": 1, "error": "Governed operation failed"}
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
        b'{"id":1,"operation":"query","sql":"SELECT 1","limit":1}\n'
    )
    assert frames[-1] == {"id": 1, "error": "Governed operation failed"}
    bound_transport.engine.query.side_effect = None
    bound_transport.engine.query.return_value = SimpleNamespace(
        column_names=["n"], to_pylist=lambda: [{"n": "x" * transport.MAX_RESULT}]
    )
    frames = bound_transport.run(
        b'{"id":1,"operation":"query","sql":"SELECT 1","limit":1}\n'
    )
    assert frames[-1] == {"id": 1, "error": "Governed operation failed"}


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
