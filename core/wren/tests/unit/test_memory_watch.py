"""Unit tests for the dependency-free memory watch loop (`wren memory watch`).

These run in the unit CI job: they exercise the change-detection + reindex
loop logic in :mod:`wren.memory.watch` using only the standard library, plus
the CLI's grep-backend guard. No `memory` extra (LanceDB) is required, so the
feature's core behaviour is guarded in every CI run, not skipped.
"""

from __future__ import annotations

import time

import pytest
from typer.testing import CliRunner

from wren.cli import app
from wren.memory.markdown import write_query_markdown
from wren.memory.watch import (
    MIN_INTERVAL_SECONDS,
    WatchState,
    compute_fingerprint,
    poll_once,
    watch_loop,
)

runner = CliRunner()


def _touch_mdl(project, content="{}"):
    target = project / "target"
    target.mkdir(exist_ok=True)
    (target / "mdl.json").write_text(content, encoding="utf-8")


# ── compute_fingerprint ────────────────────────────────────────────────────


def test_fingerprint_stable_when_unchanged(tmp_path):
    _touch_mdl(tmp_path)
    write_query_markdown(tmp_path, "Total revenue", "SELECT SUM(amount) FROM orders")
    fp1 = compute_fingerprint(tmp_path)
    fp2 = compute_fingerprint(tmp_path)
    assert fp1 == fp2
    assert isinstance(fp1, str) and len(fp1) == 64  # sha256 hex


def test_fingerprint_changes_on_new_pair(tmp_path):
    _touch_mdl(tmp_path)
    before = compute_fingerprint(tmp_path)
    write_query_markdown(tmp_path, "Customer count", "SELECT COUNT(*) FROM customers")
    after = compute_fingerprint(tmp_path)
    assert before != after


def test_fingerprint_changes_on_mdl_edit(tmp_path):
    _touch_mdl(tmp_path, '{"models": []}')
    before = compute_fingerprint(tmp_path)
    # Force a distinct mtime even on coarse-resolution filesystems.
    time.sleep(0.01)
    _touch_mdl(tmp_path, '{"models": [{"name": "orders"}]}')
    after = compute_fingerprint(tmp_path)
    assert before != after


def test_fingerprint_empty_project_is_deterministic(tmp_path):
    # No mdl, no knowledge/sql — must not raise and must be stable.
    assert compute_fingerprint(tmp_path) == compute_fingerprint(tmp_path)


# ── poll_once ───────────────────────────────────────────────────────────────


def test_poll_once_no_change_does_not_reindex(tmp_path):
    _touch_mdl(tmp_path)
    state = WatchState(fingerprint=compute_fingerprint(tmp_path))
    calls = []
    triggered = poll_once(tmp_path, state, lambda: calls.append(1))
    assert triggered is False
    assert calls == []
    assert state.polls == 1
    assert state.reindexes == 0


def test_poll_once_reindexes_on_change(tmp_path):
    _touch_mdl(tmp_path)
    state = WatchState(fingerprint=compute_fingerprint(tmp_path))
    write_query_markdown(tmp_path, "New q", "SELECT 1")
    calls = []
    triggered = poll_once(tmp_path, state, lambda: calls.append(1))
    assert triggered is True
    assert calls == [1]
    assert state.reindexes == 1
    assert state.fingerprint == compute_fingerprint(tmp_path)


def test_failed_reindex_keeps_change_pending(tmp_path):
    """A raising reindex must NOT advance the baseline (no silent drop)."""
    _touch_mdl(tmp_path)
    baseline = compute_fingerprint(tmp_path)
    state = WatchState(fingerprint=baseline)
    write_query_markdown(tmp_path, "Boom", "SELECT 1")

    def boom():
        raise RuntimeError("reindex failed")

    with pytest.raises(RuntimeError):
        poll_once(tmp_path, state, boom)
    # Fingerprint unchanged → next poll will retry the same pending change.
    assert state.fingerprint == baseline
    assert state.errors == 1
    assert state.reindexes == 0

    # Subsequent successful poll picks up the still-pending change.
    calls = []
    triggered = poll_once(tmp_path, state, lambda: calls.append(1))
    assert triggered is True
    assert calls == [1]


# ── watch_loop (driven, no real sleeping) ────────────────────────────────────


def test_watch_loop_demonstrates_autoreindex(tmp_path):
    """End-to-end: edits mid-loop are picked up and trigger reindex.

    Drives the loop with an injected `sleep` that mutates the project on the
    first interval, proving the watcher detects a change that lands *after*
    startup and reindexes exactly once for it.
    """
    _touch_mdl(tmp_path, '{"v": 1}')
    events: list[str] = []
    reindex_calls: list[int] = []

    def fake_sleep(_seconds):
        # On the first inter-poll sleep, mutate a watched source.
        if len(reindex_calls) == 0 and not getattr(fake_sleep, "done", False):
            time.sleep(0.01)  # ensure distinct mtime
            write_query_markdown(tmp_path, "Mid-loop edit", "SELECT 42")
            fake_sleep.done = True

    state = watch_loop(
        tmp_path,
        lambda: reindex_calls.append(1),
        interval=5.0,
        max_polls=3,
        on_event=events.append,
        sleep=fake_sleep,
    )

    assert state.polls == 3
    assert state.reindexes == 1  # exactly one reindex for the single edit
    assert reindex_calls == [1]
    assert "change-detected" in events
    assert "reindexed" in events
    # After reindexing, later polls see no further change.
    assert state.last_change_poll < state.polls


def test_watch_loop_reindex_on_start(tmp_path):
    _touch_mdl(tmp_path)
    calls = []
    state = watch_loop(
        tmp_path,
        lambda: calls.append(1),
        interval=5.0,
        max_polls=1,
        reindex_on_start=True,
        sleep=lambda _s: None,
    )
    # Baseline starts empty, so the first poll always reindexes once.
    assert state.reindexes == 1
    assert calls == [1]


def test_watch_loop_clamps_interval(tmp_path, monkeypatch):
    _touch_mdl(tmp_path)
    seen = []
    state = watch_loop(
        tmp_path,
        lambda: None,
        interval=0.0,  # below the floor
        max_polls=2,
        sleep=lambda s: seen.append(s),
    )
    assert state.polls == 2
    assert all(s >= MIN_INTERVAL_SECONDS for s in seen)


# ── CLI guard (grep backend has no derived index to watch) ────────────────────


def test_cli_watch_grep_backend_exits(tmp_path, monkeypatch):
    monkeypatch.setenv("WREN_MEMORY_BACKEND", "grep")
    monkeypatch.setenv("WREN_PROJECT_HOME", str(tmp_path))
    (tmp_path / "wren_project.yml").write_text("name: t\n", encoding="utf-8")
    result = runner.invoke(app, ["memory", "watch", "--max-polls", "1"])
    assert result.exit_code == 1
    assert "grep backend" in result.output
