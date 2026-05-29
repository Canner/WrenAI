#!/usr/bin/env python3
"""Sync reference docs from ``docs/core/`` into the wren package data.

``docs/core/`` is the source of truth; ``wren/docs_content/refs/`` is a mirror
shipped in the wheel and served by ``wren docs get``. Run before building, and
in CI with ``--check`` to fail if the mirror has drifted.

    python scripts/sync_docs_content.py           # copy docs/core -> package data
    python scripts/sync_docs_content.py --check    # verify in sync (CI gate)
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_WREN = _HERE.parent  # core/wren
_REPO = _WREN.parent.parent  # repo root
_DOCS_CORE = _REPO / "docs" / "core"
_DEST = _WREN / "src" / "wren" / "docs_content" / "refs"

# Load REFERENCE_SOURCES standalone — going through ``wren.docs_delivery``
# triggers ``wren/__init__.py``, which pulls pyarrow + the whole engine
# stack. The CI drift gate runs in a bare Python env without that, so we
# skip the package import and load the module file directly. The module
# must land in ``sys.modules`` before ``exec_module`` so its ``@dataclass``
# can resolve its own ``cls.__module__`` (required on Python 3.14+).
_DD_NAME = "_wren_docs_delivery_standalone"
_DD_SPEC = importlib.util.spec_from_file_location(
    _DD_NAME, _WREN / "src" / "wren" / "docs_delivery.py"
)
_dd = importlib.util.module_from_spec(_DD_SPEC)
sys.modules[_DD_NAME] = _dd
_DD_SPEC.loader.exec_module(_dd)
REFERENCE_SOURCES = _dd.REFERENCE_SOURCES


def _pairs() -> list[tuple[str, Path, Path]]:
    out = []
    for name, spec in sorted(REFERENCE_SOURCES.items()):
        out.append((name, _DOCS_CORE / spec.source, _DEST / f"{name}.md"))
    return out


def _expected_dest_files() -> set[Path]:
    return {dest for _, _, dest in _pairs()}


def _orphan_files() -> list[Path]:
    if not _DEST.is_dir():
        return []
    expected = _expected_dest_files()
    return sorted(p for p in _DEST.glob("*.md") if p not in expected)


def check() -> int:
    problems = []
    for name, src, dest in _pairs():
        if not src.is_file():
            problems.append(f"missing source for '{name}': {src}")
            continue
        if not dest.is_file():
            problems.append(f"not synced: '{name}' (run sync_docs_content.py)")
            continue
        if src.read_bytes() != dest.read_bytes():
            problems.append(f"out of sync: '{name}' (run sync_docs_content.py)")
    for orphan in _orphan_files():
        problems.append(f"orphan in mirror: {orphan.name} (run sync_docs_content.py)")
    if problems:
        print("docs_content out of sync:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print(f"docs_content in sync ({len(_pairs())} references).")
    return 0


def sync() -> int:
    _DEST.mkdir(parents=True, exist_ok=True)
    missing = [n for n, src, _ in _pairs() if not src.is_file()]
    if missing:
        print(f"Error: missing source docs: {', '.join(missing)}", file=sys.stderr)
        return 1
    for name, src, dest in _pairs():
        dest.write_bytes(src.read_bytes())
    removed = []
    for orphan in _orphan_files():
        orphan.unlink()
        removed.append(orphan.name)
    if removed:
        print(f"Removed {len(removed)} orphan(s): {', '.join(removed)}")
    print(f"Synced {len(_pairs())} references into {_DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(check() if "--check" in sys.argv[1:] else sync())
