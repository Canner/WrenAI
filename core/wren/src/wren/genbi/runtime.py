"""Process lifecycle primitives for locally-served GenBI data apps.

This is a deterministic, dependency-light module: it knows how to probe a free
port, spawn a detached child process, poll an HTTP health endpoint, and tear a
process group down. It deliberately has no Streamlit or database dependency so
it can be unit-tested with any subprocess as a stand-in.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

# Streamlit's health endpoint returns HTTP 200 with a plaintext ``ok`` body
# (NOT JSON), so callers must treat the status code as the signal and never
# parse the body.
HEALTH_PATH = "/_stcore/health"


@dataclass
class ServeHandle:
    """Identifies a spawned app process and its process group."""

    pid: int
    pgid: int


def streamlit_command(
    app_file: str | Path,
    port: int,
    *,
    address: str = "127.0.0.1",
) -> list[str]:
    """Build the ``streamlit run`` argv that keeps a served app well-behaved.

    Flags (rather than a config.toml) so the child can run with the project root
    as CWD — needed for ``.env`` discovery — without a config-location clash:

    * headless + no usage stats → never blocks on the first-run email prompt
    * bound to localhost only
    * runOnSave + poll file watcher → edits hot-reload in place, robustly
    """
    return [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        str(app_file),
        "--server.port",
        str(port),
        "--server.address",
        address,
        "--server.headless",
        "true",
        "--browser.gatherUsageStats",
        "false",
        "--server.runOnSave",
        "true",
        "--server.fileWatcherType",
        "poll",
    ]


def free_port() -> int:
    """Find and return a free TCP port on localhost.

    Binding to port 0 lets the OS pick an unused port; the socket is closed
    immediately, so there is a small TOCTOU window before the caller binds it.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def spawn(
    cmd: list[str],
    *,
    cwd: str | Path,
    log_path: str | Path | None = None,
) -> ServeHandle:
    """Spawn *cmd* as a detached process in its own session/process group.

    ``start_new_session=True`` gives the child its own process group so the
    whole group (Streamlit plus its script-runner child) can be killed later
    via :func:`stop`. Output is redirected to *log_path* if given, else
    discarded. *cwd* is set so the child discovers project-local ``.env`` files
    for secret expansion.
    """
    if log_path is not None:
        log_path = Path(log_path)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        out = open(log_path, "ab")  # noqa: SIM115 — handed to the child process
        stdout = stderr = out
    else:
        out = None
        stdout = stderr = subprocess.DEVNULL

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            stdout=stdout,
            stderr=stderr,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    finally:
        # The child inherits its own dup'd fds; this process can close ours.
        if out is not None:
            out.close()

    # ``start_new_session=True`` makes the child a session and process-group
    # leader, so its pgid is its pid by definition. We must NOT call
    # ``os.getpgid(proc.pid)`` here: there is a race where the child has not yet
    # run ``setsid()``, so the parent would observe its OWN process group and a
    # later ``killpg`` would target the caller's group (EPERM / self-signal).
    return ServeHandle(pid=proc.pid, pgid=proc.pid)


def wait_healthy(
    port: int,
    *,
    timeout: float = 30.0,
    interval: float = 0.25,
    path: str = HEALTH_PATH,
) -> bool:
    """Poll ``http://127.0.0.1:<port><path>`` until it returns HTTP 200.

    Returns ``True`` as soon as a 200 is seen, ``False`` if *timeout* elapses
    first. Only the status code matters — the body is never parsed.
    """
    url = f"http://127.0.0.1:{port}{path}"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=interval) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(interval)
    return False


def process_cmdline(pid: int) -> str | None:
    """Return the full command line of *pid*, or None if it can't be read.

    Used to defeat PID reuse: a stored app's pid is only trusted as "ours" if
    its live command line still matches what we launched. Best-effort via ``ps``;
    returns None when the pid is gone or ``ps`` is unavailable.
    """
    try:
        out = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    line = out.stdout.strip()
    return line or None


def is_alive(pid: int) -> bool:
    """Return True if *pid* refers to a live process this user can signal."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def stop(handle: ServeHandle, *, timeout: float = 5.0) -> None:
    """Terminate the app's process group: SIGTERM, then SIGKILL if it lingers.

    Safe to call on an already-dead group — missing groups are ignored. If the
    process is a child of this process (as in tests, where the launcher does not
    exit between spawn and stop), its zombie is reaped so liveness checks see it
    gone; in production the detached child is reparented to init, which reaps it.
    """
    pgid, pid = handle.pgid, handle.pid

    def _reap() -> bool:
        """Reap *pid* if it is our exited child. Returns True if now gone."""
        try:
            reaped, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            return False  # not our child (production) or already reaped
        except OSError:
            return False
        return reaped == pid

    # If the process already exited, reaping it is enough — never signal a
    # group whose only member is a zombie (macOS rejects that with EPERM).
    if _reap():
        return

    try:
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        _reap()
        return

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _reap():
            return
        try:
            os.killpg(pgid, 0)
        except (ProcessLookupError, PermissionError):
            return
        time.sleep(0.1)

    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    _reap()
