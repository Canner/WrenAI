"""Exercise example MCP timeout configuration without importing providers or spawning services."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
CLIENT = (
    Path(__file__).resolve().parents[4]
    / "examples/serve-agent/planner-client/client.mjs"
)
PROBE = Path(__file__).parent / "fixtures/planner_client_probe.mjs"


def probe(settings):
    completed = subprocess.run(
        [
            "node",
            "--experimental-vm-modules",
            str(PROBE),
            str(CLIENT),
            json.dumps(settings),
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=5,
    )
    return json.loads(completed.stdout)


@pytest.mark.parametrize("timeout", [200000, 350000, 700000])
def test_planner_uses_explicit_service_reply_timeout(timeout):
    assert probe({"serviceReplyTimeoutMs": timeout}) == {
        "timeouts": [timeout],
        "clients": 1,
        "error": None,
    }


@pytest.mark.parametrize(
    "settings",
    [
        {},
        {"serviceReplyTimeoutMs": None},
        {"serviceReplyTimeoutMs": "350000"},
        {"serviceReplyTimeoutMs": 0},
        {"serviceReplyTimeoutMs": True},
        {"serviceReplyTimeoutMs": 2147483648},
    ],
)
def test_invalid_or_missing_reply_timeout_fails_before_any_connection(settings):
    actual = probe(settings)
    assert (
        actual["error"]
        == "serviceReplyTimeoutMs must be an integer from 1 to 2147483647"
    )
    assert actual["clients"] == 0 and actual["timeouts"] == []
