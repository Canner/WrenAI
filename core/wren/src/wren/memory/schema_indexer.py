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

    cubes = manifest.get("cubes", []) or []
    if isinstance(cubes, list):
        for cube in cubes:
            if isinstance(cube, dict):
                _describe_cube(cube, lines)

    return "\n".join(lines)


def _describe_model(model: dict, lines: list[str]) -> None:
    name = model["name"]
    desc = _prop_description(model)
    header = f"### Model: {name}"
    if desc:
        header += f" — {desc}"
    lines.append(header)

    pk = model.get("primaryKey")
    if pk:
        lines.append(f"  Primary key: {pk}")

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

    if col.get("notNull"):
        parts.append(" NOT NULL")

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


def _describe_cube(cube: dict, lines: list[str]) -> None:
    name = cube.get("name", "")
    base = cube.get("baseObject", "?")
    lines.append(f"### Cube: {name} (base: {base})")
    measures = [m for m in (cube.get("measures") or []) if isinstance(m, dict)]
    if measures:
        lines.append("  Measures:")
        for m in measures:
            mname = m.get("name", "")
            expr = m.get("expression", "")
            mtype = m.get("type", "")
            line = f"    - {mname}"
            if mtype:
                line += f" ({mtype})"
            if expr:
                line += f": {expr}"
            lines.append(line)
    dims = [d for d in (cube.get("dimensions") or []) if isinstance(d, dict)]
    if dims:
        lines.append("  Dimensions:")
        for d in dims:
            dname = d.get("name", "")
            expr = d.get("expression", "")
            dtype = d.get("type", "")
            line = f"    - {dname}"
            if dtype:
                line += f" ({dtype})"
            if expr and expr != dname:
                line += f": {expr}"
            lines.append(line)
    tdims = [td for td in (cube.get("timeDimensions") or []) if isinstance(td, dict)]
    if tdims:
        lines.append("  Time dimensions:")
        for td in tdims:
            tname = td.get("name", "")
            expr = td.get("expression", "")
            ttype = td.get("type", "")
            line = f"    - {tname}"
            if ttype:
                line += f" ({ttype})"
            if expr and expr != tname:
                line += f": {expr}"
            lines.append(line)
    hierarchies = cube.get("hierarchies") or {}
    if isinstance(hierarchies, dict) and hierarchies:
        lines.append("  Hierarchies:")
        for hname, levels in hierarchies.items():
            if not isinstance(levels, list):
                continue
            safe = [lv for lv in levels if isinstance(lv, str)]
            if safe:
                lines.append(f"    - {hname}: {' → '.join(safe)}")
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

    cubes = manifest.get("cubes", []) or []
    if isinstance(cubes, list):
        for cube in cubes:
            if not isinstance(cube, dict):
                continue
            items.append(_cube_record(cube, mdl_h, now))
            cube_name = cube.get("name", "")
            for measure in cube.get("measures", []) or []:
                if isinstance(measure, dict):
                    items.append(_measure_record(measure, cube_name, mdl_h, now))
            for dim in cube.get("dimensions", []) or []:
                if isinstance(dim, dict):
                    items.append(_cube_dimension_record(dim, cube_name, mdl_h, now))
            for tdim in cube.get("timeDimensions", []) or []:
                if isinstance(tdim, dict):
                    items.append(_time_dimension_record(tdim, cube_name, mdl_h, now))

    return items


# ── Record builders ───────────────────────────────────────────────────────


def _model_record(model: dict, mdl_h: str, now: datetime) -> dict:
    name = model["name"]
    cols = model.get("columns", [])
    col_summaries = ", ".join(f"{c['name']} ({c.get('type', '?')})" for c in cols[:20])
    pk = model.get("primaryKey") or ""

    description = _prop_description(model)
    parts = [f"Model '{name}'"]
    if description:
        parts.append(f": {description}")
    parts.append(f". Columns: {col_summaries}")
    if pk:
        parts.append(f". Primary key: {pk}")
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
    if rel:
        parts.append(f". Relationship: {rel}")
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


def _cube_record(cube: dict, mdl_h: str, now: datetime) -> dict:
    name = cube.get("name", "")
    base = cube.get("baseObject", "?")
    measures = ", ".join(
        m.get("name", "") for m in (cube.get("measures") or []) if isinstance(m, dict)
    )
    dims = ", ".join(
        d.get("name", "") for d in (cube.get("dimensions") or []) if isinstance(d, dict)
    )
    time_dims = ", ".join(
        td.get("name", "")
        for td in (cube.get("timeDimensions") or [])
        if isinstance(td, dict)
    )

    parts = [f"Cube '{name}' over '{base}'"]
    if measures:
        parts.append(f". Measures: {measures}")
    if dims:
        parts.append(f". Dimensions: {dims}")
    if time_dims:
        parts.append(f". Time dimensions: {time_dims}")
    text = "".join(parts) + "."

    return {
        "text": text,
        "item_type": "cube",
        "model_name": base,
        "item_name": name,
        "data_type": None,
        "expression": None,
        "is_calculated": False,
        "mdl_hash": mdl_h,
        "indexed_at": now,
    }


def _measure_record(measure: dict, cube_name: str, mdl_h: str, now: datetime) -> dict:
    name = measure.get("name", "")
    expr = measure.get("expression") or None
    dtype = measure.get("type") or None
    text = f"Measure '{name}' in cube '{cube_name}'"
    if dtype:
        text += f" ({dtype})"
    if expr:
        text += f". Expression: {expr}"
    text += "."
    return {
        "text": text,
        "item_type": "measure",
        "model_name": cube_name,
        "item_name": name,
        "data_type": dtype,
        "expression": expr,
        "is_calculated": True,
        "mdl_hash": mdl_h,
        "indexed_at": now,
    }


def _cube_dimension_record(
    dim: dict, cube_name: str, mdl_h: str, now: datetime
) -> dict:
    name = dim.get("name", "")
    expr = dim.get("expression") or None
    dtype = dim.get("type") or None
    text = f"Dimension '{name}' in cube '{cube_name}'"
    if dtype:
        text += f" ({dtype})"
    if expr:
        text += f". Expression: {expr}"
    text += "."
    return {
        "text": text,
        "item_type": "cube_dimension",
        "model_name": cube_name,
        "item_name": name,
        "data_type": dtype,
        "expression": expr,
        "is_calculated": False,
        "mdl_hash": mdl_h,
        "indexed_at": now,
    }


def _time_dimension_record(
    tdim: dict, cube_name: str, mdl_h: str, now: datetime
) -> dict:
    name = tdim.get("name", "")
    expr = tdim.get("expression") or None
    dtype = tdim.get("type") or None
    text = f"Time dimension '{name}' in cube '{cube_name}'"
    if dtype:
        text += f" ({dtype})"
    if expr:
        text += f". Expression: {expr}"
    text += "."
    return {
        "text": text,
        "item_type": "time_dimension",
        "model_name": cube_name,
        "item_name": name,
        "data_type": dtype,
        "expression": expr,
        "is_calculated": False,
        "mdl_hash": mdl_h,
        "indexed_at": now,
    }


def _prop_description(obj: dict) -> str:
    """Extract description from the ``properties`` dict, if present."""
    props = obj.get("properties") or {}
    if isinstance(props, dict):
        return props.get("description", "")
    return ""
