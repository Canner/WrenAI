"""Unit tests for wren.genbi.runtime — process lifecycle primitives.

These tests use ``python -m http.server`` as a stand-in for the Streamlit
subprocess so they need no streamlit install and no database. They exercise the
deterministic, deep module that owns free-port probing, detached spawning,
health polling, and process-group teardown.
"""

from __future__ import annotations

import os
import socket
import sys
import time

import pytest

from wren.genbi import runtime

pytestmark = pytest.mark.unit


def test_free_port_returns_a_bindable_port():
    port = runtime.free_port()
    assert isinstance(port, int)
    assert 1 <= port <= 65535
    # The returned port must actually be bindable right now.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", port))


def test_wait_healthy_false_on_dead_port():
    dead = runtime.free_port()  # nothing is listening here
    assert runtime.wait_healthy(dead, timeout=0.5, interval=0.1, path="/") is False


def test_spawn_then_health_then_stop_tears_down_process_group():
    port = runtime.free_port()
    handle = runtime.spawn(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=os.getcwd(),
        log_path=None,
    )
    try:
        # http.server answers 200 on "/", standing in for /_stcore/health
        assert runtime.wait_healthy(port, timeout=10, interval=0.2, path="/") is True
        assert runtime.is_alive(handle.pid) is True
        assert handle.pgid == os.getpgid(handle.pid)
    finally:
        runtime.stop(handle)

    # After stop, the process group is gone.
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if not runtime.is_alive(handle.pid):
            break
        time.sleep(0.1)
    assert runtime.is_alive(handle.pid) is False


def test_spawn_redirects_output_to_log_file(tmp_path):
    log_path = tmp_path / ".wren-app.log"
    handle = runtime.spawn(
        # -u: unbuffered, so the line hits the log file before the sleep
        [
            sys.executable,
            "-u",
            "-c",
            "print('hello from app'); import time; time.sleep(30)",
        ],
        cwd=str(tmp_path),
        log_path=log_path,
    )
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if log_path.exists() and "hello from app" in log_path.read_text():
                break
            time.sleep(0.1)
        assert log_path.exists()
        assert "hello from app" in log_path.read_text()
    finally:
        runtime.stop(handle)


def test_is_alive_false_after_stop_reaps_exited_process():
    handle = runtime.spawn(
        [sys.executable, "-c", "pass"],  # exits immediately
        cwd=os.getcwd(),
        log_path=None,
    )
    time.sleep(0.3)  # let it exit (now a zombie until reaped)
    runtime.stop(handle)  # reaps it; safe even though the group is already gone
    assert runtime.is_alive(handle.pid) is False


def test_process_cmdline_reflects_running_argv():
    handle = runtime.spawn(
        [sys.executable, "-c", "import time;time.sleep(30)", "WREN_MARKER_XYZ"],
        cwd=os.getcwd(),
        log_path=None,
    )
    try:
        time.sleep(0.3)
        cmdline = runtime.process_cmdline(handle.pid)
        assert cmdline is not None
        assert "WREN_MARKER_XYZ" in cmdline
    finally:
        runtime.stop(handle)


def test_process_cmdline_none_for_dead_pid():
    # A pid that is essentially never live for this user.
    assert runtime.process_cmdline(999_999) is None
