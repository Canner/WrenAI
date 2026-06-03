"""App index — the single source of truth for GenBI apps in a project.

Owns ``<project>/.wren/apps.yml``. Machine-written (via ``wren genbi
register``), never hand-rolled. Mirrors the ``~/.wren/profiles.yml``
registry pattern. Secrets are never stored here — only non-secret link
state.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import yaml

INDEX_SCHEMA_VERSION = 1

_INDEX_RELPATH = Path(".wren") / "apps.yml"

# App status state machine: scaffolded → built → deployed
STATUSES = ("scaffolded", "built", "deployed")


def index_path(project_path: Path) -> Path:
    return project_path / _INDEX_RELPATH


def load_index(project_path: Path) -> dict:
    """Return the parsed index, or an empty skeleton if absent."""
    path = index_path(project_path)
    if not path.exists():
        return {"schema_version": INDEX_SCHEMA_VERSION, "apps": {}}
    data = yaml.safe_load(path.read_text()) or {}
    data.setdefault("schema_version", INDEX_SCHEMA_VERSION)
    data.setdefault("apps", {})
    return data


def save_index(project_path: Path, index: dict) -> None:
    path = index_path(project_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(index, default_flow_style=False, sort_keys=False))


def register_app(project_path: Path, name: str, *, data_mode: str) -> dict:
    """Create or update the entry for ``name``. Returns the entry."""
    index = load_index(project_path)
    entry = index["apps"].get(name) or {
        "source": f"apps/{name}",
        "status": "scaffolded",
        "created_at": date.today().isoformat(),
    }
    entry["data_mode"] = data_mode
    index["apps"][name] = entry
    save_index(project_path, index)
    return entry


def remove_app(project_path: Path, name: str) -> bool:
    """Remove the entry for ``name``. Returns False if it wasn't registered."""
    index = load_index(project_path)
    if name not in index["apps"]:
        return False
    del index["apps"][name]
    save_index(project_path, index)
    return True


def get_app(project_path: Path, name: str) -> dict | None:
    """Return the entry for ``name`` or None if not registered."""
    return load_index(project_path)["apps"].get(name)


def update_app(project_path: Path, name: str, **fields) -> dict:
    """Merge ``fields`` into the entry for ``name`` and persist."""
    index = load_index(project_path)
    entry = index["apps"][name]
    entry.update(fields)
    save_index(project_path, index)
    return entry
