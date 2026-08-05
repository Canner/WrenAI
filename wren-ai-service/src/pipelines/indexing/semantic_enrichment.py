import copy
import re
from typing import Any

import orjson


_IDENTIFIER_SPLIT_PATTERN = re.compile(
    r"(?<=[a-z0-9])(?=[A-Z])|[^a-zA-Z0-9]+"
)
_WEAK_DESCRIPTION_VALUES = {"", "none", "null", "n/a", "na", "description"}


_ROLE_KEYWORDS = {
    "date/time filter": {
        "date",
        "day",
        "month",
        "year",
        "time",
        "period",
        "fiscal",
        "calendar",
    },
    "country/geography filter": {
        "country",
        "nation",
        "region",
        "state",
        "city",
        "destination",
        "origin",
        "location",
    },
    "market/business-unit dimension": {
        "market",
        "business",
        "unit",
        "bu",
        "entity",
        "segment",
        "division",
    },
    "customer/party dimension": {
        "customer",
        "client",
        "consignee",
        "importer",
        "exporter",
        "vendor",
        "supplier",
        "shipper",
        "broker",
    },
    "order/transaction identifier": {
        "order",
        "invoice",
        "shipment",
        "claim",
        "payment",
        "reference",
        "number",
        "po",
        "id",
        "key",
        "code",
    },
    "numeric measure": {
        "amount",
        "value",
        "sales",
        "sale",
        "cost",
        "price",
        "margin",
        "rate",
        "quantity",
        "qty",
        "count",
        "total",
        "balance",
    },
    "status/category filter": {
        "status",
        "type",
        "category",
        "class",
        "flag",
        "indicator",
    },
}

_NUMERIC_TYPE_PATTERN = re.compile(
    r"\b(int|integer|bigint|smallint|tinyint|decimal|numeric|float|double|real|money)\b",
    re.IGNORECASE,
)
_DATE_TYPE_PATTERN = re.compile(r"\b(date|time|timestamp|datetime)\b", re.IGNORECASE)


def enrich_mdl_for_retrieval(mdl: dict[str, Any]) -> dict[str, Any]:
    """Return an MDL copy with richer retrieval-only semantics."""

    enriched = copy.deepcopy(mdl)
    enriched.setdefault("models", [])
    enriched.setdefault("relationships", [])
    enriched.setdefault("views", [])
    enriched.setdefault("metrics", [])

    for model in enriched["models"]:
        if not isinstance(model, dict):
            continue
        _enrich_model(model)

    _add_inferred_relationships(enriched)

    return enriched


def enrich_mdl_str_for_retrieval(mdl_str: str) -> str:
    mdl = orjson.loads(mdl_str)
    return orjson.dumps(enrich_mdl_for_retrieval(mdl)).decode("utf-8")


def _enrich_model(model: dict[str, Any]) -> None:
    properties = _properties(model)
    model_label = _model_label(model)

    properties.setdefault("displayName", model_label)
    if _is_weak_text(properties.get("description")):
        properties["description"] = _model_description(model, model_label)
    else:
        properties["description"] = _append_semantic_hint(
            properties.get("description", ""),
            _model_role_summary(model),
        )

    model["properties"] = properties

    for column in model.get("columns", []) or []:
        if isinstance(column, dict) and not column.get("relationship"):
            _enrich_column(column, model_label)


def _enrich_column(column: dict[str, Any], model_label: str) -> None:
    properties = _properties(column)
    column_label = _humanize_identifier(
        properties.get("displayName")
        or properties.get("sourceColumnName")
        or column.get("name", "")
    )
    roles = _column_roles(column)

    properties.setdefault("displayName", column_label)
    generated_description = _column_description(column_label, model_label, roles)
    if _is_weak_text(properties.get("description")):
        properties["description"] = generated_description
    else:
        properties["description"] = _append_semantic_hint(
            properties.get("description", ""),
            f"Semantic roles: {', '.join(roles)}.",
        )

    column["properties"] = properties


def _add_inferred_relationships(mdl: dict[str, Any]) -> None:
    models = [model for model in mdl.get("models", []) if isinstance(model, dict)]
    existing_conditions = {
        _normalize_condition(relationship.get("condition", ""))
        for relationship in mdl.get("relationships", []) or []
        if isinstance(relationship, dict)
    }
    existing_names = {
        relationship.get("name")
        for relationship in mdl.get("relationships", []) or []
        if isinstance(relationship, dict)
    }

    relationships = mdl.setdefault("relationships", [])
    for source in models:
        for target in models:
            if source is target:
                continue

            target_pk = target.get("primaryKey")
            if not target_pk:
                continue

            target_column = _find_column(target, target_pk)
            if not target_column:
                continue

            for source_column in source.get("columns", []) or []:
                if not isinstance(source_column, dict) or source_column.get(
                    "relationship"
                ):
                    continue
                if source_column.get("name") == source.get("primaryKey"):
                    continue
                if not _looks_like_foreign_key(source, source_column, target, target_pk):
                    continue

                condition = (
                    f"{source.get('name')}.{source_column.get('name')} = "
                    f"{target.get('name')}.{target_pk}"
                )
                if _normalize_condition(condition) in existing_conditions:
                    continue

                name = _unique_relationship_name(
                    existing_names,
                    f"{source.get('name')}_{target.get('name')}_{source_column.get('name')}",
                )
                relationships.append(
                    {
                        "name": name,
                        "models": [source.get("name"), target.get("name")],
                        "joinType": "MANY_TO_ONE",
                        "condition": condition,
                        "properties": {
                            "description": (
                                f"Connects {_model_label(source)} records to "
                                f"{_model_label(target)} using "
                                f"{_humanize_identifier(source_column.get('name', ''))}."
                            )
                        },
                    }
                )
                existing_names.add(name)
                existing_conditions.add(_normalize_condition(condition))


def _looks_like_foreign_key(
    source: dict[str, Any],
    source_column: dict[str, Any],
    target: dict[str, Any],
    target_pk: str,
) -> bool:
    source_name = str(source_column.get("name", ""))
    source_norm = _compact_identifier(source_name)
    target_pk_norm = _compact_identifier(target_pk)
    target_tokens = _token_set(_model_label(target)) | _token_set(target.get("name", ""))

    if source_norm == target_pk_norm:
        return True

    source_tokens = _token_set(source_name)
    if target_pk_norm == "id":
        return bool(target_tokens & source_tokens) and bool(
            {"id", "key", "number", "num", "code"} & source_tokens
        )

    return (
        source_norm.endswith(target_pk_norm)
        and bool(target_tokens & source_tokens)
        and not _same_business_entity(source, target)
    )


def _same_business_entity(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return _compact_identifier(_model_label(left)) == _compact_identifier(
        _model_label(right)
    )


def _column_roles(column: dict[str, Any]) -> list[str]:
    tokens = set(
        _identifier_tokens(
            " ".join(
                str(value)
                for value in [
                    column.get("name", ""),
                    _properties(column).get("displayName", ""),
                    _properties(column).get("sourceColumnName", ""),
                    _properties(column).get("description", ""),
                ]
                if value
            )
        )
    )
    roles = [
        role
        for role, keywords in _ROLE_KEYWORDS.items()
        if tokens & keywords
    ]

    column_type = str(column.get("type", ""))
    if _DATE_TYPE_PATTERN.search(column_type) and "date/time filter" not in roles:
        roles.append("date/time filter")
    if _NUMERIC_TYPE_PATTERN.search(column_type) and "numeric measure" not in roles:
        roles.append("numeric measure")

    return roles or ["descriptive attribute"]


def _model_description(model: dict[str, Any], model_label: str) -> str:
    source = _source_table(model)
    role_summary = _model_role_summary(model)
    parts = [f"Business model for {model_label} records."]
    if source:
        parts.append(f"Backed by deployed source {source}.")
    if role_summary:
        parts.append(role_summary)
    return " ".join(parts)


def _model_role_summary(model: dict[str, Any]) -> str:
    role_counts: dict[str, int] = {}
    for column in model.get("columns", []) or []:
        if not isinstance(column, dict) or column.get("relationship"):
            continue
        for role in _column_roles(column):
            role_counts[role] = role_counts.get(role, 0) + 1

    if not role_counts:
        return ""

    roles = sorted(role_counts, key=lambda role: (-role_counts[role], role))[:6]
    return f"Contains fields useful as {', '.join(roles)}."


def _column_description(column_label: str, model_label: str, roles: list[str]) -> str:
    role_text = ", ".join(roles)
    if "date/time filter" in roles:
        return (
            f"{column_label} is a date/time field for filtering and grouping "
            f"{model_label} records by period. Semantic roles: {role_text}."
        )
    if "numeric measure" in roles:
        return (
            f"{column_label} is a numeric field for aggregations, ranking, and "
            f"measure calculations on {model_label} records. Semantic roles: {role_text}."
        )
    if any("filter" in role or "dimension" in role for role in roles):
        return (
            f"{column_label} is a business dimension/filter field for {model_label} "
            f"records. Semantic roles: {role_text}."
        )
    return (
        f"{column_label} describes {model_label} records. "
        f"Semantic roles: {role_text}."
    )


def _properties(payload: dict[str, Any]) -> dict[str, Any]:
    properties = payload.get("properties")
    return properties if isinstance(properties, dict) else {}


def _model_label(model: dict[str, Any]) -> str:
    properties = _properties(model)
    return _humanize_identifier(
        properties.get("displayName")
        or _source_table(model)
        or model.get("name", "")
    )


def _source_table(model: dict[str, Any]) -> str:
    table_reference = model.get("tableReference")
    if isinstance(table_reference, dict):
        return str(table_reference.get("table") or "")
    return ""


def _append_semantic_hint(description: str, hint: str, max_length: int = 1000) -> str:
    description = str(description or "").strip()
    hint = str(hint or "").strip()
    if not hint or hint.lower() in description.lower():
        return description
    value = f"{description} {hint}".strip()
    return value[: max_length - 3] + "..." if len(value) > max_length else value


def _is_weak_text(value: Any) -> bool:
    text = str(value or "").strip()
    return text.lower() in _WEAK_DESCRIPTION_VALUES


def _humanize_identifier(value: Any) -> str:
    tokens = _identifier_tokens(str(value or ""))
    return " ".join(
        token.upper() if len(token) <= 3 else token.title() for token in tokens
    )


def _identifier_tokens(value: str) -> list[str]:
    return [
        token.lower()
        for token in _IDENTIFIER_SPLIT_PATTERN.split(value or "")
        if token
    ]


def _token_set(value: Any) -> set[str]:
    tokens = set(_identifier_tokens(str(value or "")))
    return tokens | {_singularize(token) for token in tokens}


def _singularize(token: str) -> str:
    if token.endswith("ies") and len(token) > 3:
        return f"{token[:-3]}y"
    if token.endswith("s") and len(token) > 3:
        return token[:-1]
    return token


def _compact_identifier(value: Any) -> str:
    return "".join(_identifier_tokens(str(value or "")))


def _find_column(model: dict[str, Any], name: str) -> dict[str, Any] | None:
    normalized = _compact_identifier(name)
    for column in model.get("columns", []) or []:
        if (
            isinstance(column, dict)
            and _compact_identifier(column.get("name", "")) == normalized
        ):
            return column
    return None


def _normalize_condition(condition: str) -> str:
    parts = [part.strip().lower() for part in str(condition or "").split("=")]
    if len(parts) != 2:
        return str(condition or "").strip().lower()
    return "=".join(sorted(parts))


def _unique_relationship_name(existing_names: set[str], base: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9_]+", "_", base).strip("_") or "relationship"
    sanitized = sanitized[:100]
    candidate = sanitized
    counter = 2
    while candidate in existing_names:
        suffix = f"_{counter}"
        candidate = f"{sanitized[: 100 - len(suffix)]}{suffix}"
        counter += 1
    return candidate
