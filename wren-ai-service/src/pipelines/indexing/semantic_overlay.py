import copy
import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("wren-ai-service")


def apply_semantic_overlay_file(
    mdl: dict[str, Any],
    overlay_path: str | None,
) -> dict[str, Any]:
    if not overlay_path:
        return mdl

    path = Path(overlay_path)
    if not path.is_absolute():
        path = Path.cwd() / path

    if not path.exists():
        logger.warning("Semantic overlay file does not exist: %s", path)
        return mdl

    with path.open("r", encoding="utf-8") as file:
        overlay = yaml.safe_load(file) or {}

    return apply_semantic_overlay(mdl, overlay)


def apply_semantic_overlay(
    mdl: dict[str, Any],
    overlay: dict[str, Any],
) -> dict[str, Any]:
    enriched = copy.deepcopy(mdl)
    enriched.setdefault("models", [])
    enriched.setdefault("relationships", [])
    enriched.setdefault("views", [])
    enriched.setdefault("metrics", [])

    model_map = {_key(model.get("name")): model for model in enriched["models"]}
    for model_name, metadata in (overlay.get("models") or {}).items():
        model = model_map.get(_key(model_name))
        if not model:
            logger.warning("Semantic overlay skipped missing model: %s", model_name)
            continue
        _merge_model_metadata(model, metadata or {})

    relationship_names = {
        relationship.get("name")
        for relationship in enriched["relationships"]
        if isinstance(relationship, dict)
    }
    relationship_conditions = {
        _normalize_condition(relationship.get("condition", ""))
        for relationship in enriched["relationships"]
        if isinstance(relationship, dict)
    }

    for relationship in overlay.get("relationships") or []:
        relationship_mdl = _build_relationship(
            relationship,
            model_map,
            relationship_names,
        )
        if not relationship_mdl:
            continue

        normalized_condition = _normalize_condition(relationship_mdl["condition"])
        if (
            relationship_mdl["name"] in relationship_names
            or normalized_condition in relationship_conditions
        ):
            continue

        enriched["relationships"].append(relationship_mdl)
        relationship_names.add(relationship_mdl["name"])
        relationship_conditions.add(normalized_condition)

    return enriched


def _merge_model_metadata(model: dict[str, Any], metadata: dict[str, Any]) -> None:
    properties = _properties(model)
    if metadata.get("displayName"):
        properties["displayName"] = metadata["displayName"]
    if metadata.get("description"):
        properties["description"] = metadata["description"]
    model["properties"] = properties

    column_map = {_key(column.get("name")): column for column in model.get("columns", [])}
    for column_name, column_metadata in (metadata.get("columns") or {}).items():
        column = column_map.get(_key(column_name))
        if not column:
            logger.warning(
                "Semantic overlay skipped missing column: %s.%s",
                model.get("name"),
                column_name,
            )
            continue

        column_properties = _properties(column)
        if column_metadata.get("displayName"):
            column_properties["displayName"] = column_metadata["displayName"]
        if column_metadata.get("description"):
            column_properties["description"] = column_metadata["description"]
        column["properties"] = column_properties


def _build_relationship(
    relationship: dict[str, Any],
    model_map: dict[str, dict[str, Any]],
    relationship_names: set[str],
) -> dict[str, Any] | None:
    from_model = model_map.get(_key(relationship.get("fromModel")))
    to_model = model_map.get(_key(relationship.get("toModel")))
    if not from_model or not to_model:
        logger.warning(
            "Semantic overlay skipped relationship with missing model: %s -> %s",
            relationship.get("fromModel"),
            relationship.get("toModel"),
        )
        return None

    join_pairs = relationship.get("join") or []
    condition_parts = []
    for join_pair in join_pairs:
        from_column = _resolve_column(from_model, join_pair.get("from"))
        to_column = _resolve_column(to_model, join_pair.get("to"))
        if not from_column or not to_column:
            logger.warning(
                "Semantic overlay skipped relationship with missing column: %s -> %s",
                relationship.get("fromModel"),
                relationship.get("toModel"),
            )
            return None
        condition_parts.append(
            f"{from_model['name']}.{from_column['name']} = "
            f"{to_model['name']}.{to_column['name']}"
        )

    if not condition_parts:
        condition = relationship.get("condition")
        if not condition:
            return None
    else:
        condition = " AND ".join(condition_parts)

    name = relationship.get("name") or (
        f"{from_model['name']}_{to_model['name']}_relationship"
    )
    name = _unique_name(relationship_names, name)

    return {
        "name": name,
        "models": [from_model["name"], to_model["name"]],
        "joinType": relationship.get("type", "MANY_TO_ONE"),
        "condition": condition,
        "properties": {
            "description": relationship.get("description", ""),
            "semanticJoinPath": relationship.get("businessRule", ""),
            "semanticSource": "semantic_overlay",
        },
    }


def _resolve_column(model: dict[str, Any], column_name: str | None) -> dict[str, Any] | None:
    column_map = {_key(column.get("name")): column for column in model.get("columns", [])}
    return column_map.get(_key(column_name))


def _properties(payload: dict[str, Any]) -> dict[str, Any]:
    properties = payload.get("properties")
    return properties if isinstance(properties, dict) else {}


def _key(value: Any) -> str:
    return str(value or "").replace("_", "").replace(" ", "").lower()


def _normalize_condition(condition: str) -> str:
    return " ".join(str(condition or "").lower().split())


def _unique_name(existing_names: set[str], name: str) -> str:
    candidate = name
    counter = 2
    while candidate in existing_names:
        candidate = f"{name}_{counter}"
        counter += 1
    return candidate
