"""Ephemeral serve-runtime state for GenBI apps.

Records which app is running on which port in ``apps/.run/<name>.json`` — a
gitignored, disposable sidecar. It is intentionally NOT durable: a reboot ends
the processes and the state is recomputed/ignored on the next serve. It exists
only to enable idempotent start-or-attach and clean teardown.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from wren.genbi.runtime import ServeHandle

_RUN_DIR = "apps/.run"


@dataclass
class RunState:
    """A running app's port and process identity."""

    port: int
    pid: int
    pgid: int
    start_token: str


def _state_path(project_path: Path | str, name: str) -> Path:
    return Path(project_path) / _RUN_DIR / f"{name}.json"


def save(
    project_path: Path | str,
    name: str,
    *,
    handle: ServeHandle,
    port: int,
    start_token: str,
) -> None:
    """Write the run state for *name*, creating ``apps/.run/`` if needed."""
    path = _state_path(project_path, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "port": port,
                "pid": handle.pid,
                "pgid": handle.pgid,
                "start_token": start_token,
            }
        )
    )


def load(project_path: Path | str, name: str) -> RunState | None:
    """Return the recorded run state for *name*, or None if absent/corrupt."""
    path = _state_path(project_path, name)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        return RunState(
            port=data["port"],
            pid=data["pid"],
            pgid=data["pgid"],
            start_token=data["start_token"],
        )
    except (json.JSONDecodeError, KeyError, OSError):
        return None


def clear(project_path: Path | str, name: str) -> None:
    """Remove the run state for *name* if present."""
    path = _state_path(project_path, name)
    path.unlink(missing_ok=True)
