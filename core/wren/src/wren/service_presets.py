"""Service configuration pieces that need no transport: preset reading and legacy keys.

Kept apart from ``agent_service`` (which imports the MCP transport) so ``wren serve
agent-presets`` can inspect a configuration without the ``mcp`` extra installed.
"""

import re

PRESET_KEYS = frozenset({"metadata_selection", "policy"})
CONFIG_VERSION = 2
LEGACY_CONFIG_KEYS = {
    "dataset": "removed: the data now comes from the Wren project",
    "adhoc": "removed: models and columns now come from the Wren project; deny a column "
    "with a project-level denied_columns entry in knowledge/rules front-matter",
    "metadata": "removed: the structure and rules documents are generated from the Wren project",
    "rules": "removed: business rules are project knowledge (knowledge/rules/*.md), "
    "not service configuration",
    "query_scope": "removed: there is no date-range hard limit in this version; project-level "
    "denied_columns and declared default rules replace it",
}


def reject_legacy(config: dict) -> None:
    """Refuse a configuration that still carries the pre-context-layer keys.

    Nothing is ignored silently: each key is named with what replaced it, because a dropped
    ``query_scope`` or ``adhoc`` list changes what the service allows.
    """
    found = [(k, why) for k, why in LEGACY_CONFIG_KEYS.items() if k in config]
    presets = config.get("policy_presets")
    if isinstance(presets, dict):
        for name, overrides in presets.items():
            if isinstance(overrides, dict) and "query_scope" in overrides:
                found.append(
                    (
                        f"policy_presets.{name}.query_scope",
                        LEGACY_CONFIG_KEYS["query_scope"],
                    )
                )
    if found:
        listed = "; ".join(f"{key} ({why})" for key, why in found)
        raise ValueError(
            f"legacy_service_config: {listed}. Remove them and set config_version: {CONFIG_VERSION}; "
            "see examples/serve-agent/README.md"
        )


def read_policy_presets(config: dict) -> tuple[str | None, dict[str, dict]]:
    """Validate operator-named presets; each may override only PRESET_KEYS."""
    reject_legacy(config)
    presets = config.get("policy_presets")
    if presets is None:
        presets = {}
    default = config.get("default_preset")
    if not isinstance(presets, dict) or (
        default is not None and (not isinstance(default, str) or default not in presets)
    ):
        raise ValueError("invalid_policy_preset")
    for name, overrides in presets.items():
        if (
            not isinstance(name, str)
            or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", name)
            or not isinstance(overrides, dict)
            or not set(overrides) <= PRESET_KEYS
        ):
            raise ValueError("invalid_policy_preset")
    return default, presets
