"""Unit tests for wren.genbi.catalog — the persistent app catalog.

The catalog is the committable source of truth for *which apps exist*: an
``apps/index.yml`` mapping app name → entry file + metadata, plus reconciliation
against the actual ``apps/<name>/`` folders. No process/runtime state here.
"""

from __future__ import annotations

import pytest

from wren.genbi import catalog

pytestmark = pytest.mark.unit


def _make_app_dir(project, name, *, entry="app.py"):
    d = project / "apps" / name
    d.mkdir(parents=True, exist_ok=True)
    (d / entry).write_text("# app\n")
    return d


def test_read_index_empty_when_missing(tmp_path):
    assert catalog.read_index(tmp_path) == []


def test_add_entry_then_read_round_trips(tmp_path):
    _make_app_dir(tmp_path, "revenue")
    catalog.add_entry(
        tmp_path,
        catalog.AppEntry(
            name="revenue",
            entry="revenue/app.py",
            description="Monthly revenue",
            cube="sales",
        ),
    )
    entries = catalog.read_index(tmp_path)
    assert len(entries) == 1
    e = entries[0]
    assert e.name == "revenue"
    assert e.entry == "revenue/app.py"
    assert e.description == "Monthly revenue"
    assert e.cube == "sales"


def test_add_entry_is_upsert_not_duplicate(tmp_path):
    _make_app_dir(tmp_path, "revenue")
    catalog.add_entry(
        tmp_path,
        catalog.AppEntry(name="revenue", entry="revenue/app.py", description="v1"),
    )
    catalog.add_entry(
        tmp_path,
        catalog.AppEntry(name="revenue", entry="revenue/app.py", description="v2"),
    )
    entries = catalog.read_index(tmp_path)
    assert len(entries) == 1
    assert entries[0].description == "v2"


def test_reconcile_clean_when_index_matches_folders(tmp_path):
    _make_app_dir(tmp_path, "revenue")
    catalog.add_entry(
        tmp_path, catalog.AppEntry(name="revenue", entry="revenue/app.py")
    )
    result = catalog.reconcile(tmp_path)
    assert result.missing_dir == []
    assert result.unregistered == []


def test_reconcile_flags_index_entry_without_folder(tmp_path):
    # Registered in index, but the entry file is absent on disk.
    catalog.add_entry(tmp_path, catalog.AppEntry(name="ghost", entry="ghost/app.py"))
    result = catalog.reconcile(tmp_path)
    assert "ghost" in result.missing_dir
    assert result.unregistered == []


def test_reconcile_flags_folder_not_in_index(tmp_path):
    _make_app_dir(tmp_path, "orphan")
    result = catalog.reconcile(tmp_path)
    assert "orphan" in result.unregistered
    assert result.missing_dir == []


def test_reconcile_ignores_run_state_dir(tmp_path):
    # apps/.run/ holds ephemeral runtime state and must never count as an app.
    (tmp_path / "apps" / ".run").mkdir(parents=True)
    (tmp_path / "apps" / ".run" / "revenue.json").write_text("{}")
    result = catalog.reconcile(tmp_path)
    assert result.unregistered == []
