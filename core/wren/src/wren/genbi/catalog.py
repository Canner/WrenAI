"""The persistent GenBI app catalog.

``apps/index.yml`` is the committable source of truth for which data apps exist
in a project. Each app's implementation lives in ``apps/<name>/``. This module
reads/writes the index and reconciles it against the folders on disk. It holds
NO runtime/process state — that lives, ephemerally and gitignored, in
``apps/.run/``.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

_APPS_DIR = "apps"
_INDEX_FILE = "index.yml"
_RUN_DIR = ".run"


@dataclass
class AppEntry:
    """One catalog row: an app's name, entry file, and metadata."""

    name: str
    entry: str
    description: str = ""
    cube: str | None = None


@dataclass
class ReconcileResult:
    """Differences between the index and the app folders on disk."""

    missing_dir: list[str]  # index names whose entry file is absent on disk
    unregistered: list[str]  # app folders on disk absent from the index


def apps_dir(project_path: Path | str) -> Path:
    """Return ``<project>/apps``."""
    return Path(project_path) / _APPS_DIR


def index_path(project_path: Path | str) -> Path:
    """Return ``<project>/apps/index.yml``."""
    return apps_dir(project_path) / _INDEX_FILE


def read_index(project_path: Path | str) -> list[AppEntry]:
    """Read the catalog, returning an empty list if no index exists."""
    path = index_path(project_path)
    if not path.exists():
        return []
    data = yaml.safe_load(path.read_text()) or {}
    rows = data.get("apps", []) if isinstance(data, dict) else []
    entries: list[AppEntry] = []
    for row in rows:
        entries.append(
            AppEntry(
                name=row["name"],
                entry=row["entry"],
                description=row.get("description", ""),
                cube=row.get("cube"),
            )
        )
    return entries


def write_index(project_path: Path | str, entries: list[AppEntry]) -> None:
    """Write the full catalog, creating ``apps/`` if needed."""
    path = index_path(project_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for e in entries:
        row: dict = {"name": e.name, "entry": e.entry}
        if e.description:
            row["description"] = e.description
        if e.cube is not None:
            row["cube"] = e.cube
        rows.append(row)
    path.write_text(yaml.safe_dump({"apps": rows}, sort_keys=False))


def add_entry(project_path: Path | str, entry: AppEntry) -> None:
    """Upsert *entry* into the catalog (replace any row with the same name)."""
    entries = [e for e in read_index(project_path) if e.name != entry.name]
    entries.append(entry)
    write_index(project_path, entries)


def reconcile(project_path: Path | str) -> ReconcileResult:
    """Compare the index against the app folders on disk."""
    entries = read_index(project_path)
    indexed = {e.name for e in entries}

    missing_dir = [
        e.name for e in entries if not (apps_dir(project_path) / e.entry).exists()
    ]

    on_disk: set[str] = set()
    apps_root = apps_dir(project_path)
    if apps_root.exists():
        for child in apps_root.iterdir():
            if child.is_dir() and child.name != _RUN_DIR:
                on_disk.add(child.name)

    unregistered = sorted(on_disk - indexed)
    return ReconcileResult(missing_dir=missing_dir, unregistered=unregistered)
