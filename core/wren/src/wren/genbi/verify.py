"""Deterministic preflight for GenBI apps.

Structural checks only (no browser): required files exist, the app's MDL
parses, and snapshot apps ship a data asset. A real headless wasm smoke
query is a possible future hardening; deploy gates on this verifier.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

_DATA_ASSET_SUFFIXES = {".parquet", ".duckdb"}


@dataclass
class VerifyResult:
    passed: bool
    failures: list[str] = field(default_factory=list)


def verify_app(app_dir: Path, *, data_mode: str) -> VerifyResult:
    """Run all structural checks for the app at ``app_dir``."""
    failures: list[str] = []

    if not app_dir.is_dir():
        return VerifyResult(False, [f"app folder missing: {app_dir}"])

    if not (app_dir / "index.html").is_file():
        failures.append("missing index.html entry point")

    mdl = app_dir / "mdl.json"
    if not mdl.is_file():
        failures.append("missing mdl.json (copy the compiled MDL into the app)")
    else:
        try:
            parsed = json.loads(mdl.read_text())
            if not parsed:
                failures.append("mdl.json is empty")
        except json.JSONDecodeError as e:
            failures.append(f"mdl.json is not valid JSON: {e}")

    if data_mode == "snapshot":
        assets = [
            p
            for p in app_dir.rglob("*")
            if p.is_file() and p.suffix.lower() in _DATA_ASSET_SUFFIXES
        ]
        if not assets:
            failures.append(
                "snapshot app has no data asset (*.parquet / *.duckdb) — "
                "bundle the data with the app"
            )

    return VerifyResult(not failures, failures)
