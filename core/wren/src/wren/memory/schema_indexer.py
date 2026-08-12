"""Extract indexable records from an MDL manifest dict.

Pure functions — no LanceDB or embedding dependency.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
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


def _as_list(value: object, kind: str, name: str, field: str) -> list:
    """Return ``value`` as a list, raising on any non-list, non-null value.

    Nested collection fields (columns, measures, dimensions, timeDimensions)
    use this helper. Only a missing/null value is treated as an empty list;
    an empty list stays ``[]`` via the ``isinstance`` check below. Any other
    non-list value — truthy (``columns: 42``) or falsy (``columns: {}``,
    ``columns: 0``, ``columns: ""``) — is a structural error in the manifest,
    so we raise ``ValueError`` rather than silently indexing a model with zero
    columns. This matches :func:`_iter_section` for top-level sections and the
    same-file ``_relationship_models`` policy (see #2605, now on ``main``): one
    rule across the module — ``None`` passes, everything non-list raises. Nested
    fields name the offending entity (``model 'orders': 'columns' must be a
    list, got dict``) so the diagnosis points at one row rather than every model
    in the project; top-level sections keep the ``manifest['models']`` form.
    Cubes are not required to have a name, so an empty name falls back to a
    ``cube (unnamed): 'measures'`` form rather than a top-level
    ``manifest['measures']`` form: ``measures`` is never a top-level manifest
    key, so pointing there would send the reader hunting for something that
    does not exist. ``(unnamed)`` keeps the message truthful about where the
    field lives while signalling that the entity could not be identified. The
    CLI already catches ``ValueError`` and exits with ``Malformed manifest:
    {e}``.
    """
    if value is None:
        return []
    if not isinstance(value, list):
        where = (
            f"{kind} {name!r}: {field!r}" if name else f"{kind} (unnamed): {field!r}"
        )
        raise ValueError(f"{where} must be a list, got {type(value).__name__}")
    return value


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


def _iter_section(manifest: dict, key: str) -> list:
    """Return ``manifest[key]`` as a list, raising if it is the wrong type.

    A missing or null section is treated as empty (``[]``). A section whose
    value is present but *not* a list (e.g. a hand-edited manifest that typos
    ``"models"`` into an object) is a structural error in the manifest, not
    per-element junk: silently dropping it would wipe the corresponding index
    and report success. Raising ``ValueError`` surfaces the malformed manifest
    while keeping this module dependency-free; the CLI already catches such
    errors and exits non-zero.
    """
    section = manifest.get(key)
    if section is None:
        return []
    if not isinstance(section, list):
        raise ValueError(
            f"manifest[{key!r}] must be a list, got {type(section).__name__}"
        )
    return section


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

    for model in _iter_section(manifest, "models"):
        if isinstance(model, dict) and model.get("name"):
            _describe_model(model, lines)

    for rel in _iter_section(manifest, "relationships"):
        if isinstance(rel, dict) and rel.get("name"):
            _describe_relationship(rel, lines)

    for view in _iter_section(manifest, "views"):
        if isinstance(view, dict) and view.get("name"):
            _describe_view(view, lines)

    for cube in _iter_section(manifest, "cubes"):
        if isinstance(cube, dict):
            _describe_cube(cube, lines)

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

    cols = _as_list(model.get("columns"), "model", name, "columns")
    described = [c for c in cols if isinstance(c, dict) and c.get("name")]
    if described:
        lines.append("  Columns:")
        for col in described:
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

    accepted_values = _format_values(
        _prop_raw(col, "acceptedValues", "accepted_values")
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


def _relationship_models(rel: dict, name: str) -> list:
    """Return relationship endpoint models; raise on wrong-typed ``models``.

    Missing/null ``models`` is empty. A present non-list is structural error
    (same policy as :func:`_iter_section` for top-level sections).
    """
    models = rel.get("models")
    if models is None:
        return []
    if not isinstance(models, list):
        raise ValueError(
            f"relationship {name!r}: 'models' must be a list, "
            f"got {type(models).__name__}"
        )
    return models


def _describe_relationship(rel: dict, lines: list[str]) -> None:
    name = rel["name"]
    models = _relationship_models(rel, name)
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
    # Type-validate children via _as_list before the unnamed-cube skip below.
    measures = [
        m
        for m in (_as_list(cube.get("measures"), "cube", name, "measures"))
        if isinstance(m, dict) and m.get("name")
    ]
    dims = [
        d
        for d in (_as_list(cube.get("dimensions"), "cube", name, "dimensions"))
        if isinstance(d, dict) and d.get("name")
    ]
    tdims = [
        td
        for td in (_as_list(cube.get("timeDimensions"), "cube", name, "timeDimensions"))
        if isinstance(td, dict) and td.get("name")
    ]
    if not name:
        return
    lines.append(f"### Cube: {name} (base: {base})")
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

    for model in _iter_section(manifest, "models"):
        if not isinstance(model, dict) or not model.get("name"):
            continue
        items.append(_model_record(model, mdl_h, now))
        for col in _as_list(model.get("columns"), "model", model["name"], "columns"):
            if not isinstance(col, dict) or not col.get("name"):
                continue
            items.append(_column_record(col, model["name"], mdl_h, now))

    for rel in _iter_section(manifest, "relationships"):
        if isinstance(rel, dict) and rel.get("name"):
            items.append(_relationship_record(rel, mdl_h, now))

    for view in _iter_section(manifest, "views"):
        if isinstance(view, dict) and view.get("name"):
            items.append(_view_record(view, mdl_h, now))

    for cube in _iter_section(manifest, "cubes"):
        if not isinstance(cube, dict):
            continue
        cube_name = cube.get("name", "")
        # Type-validate children via _as_list before the unnamed-cube skip below.
        measures = _as_list(cube.get("measures"), "cube", cube_name, "measures")
        dims = _as_list(cube.get("dimensions"), "cube", cube_name, "dimensions")
        tdims = _as_list(
            cube.get("timeDimensions"), "cube", cube_name, "timeDimensions"
        )
        if not cube_name:
            continue
        items.append(_cube_record(cube, mdl_h, now))
        for measure in measures:
            if isinstance(measure, dict) and measure.get("name"):
                items.append(_measure_record(measure, cube_name, mdl_h, now))
        for dim in dims:
            if isinstance(dim, dict) and dim.get("name"):
                items.append(_cube_dimension_record(dim, cube_name, mdl_h, now))
        for tdim in tdims:
            if isinstance(tdim, dict) and tdim.get("name"):
                items.append(_time_dimension_record(tdim, cube_name, mdl_h, now))

    return items


# ── Record builders ───────────────────────────────────────────────────────


def _model_record(model: dict, mdl_h: str, now: datetime) -> dict:
    name = model["name"]
    cols = [
        c
        for c in (_as_list(model.get("columns"), "model", name, "columns"))
        if isinstance(c, dict) and c.get("name")
    ]
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
    accepted_values = _format_values(
        _prop_raw(col, "acceptedValues", "accepted_values")
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
    models = _relationship_models(rel, name)
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
        m.get("name", "")
        for m in (_as_list(cube.get("measures"), "cube", name, "measures"))
        if isinstance(m, dict)
    )
    dims = ", ".join(
        d.get("name", "")
        for d in (_as_list(cube.get("dimensions"), "cube", name, "dimensions"))
        if isinstance(d, dict)
    )
    time_dims = ", ".join(
        td.get("name", "")
        for td in (_as_list(cube.get("timeDimensions"), "cube", name, "timeDimensions"))
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


def _prop_raw(obj: dict, *keys: str):
    props = obj.get("properties") or {}
    if not isinstance(props, dict):
        return None
    for key in keys:
        if key in props:
            return props[key]
    return None


def _format_values(value) -> str:
    if not value:
        return ""
    if isinstance(value, str):
        return ", ".join(part.strip() for part in value.split(",") if part.strip())
    if isinstance(value, Sequence) and not isinstance(value, bytes):
        return ", ".join(str(part).strip() for part in value if str(part).strip())
    return str(value).strip()


def _column_constraints(col: dict) -> list[str]:
    constraints: list[str] = []
    if col.get("notNull"):
        constraints.append("NOT NULL")
    if col.get("isPrimaryKey"):
        constraints.append("PRIMARY KEY")
    return constraints
