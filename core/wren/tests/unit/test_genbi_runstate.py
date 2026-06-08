"""Unit tests for wren.genbi.runstate and the streamlit command builder.

Runstate is the ephemeral, gitignored ``apps/.run/<name>.json`` that records
which app is running on which port. The command builder produces the flags that
keep a served app headless, locally-bound, and hot-reloading.
"""

from __future__ import annotations

import pytest

from wren.genbi import runstate, runtime

pytestmark = pytest.mark.unit


def test_streamlit_command_has_headless_local_hotreload_flags():
    cmd = runtime.streamlit_command("/proj/apps/rev/app.py", 8512)
    joined = " ".join(cmd)
    assert "streamlit" in joined and "run" in joined
    assert "/proj/apps/rev/app.py" in cmd
    assert "--server.port" in cmd and "8512" in cmd
    assert "--server.address" in cmd and "127.0.0.1" in cmd
    # headless + no telemetry so an automated launch never blocks on prompts
    assert "--server.headless" in cmd and "true" in cmd
    assert "--browser.gatherUsageStats" in cmd and "false" in cmd
    # hot-reload on edit, poll watcher (robust on network/container FS)
    assert "--server.runOnSave" in cmd
    assert "--server.fileWatcherType" in cmd and "poll" in cmd


def test_runstate_save_load_round_trip(tmp_path):
    handle = runtime.ServeHandle(pid=111, pgid=111)
    runstate.save(tmp_path, "revenue", handle=handle, port=8512, start_token="tok")
    state = runstate.load(tmp_path, "revenue")
    assert state is not None
    assert state.port == 8512
    assert state.pid == 111
    assert state.pgid == 111
    assert state.start_token == "tok"


def test_runstate_load_missing_returns_none(tmp_path):
    assert runstate.load(tmp_path, "ghost") is None


def test_runstate_clear_removes_state(tmp_path):
    handle = runtime.ServeHandle(pid=1, pgid=1)
    runstate.save(tmp_path, "rev", handle=handle, port=9000, start_token="t")
    runstate.clear(tmp_path, "rev")
    assert runstate.load(tmp_path, "rev") is None


def test_runstate_lives_under_apps_dot_run(tmp_path):
    handle = runtime.ServeHandle(pid=1, pgid=1)
    runstate.save(tmp_path, "rev", handle=handle, port=9000, start_token="t")
    assert (tmp_path / "apps" / ".run" / "rev.json").exists()
