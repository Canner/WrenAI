"""Polling watch loop that auto-reindexes memory when project sources change.

The semantic memory index (``wren memory index``) is a derived artifact built
from a project's source of truth:

* the compiled MDL manifest (``target/mdl.json``), and
* the NL→SQL pairs under ``knowledge/sql/*.md``.

During active modelling these sources change often, and a stale index silently
returns wrong schema context to the LLM. ``wren memory watch`` closes that loop:
it polls the watched sources on an interval, and whenever their content
fingerprint changes it triggers a reindex.

The change-detection logic lives here, decoupled from the CLI and from the
optional ``memory`` extra, so it is fully unit-testable with only the standard
library. The CLI (:mod:`wren.memory.cli`) supplies the reindex callback.
"""

from __future__ import annotations

import hashlib
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

# Default sources to watch, relative to the project root. The MDL manifest is
# the compiled schema; knowledge/sql holds the NL→SQL pairs. Both feed the
# index, so a change to either should trigger a rebuild.
_DEFAULT_MDL_REL = ("target", "mdl.json")
_KNOWLEDGE_SQL_REL = ("knowledge", "sql")

# Guard against pathological tight loops while still allowing snappy local use.
MIN_INTERVAL_SECONDS = 1.0


def _iter_watched_files(project_path: Path) -> list[Path]:
    """Return the sorted list of files whose content is fingerprinted.

    Covers the compiled MDL manifest plus every ``knowledge/sql/*.md`` pair.
    Missing paths are simply absent from the list — a watcher started before
    ``target/mdl.json`` exists will pick it up on the poll after it appears.
    """
    files: list[Path] = []
    mdl = project_path.joinpath(*_DEFAULT_MDL_REL)
    if mdl.is_file():
        files.append(mdl)
    sql_dir = project_path.joinpath(*_KNOWLEDGE_SQL_REL)
    if sql_dir.is_dir():
        files.extend(sorted(p for p in sql_dir.glob("*.md") if p.is_file()))
    return files


def compute_fingerprint(
    project_path: Path,
    files: Iterable[Path] | None = None,
) -> str:
    """Compute a content fingerprint over the watched sources.

    The digest folds in each file's project-relative path, size and mtime
    (nanosecond resolution). Path + size + mtime is enough to detect adds,
    deletes, and edits without reading file bodies, which keeps each poll cheap
    even for large projects. The result is a stable hex string; an empty
    project (no watched files) yields the digest of the empty input.
    """
    if files is None:
        files = _iter_watched_files(project_path)
    hasher = hashlib.sha256()
    for path in sorted(files):
        try:
            stat = path.stat()
        except (FileNotFoundError, NotADirectoryError, PermissionError):
            # Raced away between listing and stat — treat as absent. The next
            # poll re-lists and converges.
            continue
        try:
            rel = path.relative_to(project_path)
        except ValueError:
            rel = path
        hasher.update(str(rel).encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(str(stat.st_size).encode("ascii"))
        hasher.update(b"\0")
        hasher.update(str(stat.st_mtime_ns).encode("ascii"))
        hasher.update(b"\0")
    return hasher.hexdigest()


@dataclass
class WatchState:
    """Mutable bookkeeping for a running (or simulated) watch loop."""

    fingerprint: str
    polls: int = 0
    reindexes: int = 0
    errors: int = 0
    last_change_poll: int = 0
    history: list[str] = field(default_factory=list)


def poll_once(
    project_path: Path,
    state: WatchState,
    reindex: Callable[[], object],
    *,
    on_event: Callable[[str], None] | None = None,
) -> bool:
    """Run a single poll cycle. Returns True iff a reindex was triggered.

    The fingerprint is recomputed and compared to ``state.fingerprint``. On a
    change the ``reindex`` callback is invoked and the state is advanced. A
    callback that raises does NOT advance the fingerprint, so the change stays
    pending and is retried on the next poll — a transient reindex failure can
    never silently drop an update. ``on_event`` receives short status strings
    for logging.
    """
    state.polls += 1
    current = compute_fingerprint(project_path)
    if current == state.fingerprint:
        return False

    if on_event is not None:
        on_event("change-detected")
    try:
        reindex()
    except Exception:  # noqa: BLE001 — surface count, keep change pending for retry
        state.errors += 1
        if on_event is not None:
            on_event("reindex-error")
        raise
    # Only advance the baseline after a clean reindex.
    state.fingerprint = current
    state.reindexes += 1
    state.last_change_poll = state.polls
    state.history.append(current)
    if on_event is not None:
        on_event("reindexed")
    return True


def watch_loop(
    project_path: Path,
    reindex: Callable[[], object],
    *,
    interval: float = 5.0,
    max_polls: int | None = None,
    reindex_on_start: bool = False,
    on_event: Callable[[str], None] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> WatchState:
    """Poll ``project_path`` and reindex on change until interrupted.

    Parameters
    ----------
    interval:
        Seconds between polls. Clamped to :data:`MIN_INTERVAL_SECONDS`.
    max_polls:
        Stop after this many polls (used by tests and ``--once``-style runs).
        ``None`` runs until ``KeyboardInterrupt``.
    reindex_on_start:
        Reindex immediately on startup regardless of change, so the index is
        known-fresh before the first poll interval elapses.
    sleep:
        Injectable sleep, so tests can drive the loop without real delays.
    """
    interval = max(float(interval), MIN_INTERVAL_SECONDS)
    baseline = "" if reindex_on_start else compute_fingerprint(project_path)
    state = WatchState(fingerprint=baseline)

    try:
        while max_polls is None or state.polls < max_polls:
            poll_once(project_path, state, reindex, on_event=on_event)
            if max_polls is not None and state.polls >= max_polls:
                break
            sleep(interval)
    except KeyboardInterrupt:
        if on_event is not None:
            on_event("stopped")
    return state
