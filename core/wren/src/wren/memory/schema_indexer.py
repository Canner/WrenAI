"""Extract indexable records from an MDL manifest dict.

Pure functions — no LanceDB or embedding dependency.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone


def manifest_hash(manifest: dict) -> str:
    """Deterministic SHA-256 hash (16 hex chars) of a manifest dict.

    Internal keys (prefixed with ``_``) are excluded from the hash so that
    auxiliary data like ``_instructions`` does not invalidate the schema cache
    when only instructions change.
    """
    schema_only = {k: v for k, v in manifest.items() if not k.startswith("_")}
    raw = json.dumps(schema_only, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ~30K chars ≈ ~8K tokens.  Below this threshold the full plain-text
# description fits comfortably in a single LLM context window and
# outperforms embedding search because the LLM sees the complete
# schema structure (model→column relationships, join paths, etc.)
# rather than isolated fragments.  The threshold is measured in
# characters (not tokens) because character length is free to compute
# after generating the text, while accurate token counting requires a
# tokeniser dependency.  The 4:1 chars-to-tokens ratio holds for
# English; CJK text is ~1.5:1, so a CJK-heavy schema will switch to
# embedding search sooner — which is the conservative (safe) direction.
SCHEMA_DESCRIBE_THRESHOLD = 30_000


def describe_schema(manifest: dict) -> str:
    """Generate a structured plain-text description of the full MDL schema.

    Designed to be pasted directly into an LLM prompt when the schema is
    small enough (see :data:`SCHEMA_DESCRIBE_THRESHOLD`).
    """
    lines: list[str] = []

    catalog = manifest.get("catalog", "")
    schema = manifest.get("schema", "")
    if catalog or schema:
        lines.append(f"Catalog: {catalog}, Schema: {schema}")
        lines.append("")

    for model in manifest.get("models", []):
        _describe_model(model, lines)

    for rel in manifest.get("relationships", []):
        _describe_relationship(rel, lines)

    for view in manifest.get("views", []):
        _describe_view(view, lines)

    return "\n".join(lines)


def _describe_model(model: dict, lines: list[str]) -> None:
    name = model["name"]
    desc = _prop_description(model)
    header = f"### Model: {name}"
    layer = _prop_value(model, "dbtLayer", "dbt_layer")
    if layer:
        header += f" [{layer} layer]"
    if desc:
        header += f" — {desc}"
    lines.append(header)

    pk = model.get("primaryKey")
    if pk:
        lines.append(f"  Primary key: {pk}")

    data_scope = _prop_value(model, "dataScope", "data_scope")
    if data_scope:
        lines.append(f"  Data scope: {data_scope}")

    cols = model.get("columns", [])
    if cols:
        lines.append("  Columns:")
        for col in cols:
            _describe_column(col, lines)
    lines.append("")


def _describe_column(col: dict, lines: list[str]) -> None:
    name = col["name"]
    dtype = col.get("type", "?")
    parts = [f"    - {name} ({dtype})"]

    desc = _prop_description(col)
    if desc:
        parts.append(f" — {desc}")

    is_calc = col.get("isCalculated", False)
    expr = col.get("expression")
    if is_calc and expr:
        parts.append(f" [calculated: {expr}]")

    rel = col.get("relationship")
    if rel:
        parts.append(f" [relationship: {rel}]")

    derived_from = _prop_value(col, "derivedFrom", "derived_from")
    if derived_from:
        parts.append(f" [derived from: {derived_from}]")

    accepted_values = _format_csv_values(
        _prop_value(col, "acceptedValues", "accepted_values")
    )
    if accepted_values:
        parts.append(f" [accepted values: {accepted_values}]")

    if col.get("notNull"):
        parts.append(" NOT NULL")
    if col.get("isPrimaryKey"):
        parts.append(" PRIMARY KEY")

    dbt_tests = _prop_value(col, "dbtTests", "dbt_tests")
    if dbt_tests:
        parts.append(f" [dbt tests: {dbt_tests}]")

    dbt_test_status = _prop_value(col, "dbtTestStatus", "dbt_test_status")
    if dbt_test_status:
        parts.append(f" [test status: {dbt_test_status}]")

    lines.append("".join(parts))


def _describe_relationship(rel: dict, lines: list[str]) -> None:
    name = rel["name"]
    models = rel.get("models", [])
    left = models[0] if len(models) > 0 else "?"
    right = models[1] if len(models) > 1 else "?"
    join_type = rel.get("joinType", "")
    condition = rel.get("condition", "")
    lines.append(f"### Relationship: {name}")
    lines.append(f"  {left} → {right} ({join_type})")
    if condition:
        lines.append(f"  Condition: {condition}")
    lines.append("")


def _describe_view(view: dict, lines: list[str]) -> None:
    name = view["name"]
    stmt = view.get("statement", "")
    lines.append(f"### View: {name}")
    if stmt:
        lines.append(f"  SQL: {stmt}")
    lines.append("")


def extract_schema_items(manifest: dict) -> list[dict]:
    """Walk an MDL manifest and produce one record per indexable element.

    Each record contains a ``text`` field (synthesised description for
    embedding) plus structured metadata columns that match the
    ``schema_items`` LanceDB table schema.
    """
    now = datetime.now(timezone.utc)
    mdl_h = manifest_hash(manifest)
    items: list[dict] = []

    for model in manifest.get("models", []):
        items.append(_model_record(model, mdl_h, now))
        for col in model.get("columns", []):
            items.append(_column_record(col, model["name"], mdl_h, now))

    for rel in manifest.get("relationships", []):
        items.append(_relationship_record(rel, mdl_h, now))

    for view in manifest.get("views", []):
        items.append(_view_record(view, mdl_h, now))

    return items


# ── Record builders ───────────────────────────────────────────────────────


def _model_record(model: dict, mdl_h: str, now: datetime) -> dict:
    name = model["name"]
    cols = model.get("columns", [])
    col_summaries = ", ".join(f"{c['name']} ({c.get('type', '?')})" for c in cols[:20])
    pk = model.get("primaryKey") or ""

    description = _prop_description(model)
    parts = [f"Model '{name}'"]
    layer = _prop_value(model, "dbtLayer", "dbt_layer")
    if layer:
        parts.append(f" [{layer} layer]")
    if description:
        parts.append(f": {description}")
    parts.append(f". Columns: {col_summaries}")
    if pk:
        parts.append(f". Primary key: {pk}")
    data_scope = _prop_value(model, "dataScope", "data_scope")
    if data_scope:
        parts.append(f". Data scope: {data_scope}")
    text = "".join(parts) + "."

    return {
        "text": text,
        "item_type": "model",
        "model_name": name,
        "item_name": name,
        "data_type": None,
        "expression": None,
        "is_calculated": False,
        "mdl_hash": mdl_h,
        "indexed_at": now,
    }


def _column_record(col: dict, model_name: str, mdl_h: str, now: datetime) -> dict:
    name = col["name"]
    dtype = col.get("type", "")
    expr = col.get("expression") or None
    is_calc = col.get("isCalculated", False)
    rel = col.get("relationship") or None

    description = _prop_description(col)
    parts = [f"Column '{name}' ({dtype}) in model '{model_name}'"]
    if description:
        parts.append(f": {description}")
    if is_calc and expr:
        parts.append(f". Calculated: {expr}")
    derived_from = _prop_value(col, "derivedFrom", "derived_from")
    if derived_from:
        parts.append(f". Derived from: {derived_from}")
    if rel:
        parts.append(f". Relationship: {rel}")
    accepted_values = _format_csv_values(
        _prop_value(col, "acceptedValues", "accepted_values")
    )
    if accepted_values:
        parts.append(f". Accepted values: {accepted_values}")
    constraints = _column_constraints(col)
    if constraints:
        parts.append(f". Constraints: {', '.join(constraints)}")
    dbt_tests = _prop_value(col, "dbtTests", "dbt_tests")
    if dbt_tests:
        parts.append(f". dbt tests: {dbt_tests}")
    dbt_test_status = _prop_value(col, "dbtTestStatus", "dbt_test_status")
    if dbt_test_status:
        parts.append(f". Test status: {dbt_test_status}")
    text = "".join(parts) + "."

    return {
        "text": text,
        "item_type": "column",
        "model_name": model_name,
        "item_name": name,
        "data_type": dtype or None,
        "expression": expr,
        "is_calculated": is_calc,
        "mdl_hash": mdl_h,
        "indexed_at": now,
    }


def _relationship_record(rel: dict, mdl_h: str, now: datetime) -> dict:
    name = rel["name"]
    models = rel.get("models", [])
    join_type = rel.get("joinType", "")
    condition = rel.get("condition", "")

    left = models[0] if len(models) > 0 else "?"
    right = models[1] if len(models) > 1 else "?"
    text = (
        f"Relationship '{name}': {left} → {right} ({join_type}). "
        f"Condition: {condition}."
    )

    return {
        "text": text,
        "item_type": "relationship",
        "model_name": left,
        "item_name": name,
        "data_type": None,
        "expression": condition or None,
        "is_calculated": False,
        "mdl_hash": mdl_h,
        "indexed_at": now,
    }


def _view_record(view: dict, mdl_h: str, now: datetime) -> dict:
    name = view["name"]
    stmt = view.get("statement", "")
    truncated = stmt[:200] + ("…" if len(stmt) > 200 else "")

    text = f"View '{name}'. SQL: {truncated}"

    return {
        "text": text,
        "item_type": "view",
        "model_name": "",
        "item_name": name,
        "data_type": None,
        "expression": stmt or None,
        "is_calculated": False,
        "mdl_hash": mdl_h,
        "indexed_at": now,
    }


def _prop_description(obj: dict) -> str:
    """Extract description from the ``properties`` dict, if present."""
    return _prop_value(obj, "description")


def _prop_value(obj: dict, *keys: str) -> str:
    props = obj.get("properties") or {}
    if not isinstance(props, dict):
        return ""
    for key in keys:
        value = props.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def _format_csv_values(value: str) -> str:
    if not value:
        return ""
    return ", ".join(part.strip() for part in value.split(",") if part.strip())


def _column_constraints(col: dict) -> list[str]:
    constraints: list[str] = []
    if col.get("notNull"):
        constraints.append("NOT NULL")
    if col.get("isPrimaryKey"):
        constraints.append("PRIMARY KEY")
    return constraints
