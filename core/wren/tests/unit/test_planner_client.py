"""Exercise example MCP timeout configuration without importing providers or spawning services."""

import json
import os
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


@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("failure", [False, True])
def test_actual_trace_files_are_private_for_success_and_error_paths(existing, failure):
    actual = probe(
        {
            "serviceReplyTimeoutMs": 200000,
            "_probeFileChecks": True,
            "_probeExisting": existing,
            "_probeFailure": failure,
        }
    )
    assert actual["error"] is None
    assert actual["traceMode"] == 0o600
    assert actual["modesAtWrite"] == [0o600] * (1 if failure else 2)
    assert actual["trace"]["completed"] is (not failure)
    assert len(actual["trace"]["errors"]) == (1 if failure else 0)
    assert actual["exitCode"] == (1 if failure else 0)


@pytest.mark.parametrize("failure", [False, True])
def test_trace_symlink_never_truncates_or_chmods_its_target(failure):
    actual = probe(
        {
            "serviceReplyTimeoutMs": 200000,
            "_probeSymlink": True,
            "_probeFailure": failure,
        }
    )
    assert actual["targetContent"] == "original contents"
    assert actual["targetMode"] == 0o644 and actual["traceIsSymlink"]
    assert actual["error"] is not None


@pytest.mark.parametrize("failure", [False, True])
def test_trace_hardlink_keeps_the_other_inode_contents_and_permissions(failure):
    actual = probe(
        {
            "serviceReplyTimeoutMs": 200000,
            "_probeHardlink": True,
            "_probeFileChecks": True,
            "_probeFailure": failure,
        }
    )
    assert actual["error"] is None
    assert actual["targetContent"] == "original contents"
    assert actual["targetMode"] == 0o644 and actual["separateInodes"]
    assert actual["traceMode"] == 0o600
    assert actual["modesAtWrite"] == [0o600] * (1 if failure else 2)
    assert actual["temporaryEntries"] == []


def test_trace_write_failure_keeps_previous_file_and_cleans_up_temporary_files():
    actual = probe(
        {
            "serviceReplyTimeoutMs": 200000,
            "_probeExisting": True,
            "_probeWriteFailure": True,
        }
    )
    assert actual["error"] == "scripted trace write failure"
    assert actual["traceRaw"] == "previous trace" and actual["traceMode"] == 0o644
    assert actual["temporaryEntries"] == []


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        ({}, "/opt/loader"),
        ({"WREN_CONTEXT_LOADER_BIN": "/explicit"}, "/explicit"),
    ],
)
def test_the_loader_override_reaches_the_service_and_config_env_wins(
    configured, expected
):
    actual = probe(
        {
            "serviceReplyTimeoutMs": 200000,
            "env": configured,
            "_probeEnv": {"WREN_CONTEXT_LOADER_BIN": "/opt/loader", "SECRET": "x"},
        }
    )
    assert actual["transportEnv"]["WREN_CONTEXT_LOADER_BIN"] == expected
    assert "SECRET" not in actual["transportEnv"]


def test_a_failed_trace_write_still_carries_the_planner_failure():
    actual = probe(
        {
            "serviceReplyTimeoutMs": 200000,
            "_probeExisting": True,
            "_probeFailure": True,
            "_probeFailureMessage": "upstream said service-secret-value",
            "_probeWriteFailure": True,
        }
    )
    assert actual["error"] == "scripted trace write failure"
    assert actual["traceRaw"] == "previous trace"
    assert actual["unwrittenErrorNames"] == ["Error"]
    # A planner message can carry service text: none of it reaches what Node prints.
    assert actual["printedLeaks"] is False


def test_trace_directory_output_is_refused_without_leaving_temporary_files():
    actual = probe({"serviceReplyTimeoutMs": 200000, "_probeDirectory": True})
    assert actual["error"] is not None and actual["traceIsDirectory"]
    assert actual["temporaryEntries"] == []


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="requires a real FIFO")
def test_trace_fifo_output_is_refused_without_blocking(tmp_path):
    output = tmp_path / "trace-fifo"
    os.mkfifo(output)
    actual = probe({"serviceReplyTimeoutMs": 200000, "_probeOutputPath": str(output)})
    assert actual["error"] is not None and output.is_fifo()
    assert list(tmp_path.iterdir()) == [output]


def test_a_relative_loader_override_is_resolved_before_the_service_starts():
    actual = probe(
        {
            "serviceReplyTimeoutMs": 200000,
            "_probeEnv": {"WREN_CONTEXT_LOADER_BIN": "bin/loader"},
        }
    )
    assert actual["transportEnv"]["WREN_CONTEXT_LOADER_BIN"] == "/probe/cwd/bin/loader"
