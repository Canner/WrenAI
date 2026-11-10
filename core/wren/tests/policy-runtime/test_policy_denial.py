"""CI host-boundary checks using the published real Cedar evaluator, without a model.

This peer covers host authorization/denial, not production runtime admission or its
model/worker loop. Dependencies are mandatory here; CI runs this suite explicitly.
"""

import asyncio
import importlib.util
import os
from pathlib import Path

import pytest
import yaml

from wren.agent_service import SQL, create_service, safe
from wren.context_adapter import resolve_loader

HERE = Path(__file__).resolve().parent
EXAMPLES = HERE.parents[3] / "examples/serve-agent"


@pytest.fixture
def service(tmp_path):
    compiler = os.environ["WARBLE_BIN"]
    assert Path(compiler).is_file()
    assert resolve_loader().is_file()
    assert (HERE / "node_modules/@cedar-policy/cedar-wasm/package.json").is_file()
    spec = importlib.util.spec_from_file_location("policy_setup", EXAMPLES / "setup.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    made = []

    def make(extra_policy="", selection=()):
        destination = tmp_path / f"fixture{len(made)}"
        module.prepare(destination)
        root = destination / "project"
        config_path = root / "service.yml"
        config = yaml.safe_load(config_path.read_text())
        config.pop("default_preset", None)
        config.pop("policy_presets", None)
        config["metadata_selection"] = list(selection)
        config_path.write_text(yaml.safe_dump(config))
        policy = root / config["policy"]
        policy.write_text(policy.read_text() + "\n" + extra_policy)
        instance = create_service(
            root,
            EXAMPLES / "profiles/analysis",
            config_path,
            HERE / "cedar_runtime.cjs",
            compiler,
            mode="mcp",
        )
        made.append(instance)
        return instance

    yield make
    for instance in made:
        instance.shutdown()


def request(service):
    return SQL(
        session_id=service.open()["session_id"],
        request_id="one",
        expected_revision=0,
        capability="orders",
        sql="SELECT COUNT(*) FROM customers",
    )


def test_real_cedar_allows_a_host_query_and_delivers_its_evidence(service):
    instance = service()
    value = request(instance)
    result = instance.execute(value, direct={"sql": value.sql})
    assert result["status"] == "completed"
    assert result["result"]["rows"] == [{"c1": 3}]
    assert result["evidence_ref"] in instance.sessions[value.session_id]["evidence"]
    assert any(entry.get("event") == "private_sql" for entry in instance.audit)


def test_real_cedar_forbid_stops_the_host_before_sql_execution(service, monkeypatch):
    instance = service(
        'forbid(principal, action == Service::Action::"execute_query", resource);'
    )
    value = request(instance)
    executed = []

    def forbidden_execute(prepared):
        executed.append(prepared)
        raise AssertionError("denied SQL must not reach execution")

    monkeypatch.setattr(instance.sql, "execute", forbidden_execute)
    result = asyncio.run(safe(instance.execute, value, direct={"sql": value.sql}))
    assert result == {"status": "denied"}
    assert not executed
    session = instance.sessions[value.session_id]
    assert not session["results"] and not session["evidence"]
    assert not any(
        entry.get("event") in {"private_sql", "task_completed"}
        for entry in instance.audit
    )


def test_independent_metadata_policy_must_also_allow_the_host_operation(service):
    denied = service(selection=())
    allowed = service(selection=("structure",))
    assert (
        denied.allowed(None, "receive_metadata", "schema.structure", "structure")
        is False
    )
    assert (
        allowed.allowed(None, "receive_metadata", "schema.structure", "structure")
        is True
    )


@pytest.mark.parametrize(
    "policy",
    [
        "not valid Cedar",
        "permit(principal, action, resource) when { principal.missing };",
    ],
)
def test_policy_parse_and_evaluation_errors_fail_closed(service, policy):
    instance = service(policy)
    with pytest.raises(PermissionError):
        instance.open()
    assert not any(entry.get("event") == "private_sql" for entry in instance.audit)
