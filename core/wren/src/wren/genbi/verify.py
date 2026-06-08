"""Deterministic preflight for GenBI apps.

Structural checks only (no browser): required files exist, the app's MDL
parses, and snapshot apps ship a data asset. A real headless wasm smoke
query is a possible future hardening; deploy gates on this verifier.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

_DATA_ASSET_SUFFIXES = {".parquet", ".duckdb"}

# Text files worth scanning for inlined credentials.
_SCANNABLE_SUFFIXES = {".html", ".htm", ".js", ".mjs", ".json", ".css", ".txt", ".md"}

# A public static app must never ship credentials — anyone who opens the
# URL can read every file. Patterns kept narrow to avoid false positives.
_SECRET_PATTERNS: tuple[tuple[str, re.Pattern], ...] = (
    (
        "connection string with password",
        re.compile(r"\b\w+://[^/\s:@]+:[^/\s@]+@[^/\s]+"),
    ),
    (
        "AWS access key id",
        re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    ),
    (
        "password/secret/token assignment",
        re.compile(
            r"""["']?(password|passwd|secret|api[_-]?key|access[_-]?token)["']?"""
            r"""\s*[:=]\s*["'][^"']{8,}["']""",
            re.IGNORECASE,
        ),
    ),
)


def _scan_for_secrets(app_dir: Path) -> list[str]:
    """Return failure messages for files that appear to inline credentials."""
    failures = []
    for path in sorted(app_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in _SCANNABLE_SUFFIXES:
            continue
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        for label, pattern in _SECRET_PATTERNS:
            if pattern.search(text):
                failures.append(
                    f"possible inlined secret in {path.relative_to(app_dir)} "
                    f"({label}) — a public static app must never ship credentials"
                )
                break
    return failures


@dataclass
class VerifyResult:
    passed: bool
    failures: list[str] = field(default_factory=list)


def verify_app(app_dir: Path, *, data_mode: str) -> VerifyResult:
    """Run all structural checks for the app at ``app_dir``."""
    from wren.genbi.composer import DATA_MODES  # noqa: PLC0415

    failures: list[str] = []

    # Fail closed on an unknown mode — otherwise a typo (e.g. "snapsho") would
    # silently skip the snapshot data-asset check and pass.
    if data_mode not in DATA_MODES:
        return VerifyResult(
            False,
            [
                f"unknown data_mode {data_mode!r} "
                f"(expected one of: {', '.join(DATA_MODES)})"
            ],
        )

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

    # Security gate for every mode: the app ships to a public static host.
    failures.extend(_scan_for_secrets(app_dir))

    return VerifyResult(not failures, failures)
