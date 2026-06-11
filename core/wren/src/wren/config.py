"""Wren CLI configuration loaded from ~/.wren/config.json."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from wren.model.error import ErrorCode, WrenError


@dataclass(frozen=True)
class WrenConfig:
    """Immutable configuration for the Wren CLI.

    Attributes
    ----------
    strict_mode:
        When ``True``, all table references in SQL must be defined in the MDL
        manifest.  Queries referencing non-MDL tables are rejected.
    denied_functions:
        Set of function names (lowercase) that are forbidden in SQL queries.
        Matching is case-insensitive.
    """

    strict_mode: bool = False
    denied_functions: frozenset[str] = field(default_factory=frozenset)


def load_config(wren_home: Path) -> WrenConfig:
    """Load configuration from ``wren_home/config.json``.

    Returns default ``WrenConfig`` when the file does not exist.
    Raises ``WrenError`` when the file exists but contains invalid JSON.
    """
    config_path = wren_home / "config.json"
    if not config_path.exists():
        return WrenConfig()

    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, OSError) as e:
        raise WrenError(
            ErrorCode.GENERIC_USER_ERROR,
            f"Failed to read {config_path}: {e}",
        ) from e

    if not isinstance(raw, dict):
        raise WrenError(
            ErrorCode.GENERIC_USER_ERROR,
            f"{config_path} must contain a JSON object.",
        )

    strict_mode_raw = raw.get("strict_mode", False)
    if not isinstance(strict_mode_raw, bool):
        raise WrenError(
            ErrorCode.GENERIC_USER_ERROR,
            f"{config_path}: 'strict_mode' must be a JSON boolean.",
        )

    denied_raw = raw.get("denied_functions", [])
    if not isinstance(denied_raw, list):
        raise WrenError(
            ErrorCode.GENERIC_USER_ERROR,
            f"{config_path}: 'denied_functions' must be a JSON array.",
        )
    if any(not isinstance(f, str) for f in denied_raw):
        raise WrenError(
            ErrorCode.GENERIC_USER_ERROR,
            f"{config_path}: 'denied_functions' must contain only strings.",
        )
    denied_functions = frozenset(f.lower() for f in denied_raw)

    return WrenConfig(strict_mode=strict_mode_raw, denied_functions=denied_functions)
