"""Serve reference docs from package data.

Reference docs are copies of ``docs/core/`` files, synced into the wheel under
``wren/docs_content/refs/<name>.md`` by ``scripts/sync_docs_content.py``.
``docs/core/`` is the source of truth; the package data is a mirror. ``wren
docs get <name>`` returns a reference; ``wren docs list`` enumerates them.
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib import resources

_REFS_DIR = "docs_content"


@dataclass(frozen=True)
class ReferenceSpec:
    source: str  # path under docs/core/
    summary: str


# Curated agent-facing references. Name -> (source path under docs/core, summary).
# Keep names short and stable; skills reference these via `wren docs get <name>`.
REFERENCE_SOURCES: dict[str, ReferenceSpec] = {
    # guides
    "connect": ReferenceSpec(
        "guides/connect.md", "Database connection setup, profiles, troubleshooting"
    ),
    "cubes": ReferenceSpec("guides/cubes.md", "Cube (named metric) definitions in MDL"),
    "model": ReferenceSpec("guides/model.md", "Model definitions in MDL"),
    "manage-project": ReferenceSpec(
        "guides/manage_project.md", "Manage a Wren project (init / build / validate)"
    ),
    "dbt-integration": ReferenceSpec(
        "guides/dbt-integration.md", "Use Wren alongside dbt"
    ),
    "refine": ReferenceSpec("guides/refine.md", "Refine and iterate on an MDL project"),
    # get started
    "installation": ReferenceSpec(
        "get_started/installation.md", "pip install paths and optional extras"
    ),
    "quickstart": ReferenceSpec(
        "get_started/quickstart.md", "Bundled jaffle_shop demo walkthrough"
    ),
    # concepts
    "what-is-mdl": ReferenceSpec(
        "concepts/what_is_mdl.md", "What the Modeling Definition Language is"
    ),
    "what-is-context": ReferenceSpec(
        "concepts/what_is_context.md", "What Wren's context layer is"
    ),
    "memory-system": ReferenceSpec(
        "concepts/memory_system.md", "How the semantic memory system works"
    ),
    "correctness": ReferenceSpec(
        "concepts/correctness.md", "Correctness primitives and guarantees"
    ),
    # reference
    "mdl": ReferenceSpec("reference/mdl.md", "MDL field reference"),
    "architecture": ReferenceSpec(
        "reference/architecture.md", "Engine and connector architecture"
    ),
    "operational": ReferenceSpec(
        "reference/operational.md", "Operational reference (limits, config)"
    ),
}


class ReferenceNotFoundError(Exception):
    """Raised when a requested reference name is not a known/bundled doc."""


def _refs_root():
    return resources.files("wren") / _REFS_DIR / "refs"


def list_references() -> list[tuple[str, str]]:
    """Return ``(name, summary)`` for every known reference, sorted by name."""
    return [(name, spec.summary) for name, spec in sorted(REFERENCE_SOURCES.items())]


def get_reference(name: str) -> str:
    """Return the markdown body of reference ``name``."""
    if name not in REFERENCE_SOURCES:
        raise ReferenceNotFoundError(name)
    doc = _refs_root() / f"{name}.md"
    if not doc.is_file():
        raise ReferenceNotFoundError(name)
    return doc.read_text(encoding="utf-8")
