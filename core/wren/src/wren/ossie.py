"""Convert Apache Ossie semantic models to Wren MDL, and back.

Apache Ossie (incubating; formerly Open Semantic Interchange, OSI) is a
vendor-agnostic semantic model spec (https://github.com/apache/ossie). This
module reads an Ossie YAML (or JSON) file and produces a Wren MDL manifest
dict, suitable for ``wren context build`` to write as ``target/mdl.json``;
the export half at the bottom of the file goes the other way.

Two document layouts are accepted on import:

* ``0.1.1`` (the released spec): ``semantic_model: [...]`` wrapper, no
  ``datatype`` on fields.
* ``0.2.0.dev0`` (the current draft): ``name`` / ``datasets`` /
  ``relationships`` / ``metrics`` at the document root, one model per
  document, ``datatype`` enum on fields and metrics.

The Ossie file itself is the single source of truth — we never copy it into a
parallel wren project. Wren-specific build hints (column types, dialect
preference, metrics handling) live inside the Ossie file via the spec's
``custom_extensions: [{vendor_name: WREN, data: '<json>'}]`` mechanism, which
is Ossie's only sanctioned vendor escape hatch.

Resolution order for any setting (highest first):
  1. CLI flag / explicit kwarg
  2. ``custom_extensions[vendor_name=WREN]`` on the chosen semantic_model
  3. ``custom_extensions[vendor_name=WREN]`` at the Ossie document root
  4. ``custom_extensions[vendor_name=WREN]`` on the dataset / field
     (column-level overrides only — these aren't merged with the global config)
  5. Built-in defaults
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from wren.context import ValidationError, _convert_keys

# ── Constants ──────────────────────────────────────────────────────────────

WREN_VENDOR_NAME = "WREN"
SPEC_VERSION_RELEASED = "0.1.1"
SPEC_VERSION_DRAFT = "0.2.0.dev0"
SUPPORTED_SPEC_VERSIONS = (SPEC_VERSION_RELEASED, SPEC_VERSION_DRAFT)
DEFAULT_DIALECT = "ANSI_SQL"

# Ossie ``datatype`` enum (0.2.0.dev0) → Wren column type, used when a field
# carries no WREN type override. ``Opaque`` deliberately maps to nothing: the
# spec says it marks a type outside the portable vocabulary, so the WREN
# block has to say what it is.
_OSSIE_DATATYPE_TO_WREN_TYPE = {
    "String": "VARCHAR",
    "Integer": "BIGINT",
    "Decimal": "DECIMAL",
    "Float": "DOUBLE",
    "Boolean": "BOOLEAN",
    "Date": "DATE",
    "Time": "TIME",
    "DateTime": "TIMESTAMP",
    "DateTimeTz": "TIMESTAMP WITH TIME ZONE",
}
DEFAULT_METRICS_MODE = "note"
VALID_METRICS_MODES = frozenset({"skip", "note"})

# Wren data_source → Ossie dialect identifier (used when the user hasn't set
# `dialect` in the WREN block). Anything not listed here falls back to
# ANSI_SQL, which the Ossie spec mandates as the universal baseline.
_DATA_SOURCE_TO_DIALECT = {
    "snowflake": "SNOWFLAKE",
    "databricks": "DATABRICKS",
}


# ── Public types ───────────────────────────────────────────────────────────


@dataclass
class WrenConfig:
    """Merged WREN extension config (root + semantic_model + CLI overrides).

    Per-dataset / per-field overrides are NOT stored here — they are read
    directly from the dataset's / field's own ``custom_extensions`` block at
    conversion time. This keeps the shallow-merge model simple: nested
    structures like ``column_types`` would otherwise clobber each other.
    """

    dialect: str = DEFAULT_DIALECT
    metrics_mode: str = DEFAULT_METRICS_MODE
    default_semantic_model: str | None = None
    # column_types is the semantic-model-level fallback:
    #   {dataset_name: {field_name: type}}
    # Per-dataset overrides live in the dataset's own WREN block as
    #   {column_types: {field_name: type}}  (no dataset_name wrap)
    column_types: dict[str, dict[str, str]] = field(default_factory=dict)
    # primary_key picks for composite-PK datasets:
    #   {dataset_name: column_name}
    primary_key_pick: dict[str, str] = field(default_factory=dict)


# ── Parsing ────────────────────────────────────────────────────────────────


def parse_ossie(text: str, *, suffix: str = ".yaml") -> dict:
    """Parse Ossie text. JSON if suffix is .json, else YAML."""
    if suffix.lower() == ".json":
        return json.loads(text)
    parsed = yaml.safe_load(text)
    return parsed if isinstance(parsed, dict) else {}


def load_ossie_file(path: Path) -> dict:
    return parse_ossie(path.read_text(encoding="utf-8"), suffix=path.suffix)


def _extract_wren_block(custom_extensions: Any) -> dict:
    """Return the parsed `data` from the (last) vendor_name=WREN entry.

    `data` per spec is a JSON string. We also tolerate a raw dict for
    robustness against authors who hand-write the YAML and forget the quoting.
    """
    if not isinstance(custom_extensions, list):
        return {}
    found: dict = {}
    for entry in custom_extensions:
        if not isinstance(entry, dict):
            continue
        if entry.get("vendor_name") != WREN_VENDOR_NAME:
            continue
        data = entry.get("data")
        if isinstance(data, str):
            try:
                parsed = json.loads(data)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                found = parsed
        elif isinstance(data, dict):
            found = data
    return found


def select_semantic_model(
    osi: dict, name: str | None = None
) -> tuple[dict, list[ValidationError]]:
    """Pick one semantic_model from the Ossie document.

    Resolution:
      - Explicit ``name`` wins.
      - Otherwise, root-level WREN.default_semantic_model.
      - Otherwise, the only semantic_model present.
      - More than one and nothing pinned: error with snippet.
    """
    errors: list[ValidationError] = []
    models = osi.get("semantic_model")
    if models is None and isinstance(osi.get("datasets"), list):
        # 0.2.0.dev0 layout: the document *is* the one semantic model.
        if name and osi.get("name") != name:
            errors.append(
                ValidationError(
                    "error",
                    "<ossie>",
                    f"semantic model '{name}' not found; this document "
                    f"defines only '{osi.get('name')}'",
                )
            )
            return ({}, errors)
        return (osi, errors)
    models = models or []
    if not isinstance(models, list) or not models:
        errors.append(
            ValidationError(
                "error",
                "<ossie>",
                "Ossie file has no semantic_model entries and no root-level datasets",
            )
        )
        return ({}, errors)

    if name:
        for sm in models:
            if isinstance(sm, dict) and sm.get("name") == name:
                return (sm, errors)
        names = [sm.get("name", "?") for sm in models if isinstance(sm, dict)]
        errors.append(
            ValidationError(
                "error",
                "<ossie>",
                f"--semantic-model {name!r} not found. Available: {', '.join(names)}",
            )
        )
        return ({}, errors)

    if len(models) == 1:
        sm = models[0]
        return (sm if isinstance(sm, dict) else {}, errors)

    # Fall back to root-level WREN.default_semantic_model
    root_cfg = _extract_wren_block(osi.get("custom_extensions"))
    default = root_cfg.get("default_semantic_model")
    if isinstance(default, str):
        for sm in models:
            if isinstance(sm, dict) and sm.get("name") == default:
                return (sm, errors)

    names = [sm.get("name", "?") for sm in models if isinstance(sm, dict)]
    snippet = (
        "    custom_extensions:\n"
        "      - vendor_name: WREN\n"
        '        data: \'{"default_semantic_model": "<name>"}\''
    )
    errors.append(
        ValidationError(
            "error",
            "<ossie>",
            f"Ossie file has {len(models)} semantic_models: {', '.join(names)}.\n"
            f"  Pass --semantic-model <name> or add at the Ossie document root:\n\n"
            f"{snippet}",
        )
    )
    return ({}, errors)


# ── Config extraction ──────────────────────────────────────────────────────


def extract_wren_config(
    osi: dict, sm: dict, cli_overrides: dict | None = None
) -> tuple[WrenConfig, list[ValidationError]]:
    """Merge WREN custom_extensions from root + semantic_model + CLI overrides.

    Shallow merge: a scalar key in the SM block replaces the same key from
    root. `column_types` and `primary_key` (when dict-shaped at SM level) are
    also overwritten as whole blocks — author them at one level only.
    """
    root = _extract_wren_block(osi.get("custom_extensions"))
    sm_local = _extract_wren_block(sm.get("custom_extensions"))
    overrides = cli_overrides or {}
    merged: dict = {**root, **sm_local, **overrides}
    errors: list[ValidationError] = []

    metrics_mode = merged.get("metrics", DEFAULT_METRICS_MODE)
    if metrics_mode not in VALID_METRICS_MODES:
        errors.append(
            ValidationError(
                "warning",
                "<ossie:WREN>",
                f"metrics: {metrics_mode!r} is not one of "
                f"{sorted(VALID_METRICS_MODES)} — using default 'note'",
            )
        )
        metrics_mode = DEFAULT_METRICS_MODE

    column_types_raw = merged.get("column_types") or {}
    # Sanity: must be {str: {str: str}} at this level.
    column_types: dict[str, dict[str, str]] = {}
    if isinstance(column_types_raw, dict):
        for ds_name, mapping in column_types_raw.items():
            if isinstance(mapping, dict):
                column_types[ds_name] = {str(k): str(v) for k, v in mapping.items()}

    primary_key_raw = merged.get("primary_key")
    primary_key_pick: dict[str, str] = {}
    if isinstance(primary_key_raw, dict):
        primary_key_pick = {str(k): str(v) for k, v in primary_key_raw.items()}

    cfg = WrenConfig(
        dialect=str(merged.get("dialect") or DEFAULT_DIALECT),
        metrics_mode=metrics_mode,
        default_semantic_model=merged.get("default_semantic_model"),
        column_types=column_types,
        primary_key_pick=primary_key_pick,
    )
    return cfg, errors


# ── Conversion helpers ─────────────────────────────────────────────────────


_SQL_KEYWORDS_HINTING_QUERY = re.compile(
    r"\b(SELECT|FROM|WHERE|JOIN|GROUP\s+BY)\b", re.IGNORECASE
)
_DATASET_REF_PATTERN = re.compile(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\.[a-zA-Z_]")


def _parse_source(source: Any) -> tuple[dict | None, str | None]:
    """Parse Ossie ``dataset.source`` into either table_reference or ref_sql.

    Returns (table_reference_dict, ref_sql_string). At most one is non-None.
    Returns (None, None) if the source is missing or unparseable.
    """
    if not isinstance(source, str) or not source.strip():
        return (None, None)
    src = source.strip()
    if _SQL_KEYWORDS_HINTING_QUERY.search(src) or "\n" in src:
        return (None, src)

    parts = src.split(".")
    if len(parts) == 3:
        return (
            {"catalog": parts[0], "schema": parts[1], "table": parts[2]},
            None,
        )
    if len(parts) == 2:
        return ({"catalog": "", "schema": parts[0], "table": parts[1]}, None)
    if len(parts) == 1:
        return ({"catalog": "", "schema": "", "table": parts[0]}, None)
    # 4+ dotted parts — treat as ref_sql to avoid silent loss of structure.
    return (None, src)


def _pick_expression(expr_field: Any, dialect_preference: str) -> str:
    """Extract a SQL expression from Ossie's expression block.

    Order: preferred dialect → ANSI_SQL fallback → first available.
    Ossie also permits a bare string for the expression (shorthand) — we honor
    that too.
    """
    if isinstance(expr_field, str):
        return expr_field
    if not isinstance(expr_field, dict):
        return ""
    dialects = expr_field.get("dialects")
    if not isinstance(dialects, list) or not dialects:
        return ""
    by_dialect: dict[str, str] = {}
    for d in dialects:
        if isinstance(d, dict):
            key = d.get("dialect")
            val = d.get("expression", "")
            if isinstance(key, str):
                by_dialect[key] = val if isinstance(val, str) else ""
    # Resolve in priority order, but skip empty expressions so a present-but-
    # blank preferred (or ANSI_SQL) entry does not shadow a real expression
    # further down the list. An empty string carries no SQL, so treating it as
    # "found" would emit an empty/identity column for a genuinely calculated
    # field.
    if by_dialect.get(dialect_preference):
        return by_dialect[dialect_preference]
    if by_dialect.get("ANSI_SQL"):
        return by_dialect["ANSI_SQL"]
    for d in dialects:
        if isinstance(d, dict):
            val = d.get("expression", "")
            if isinstance(val, str) and val:
                return val
    return ""


def _is_calculated_expression(expr: str, field_name: str) -> bool:
    """True when the expression is anything other than the column's own name.

    Bare aliases (``Amount`` for field ``amount``, or ``src_col`` for field
    ``renamed``) are 'calculated' from wren's perspective — the source column
    name differs from the field name, so the engine must carry an expression
    instead of resolving by identity. Only an exact-match identity is treated
    as non-calculated.
    """
    if not expr:
        return False
    return expr.strip() != field_name


def _infer_type(field_obj: dict, override: str | None) -> str:
    """WREN override > Ossie ``datatype`` > ``is_time`` hint > VARCHAR."""
    if override:
        return override
    if mapped := _OSSIE_DATATYPE_TO_WREN_TYPE.get(field_obj.get("datatype")):
        return mapped
    dim = field_obj.get("dimension")
    if isinstance(dim, dict) and dim.get("is_time"):
        return "TIMESTAMP"
    return "VARCHAR"


def _join_description(*parts: str | None) -> str | None:
    chunks = [p for p in parts if p]
    return "\n\n".join(chunks) if chunks else None


def _ossie_description(obj: dict) -> str | None:
    """Render Ossie description + ai_context into one description string."""
    parts: list[str] = []
    if d := obj.get("description"):
        if isinstance(d, str):
            parts.append(d)
    ai = obj.get("ai_context")
    if isinstance(ai, str):
        parts.append(ai)
    elif isinstance(ai, dict):
        instr = ai.get("instructions")
        if isinstance(instr, str):
            parts.append(instr)
        syn = ai.get("synonyms")
        if isinstance(syn, list) and syn:
            parts.append("Synonyms: " + ", ".join(str(s) for s in syn))
    return "\n\n".join(parts) if parts else None


# ── Field / dataset / relationship / metric converters ────────────────────


def _convert_field(
    field_obj: dict,
    *,
    dialect: str,
    type_override: str | None,
    primary_key_names: set[str],
    not_null: bool = False,
) -> dict:
    name = field_obj["name"]
    expr = _pick_expression(field_obj.get("expression"), dialect)
    is_calc = _is_calculated_expression(expr, name)
    col_type = _infer_type(field_obj, type_override)

    column: dict = {
        "name": name,
        "type": col_type,
        "is_calculated": is_calc,
        "not_null": not_null,
        "properties": {},
    }
    if is_calc:
        column["expression"] = expr
    if name in primary_key_names:
        column["is_primary_key"] = True
        column["not_null"] = True
    if desc := _ossie_description(field_obj):
        column["properties"]["description"] = desc
    return column


def _format_column_types_snippet(dataset_name: str, field_names: list[str]) -> str:
    """Produce a copy-pasteable column_types snippet for one dataset."""
    pairs = ",\n              ".join(f'"{fn}": "VARCHAR"' for fn in field_names)
    return (
        f"  Add to dataset '{dataset_name}' in the Ossie file:\n\n"
        "    custom_extensions:\n"
        "      - vendor_name: WREN\n"
        "        data: |\n"
        "          {\n"
        '            "column_types": {\n'
        f"              {pairs}\n"
        "            }\n"
        "          }"
    )


def _format_fields_snippet(
    dataset_name: str, field_names: list[str], dialect: str
) -> str:
    """Produce a copy-pasteable ``fields`` snippet declaring the named columns."""
    entries = "\n".join(
        f"      - name: {fn}\n"
        "        expression:\n"
        "          dialects:\n"
        f"            - dialect: {dialect}\n"
        f"              expression: {fn}"
        for fn in field_names
    )
    return (
        f"  Add to dataset '{dataset_name}' in the Ossie file:\n\n"
        "    fields:\n"
        f"{entries}"
    )


def _expression_column_refs(expression: str, dialect: str) -> set[str] | None:
    """Bare column names a field expression reads, or None when unparseable.

    Qualified references (``orders.amount``) and columns inside a nested query
    are skipped: they resolve through a relationship or the subquery's own FROM
    clause, not through the dataset's declared fields.
    """
    import sqlglot  # noqa: PLC0415
    from sqlglot import exp  # noqa: PLC0415
    from sqlglot.dialects.dialect import Dialect  # noqa: PLC0415

    read = dialect.lower() if Dialect.get(dialect.lower()) else None
    try:
        tree = sqlglot.parse_one(expression, read=read)
    except sqlglot.errors.SqlglotError:
        return None
    return {
        node.name
        for node in tree.find_all(exp.Column)
        if not node.table and node.find_ancestor(exp.Query, exp.Subquery) is None
    }


def _convert_dataset(
    ds: dict, *, wren_cfg: WrenConfig
) -> tuple[dict, list[ValidationError]]:
    errors: list[ValidationError] = []
    name = ds.get("name")
    if not isinstance(name, str) or not name:
        errors.append(
            ValidationError("error", "<ossie:dataset>", "dataset missing 'name'")
        )
        return ({}, errors)

    src_raw = ds.get("source")
    table_ref, ref_sql = _parse_source(src_raw)
    if not table_ref and not ref_sql:
        errors.append(
            ValidationError(
                "error",
                f"dataset '{name}'",
                f"could not parse source: {src_raw!r} "
                "— expected 'catalog.schema.table' or inline SQL",
            )
        )
        return ({}, errors)

    # Per-dataset WREN block overrides everything for this dataset's fields.
    ds_wren = _extract_wren_block(ds.get("custom_extensions"))
    ds_column_types_local: dict[str, str] = {}
    if isinstance(ds_wren.get("column_types"), dict):
        ds_column_types_local = {
            str(k): str(v) for k, v in ds_wren["column_types"].items()
        }
    ds_pk_override = ds_wren.get("primary_key")

    # Primary key — Ossie allows a single string or a composite array; wren MDL
    # supports both (a string for single, an array for composite).
    pk_raw = ds.get("primary_key")
    pk_names: list[str] = []
    if isinstance(pk_raw, list):
        candidates = [str(c) for c in pk_raw if c]
        # Explicit-narrowing escape hatch: a WREN override / primary_key_pick may
        # select a single column out of a composite key.
        pick: str | None = None
        if isinstance(ds_pk_override, str) and ds_pk_override in candidates:
            pick = ds_pk_override
        elif name in wren_cfg.primary_key_pick:
            want = wren_cfg.primary_key_pick[name]
            if want in candidates:
                pick = want
        pk_names = [pick] if pick else candidates
    elif isinstance(pk_raw, str) and pk_raw:
        pk_names = [pk_raw]

    # Convert fields
    columns: list[dict] = []
    untyped: list[str] = []
    sm_column_types = wren_cfg.column_types.get(name) or {}
    for f in ds.get("fields") or []:
        if not isinstance(f, dict):
            continue
        fname = f.get("name")
        if not isinstance(fname, str) or not fname:
            continue
        field_wren = _extract_wren_block(f.get("custom_extensions"))
        # Order: field WREN type > dataset WREN.column_types > SM WREN.column_types
        type_override = (
            field_wren.get("type")
            or ds_column_types_local.get(fname)
            or sm_column_types.get(fname)
        )
        col = _convert_field(
            f,
            dialect=wren_cfg.dialect,
            type_override=type_override,
            primary_key_names=set(pk_names),
            not_null=field_wren.get("not_null") is True,
        )
        columns.append(col)
        if type_override is None and f.get("datatype") not in (
            _OSSIE_DATATYPE_TO_WREN_TYPE
        ):
            dim = f.get("dimension")
            if not (isinstance(dim, dict) and dim.get("is_time")):
                untyped.append(fname)

    if untyped:
        errors.append(
            ValidationError(
                "warning",
                f"dataset '{name}'",
                f"{len(untyped)} field(s) have no type — defaulted to VARCHAR.\n"
                + _format_column_types_snippet(name, untyped),
            )
        )

    declared = {c["name"] for c in columns}

    # `wren context validate` rejects a primary_key that names a column the
    # model doesn't have, so report it here rather than after the migration.
    missing_pk = [pk for pk in pk_names if pk not in declared]
    if missing_pk:
        errors.append(
            ValidationError(
                "error",
                f"dataset '{name}'",
                "primary_key references undeclared field(s): "
                f"{', '.join(missing_pk)} — every primary key column must also "
                "be declared as a field.\n"
                + _format_fields_snippet(name, missing_pk, wren_cfg.dialect),
            )
        )

    # The engine resolves a calculated column's expression against the model's
    # own columns, not the source table, so a bare reference to a column that
    # is not a declared field fails every query on the model.
    undeclared_refs: dict[str, list[str]] = {}
    for col in columns:
        if not col["is_calculated"]:
            continue
        refs = _expression_column_refs(col["expression"], wren_cfg.dialect)
        for ref in sorted((refs or set()) - declared):
            undeclared_refs.setdefault(ref, []).append(col["name"])
    if undeclared_refs:
        detail = "; ".join(
            f"'{ref}' (used by {', '.join(fields)})"
            for ref, fields in undeclared_refs.items()
        )
        errors.append(
            ValidationError(
                "warning",
                f"dataset '{name}'",
                "calculated field(s) reference undeclared field(s): "
                f"{detail} — the engine resolves calculated expressions against "
                "the dataset's declared fields, so queries on this model will "
                "fail until they are declared.\n"
                + _format_fields_snippet(name, list(undeclared_refs), wren_cfg.dialect),
            )
        )

    model: dict = {
        "name": name,
        "columns": columns,
        "cached": False,
        "properties": {},
    }
    if table_ref:
        model["table_reference"] = table_ref
    else:
        model["ref_sql"] = ref_sql
    if pk_names:
        model["primary_key"] = pk_names[0] if len(pk_names) == 1 else pk_names
    if desc := _ossie_description(ds):
        model["properties"]["description"] = desc

    return (model, errors)


def _convert_relationship(rel: dict) -> tuple[dict, list[ValidationError]]:
    errors: list[ValidationError] = []
    name = rel.get("name") if isinstance(rel.get("name"), str) else "<unnamed>"
    src = rel.get("from")
    dst = rel.get("to")
    from_cols = rel.get("from_columns") or []
    to_cols = rel.get("to_columns") or []

    if not isinstance(src, str) or not isinstance(dst, str):
        errors.append(
            ValidationError(
                "error",
                f"relationship '{name}'",
                "missing 'from' or 'to'",
            )
        )
        return ({}, errors)
    if not isinstance(from_cols, list) or not isinstance(to_cols, list):
        errors.append(
            ValidationError(
                "error",
                f"relationship '{name}'",
                "from_columns / to_columns must be lists",
            )
        )
        return ({}, errors)
    if not all(isinstance(c, str) and c for c in from_cols) or not all(
        isinstance(c, str) and c for c in to_cols
    ):
        errors.append(
            ValidationError(
                "error",
                f"relationship '{name}'",
                "from_columns / to_columns entries must be non-empty strings",
            )
        )
        return ({}, errors)
    if len(from_cols) != len(to_cols):
        errors.append(
            ValidationError(
                "error",
                f"relationship '{name}'",
                f"from_columns and to_columns length mismatch "
                f"({len(from_cols)} vs {len(to_cols)})",
            )
        )
        return ({}, errors)
    if not from_cols:
        errors.append(
            ValidationError(
                "error",
                f"relationship '{name}'",
                "no join columns",
            )
        )
        return ({}, errors)

    parts = [f"{src}.{fc} = {dst}.{tc}" for fc, tc in zip(from_cols, to_cols)]
    condition = " AND ".join(parts)

    rel_dict: dict = {
        "name": name,
        "models": [src, dst],
        "join_type": "MANY_TO_ONE",
        "condition": condition,
        "properties": {},
    }
    if desc := _ossie_description(rel):
        rel_dict["properties"]["description"] = desc
    return (rel_dict, errors)


def _metric_referenced_datasets(expression: str, dataset_names: set[str]) -> set[str]:
    if not expression:
        return set()
    refs = {m.group(1) for m in _DATASET_REF_PATTERN.finditer(expression)}
    return refs & dataset_names


def _process_metrics(
    metrics: list[dict],
    *,
    wren_cfg: WrenConfig,
    dataset_names: set[str],
) -> tuple[str | None, list[ValidationError]]:
    """Render Ossie top-level metrics as a markdown block of business rules.

    Surfaced via the manifest's ``_instructions`` carrier, which the importer
    writes to ``knowledge/rules/`` (or indexes as rules on build).

    Wren has no first-class equivalent of Ossie's free-floating metrics
    (cubes are bound to a single base_object). For v1 we surface them as
    LLM-readable notes; cross-dataset metrics get a warning.
    """
    errors: list[ValidationError] = []
    if wren_cfg.metrics_mode == "skip" or not metrics:
        return (None, errors)

    lines = ["## Metrics (from Ossie)", ""]
    appended = 0
    for m in metrics:
        if not isinstance(m, dict):
            continue
        mname = m.get("name") or "<unnamed>"
        if not isinstance(mname, str):
            mname = str(mname)
        expr = _pick_expression(m.get("expression"), wren_cfg.dialect)
        desc = m.get("description") if isinstance(m.get("description"), str) else ""
        refs = _metric_referenced_datasets(expr, dataset_names)
        if len(refs) >= 2:
            errors.append(
                ValidationError(
                    "warning",
                    f"metric '{mname}'",
                    f"expression references {len(refs)} datasets "
                    f"({', '.join(sorted(refs))}) — emitted as instruction "
                    f"note only. Wren cubes are bound to a single base_object.",
                )
            )
        line = f"- **{mname}** — `{expr}`" if expr else f"- **{mname}**"
        if desc:
            line += f"\n  {desc}"
        lines.append(line)
        appended += 1
    if appended == 0:
        return (None, errors)
    return ("\n".join(lines), errors)


def _semantic_model_instructions(sm: dict) -> str | None:
    ai = sm.get("ai_context")
    if isinstance(ai, str):
        return ai
    if isinstance(ai, dict):
        instr = ai.get("instructions")
        return instr if isinstance(instr, str) else None
    return None


# ── Top-level build ───────────────────────────────────────────────────────


def build_manifest_from_ossie(
    ossie_path: Path,
    *,
    data_source: str,
    catalog: str = "wren",
    schema: str = "public",
    semantic_model: str | None = None,
    dialect_override: str | None = None,
    metrics_override: str | None = None,
) -> tuple[dict, list[ValidationError]]:
    """Build a Wren MDL manifest dict (snake_case) from an Ossie file.

    Returns (manifest, errors). The manifest mirrors the shape of
    ``context.build_manifest``; pass through :func:`build_json_from_ossie` to
    get camelCase JSON for the engine.
    """
    errors: list[ValidationError] = []
    try:
        osi = load_ossie_file(ossie_path)
    except (OSError, yaml.YAMLError, json.JSONDecodeError) as exc:
        errors.append(
            ValidationError(
                "error",
                str(ossie_path),
                f"failed to read Ossie file: {exc}",
            )
        )
        return ({}, errors)

    sm, sm_errors = select_semantic_model(osi, semantic_model)
    errors.extend(sm_errors)
    if not sm:
        return ({}, errors)

    cli_overrides: dict = {}
    if dialect_override:
        cli_overrides["dialect"] = dialect_override
    if metrics_override:
        cli_overrides["metrics"] = metrics_override

    wren_cfg, cfg_errors = extract_wren_config(osi, sm, cli_overrides)
    errors.extend(cfg_errors)

    # If user didn't pin a dialect anywhere, see if data_source implies one.
    user_set_dialect = (
        bool(dialect_override)
        or "dialect" in _extract_wren_block(osi.get("custom_extensions"))
        or "dialect" in _extract_wren_block(sm.get("custom_extensions"))
    )
    if not user_set_dialect and (
        inferred := _DATA_SOURCE_TO_DIALECT.get(data_source.lower())
    ):
        wren_cfg.dialect = inferred

    models: list[dict] = []
    for ds in sm.get("datasets") or []:
        if not isinstance(ds, dict):
            continue
        model, ds_errors = _convert_dataset(ds, wren_cfg=wren_cfg)
        errors.extend(ds_errors)
        if model:
            models.append(model)

    relationships: list[dict] = []
    for r in sm.get("relationships") or []:
        if not isinstance(r, dict):
            continue
        rel, r_errors = _convert_relationship(r)
        errors.extend(r_errors)
        if rel:
            relationships.append(rel)

    dataset_names = {m["name"] for m in models}
    metric_notes, m_errors = _process_metrics(
        sm.get("metrics") or [],
        wren_cfg=wren_cfg,
        dataset_names=dataset_names,
    )
    errors.extend(m_errors)

    instructions = _join_description(
        _semantic_model_instructions(sm),
        metric_notes,
    )

    manifest: dict = {
        "catalog": catalog,
        "schema": schema,
        "data_source": data_source,
        "models": models,
        "relationships": relationships,
        "views": [],
        "cubes": [],
    }
    # Carry the Ossie semantic_model name through so downstream consumers
    # (notably context.convert_mdl_to_project for `init --from-ossie`) can
    # stamp it into wren_project.yml. The wren engine ignores extra
    # top-level fields, so the build-path output is unaffected.
    sm_name = sm.get("name")
    if isinstance(sm_name, str) and sm_name:
        manifest["name"] = sm_name
    if instructions:
        manifest["_instructions"] = instructions
    return (manifest, errors)


def _layout_version_for(models: list[dict]) -> int:
    """Engine layoutVersion a manifest needs: 3 with a composite primary_key
    (schema_version >= 4 on the project side), else 2."""
    if any(isinstance(m.get("primary_key"), list) for m in models):
        return 3
    return 2


def build_json_from_ossie(
    ossie_path: Path,
    *,
    data_source: str,
    catalog: str = "wren",
    schema: str = "public",
    semantic_model: str | None = None,
    dialect_override: str | None = None,
    metrics_override: str | None = None,
) -> tuple[dict, list[ValidationError]]:
    """Like :func:`build_manifest_from_ossie` but returns the camelCase JSON
    dict the engine consumes. Stamps the layoutVersion the manifest needs:
    2 (table_reference as struct, which is what we emit), or 3 once any model
    carries a composite primary_key list, which older layouts cannot encode."""
    manifest, errors = build_manifest_from_ossie(
        ossie_path,
        data_source=data_source,
        catalog=catalog,
        schema=schema,
        semantic_model=semantic_model,
        dialect_override=dialect_override,
        metrics_override=metrics_override,
    )
    if not manifest:
        return ({}, errors)
    # `_instructions` is consumed by downstream tooling under that exact name
    # (see context.convert_mdl_to_project, memory.schema_indexer); pull it out
    # so the snake→camel pass doesn't mangle it into `Instructions`.
    instructions = manifest.pop("_instructions", None)
    layout_version = _layout_version_for(manifest["models"])
    manifest_json = _convert_keys(manifest)
    manifest_json["layoutVersion"] = layout_version
    if instructions:
        manifest_json["_instructions"] = instructions
    return (manifest_json, errors)


def lint_ossie_file(
    ossie_path: Path,
    *,
    data_source: str | None,
    semantic_model: str | None = None,
) -> list[ValidationError]:
    """Run the Ossie→MDL conversion solely to collect errors / warnings.

    Used by ``wren context validate --from-ossie``. Hard errors include the
    missing-file / missing-data_source preconditions; everything else flows
    out of :func:`build_manifest_from_ossie`.
    """
    if not ossie_path.exists():
        return [ValidationError("error", str(ossie_path), "Ossie file not found")]
    if not data_source:
        return [
            ValidationError(
                "error",
                "<cli>",
                "--data-source is required for --from-ossie "
                "(e.g. postgres, snowflake, ...)",
            )
        ]
    _, errors = build_manifest_from_ossie(
        ossie_path,
        data_source=data_source,
        semantic_model=semantic_model,
    )
    return errors


# ═══════════════════════════════════════════════════════════════════════════
# MDL → Ossie (export)
# ═══════════════════════════════════════════════════════════════════════════
#
# The inverse of the importer above. Emits either supported document layout
# (``0.1.1`` wrapper by default, ``0.2.0.dev0`` root-level on request); both
# are what ``build_manifest_from_ossie`` reads back, so ``export ossie`` →
# ``build --from-ossie`` reproduces the same models, columns, types and
# relationships.
#
# Wren-only facts the Ossie spec cannot carry (column types, not_null) go into
# ``custom_extensions[vendor_name=WREN]`` exactly where the importer looks for
# them. Facts that have no Ossie home at all (views, cube dimensions, access
# controls) are dropped with a warning rather than silently lost.

OSSIE_EXPORT_VERSION = SPEC_VERSION_RELEASED

# Wren column type → Ossie ``datatype`` enum. Matching is on the base type name
# (``DECIMAL(18,2)`` → ``DECIMAL``), case-insensitive. Unknown types emit no
# ``datatype`` — the spec says to omit it rather than guess.
_WREN_TYPE_TO_OSSIE_DATATYPE: dict[str, str] = {
    "VARCHAR": "String",
    "CHAR": "String",
    "TEXT": "String",
    "STRING": "String",
    "INTEGER": "Integer",
    "INT": "Integer",
    "BIGINT": "Integer",
    "SMALLINT": "Integer",
    "TINYINT": "Integer",
    "INT2": "Integer",
    "INT4": "Integer",
    "INT8": "Integer",
    "DECIMAL": "Decimal",
    "NUMERIC": "Decimal",
    "FLOAT": "Float",
    "FLOAT4": "Float",
    "FLOAT8": "Float",
    "DOUBLE": "Float",
    "REAL": "Float",
    "BOOLEAN": "Boolean",
    "BOOL": "Boolean",
    "DATE": "Date",
    "TIME": "Time",
    "TIMESTAMP": "DateTime",
    "DATETIME": "DateTime",
    "TIMESTAMPTZ": "DateTimeTz",
    "TIMESTAMP_TZ": "DateTimeTz",
}
_OSSIE_TIME_DATATYPES = frozenset({"Date", "Time", "DateTime", "DateTimeTz"})

_JOIN_PAIR_PATTERN = re.compile(
    r"^\s*([A-Za-z_][\w]*)\.(\"?[\w]+\"?)\s*=\s*([A-Za-z_][\w]*)\.(\"?[\w]+\"?)\s*$"
)


def _ossie_datatype(wren_type: Any) -> str | None:
    if not isinstance(wren_type, str) or not wren_type.strip():
        return None
    base = re.split(r"[\s(<]", wren_type.strip(), maxsplit=1)[0].upper()
    if base == "TIMESTAMP" and "WITH TIME ZONE" in wren_type.upper():
        return "DateTimeTz"
    return _WREN_TYPE_TO_OSSIE_DATATYPE.get(base)


def _expression_block(expression: str, dialect: str) -> dict:
    return {"dialects": [{"dialect": dialect, "expression": expression}]}


def _wren_extension(data: dict) -> dict:
    """One ``custom_extensions`` entry; ``data`` is a JSON string per spec."""
    return {"vendor_name": WREN_VENDOR_NAME, "data": json.dumps(data)}


def _source_from_model(model: dict) -> str | None:
    """Inverse of :func:`_parse_source`.

    ``table_reference`` becomes ``catalog.schema.table`` with empty leading
    parts dropped; ``ref_sql`` is emitted verbatim (the importer recognises
    it by its SQL keywords / newlines).
    """
    ref_sql = model.get("ref_sql")
    if isinstance(ref_sql, str) and ref_sql.strip():
        return ref_sql.strip()
    table_ref = model.get("table_reference")
    if not isinstance(table_ref, dict):
        return None
    table = table_ref.get("table")
    if not isinstance(table, str) or not table:
        return None
    parts = [table_ref.get("catalog"), table_ref.get("schema"), table]
    # Drop empty leading parts only — an empty *middle* part cannot be
    # represented as a dotted path, so fall through with what we have.
    while parts and not parts[0]:
        parts.pop(0)
    if any(not isinstance(p, str) or not p for p in parts):
        return None
    return ".".join(parts)


def _export_field(
    column: dict, *, dialect: str, pk_names: set[str], with_datatype: bool
) -> dict:
    name = column["name"]
    expression = column.get("expression")
    if column.get("is_calculated") and isinstance(expression, str) and expression:
        expr = expression
    else:
        expr = name
    field_obj: dict = {"name": name, "expression": _expression_block(expr, dialect)}
    datatype = _ossie_datatype(column.get("type"))
    if datatype:
        # ``datatype`` only exists from 0.2.0.dev0; a 0.1.1 consumer would
        # see an unknown property. ``dimension.is_time`` exists in both.
        if with_datatype:
            field_obj["datatype"] = datatype
        if datatype in _OSSIE_TIME_DATATYPES:
            field_obj["dimension"] = {"is_time": True}
    props = column.get("properties")
    if isinstance(props, dict) and isinstance(props.get("description"), str):
        if props["description"]:
            field_obj["description"] = props["description"]
    if column.get("not_null") and name not in pk_names:
        field_obj["custom_extensions"] = [_wren_extension({"not_null": True})]
    return field_obj


def _export_dataset(
    model: dict, *, dialect: str, with_datatype: bool
) -> tuple[dict | None, list[ValidationError]]:
    errors: list[ValidationError] = []
    name = model.get("name")
    if not isinstance(name, str) or not name:
        errors.append(ValidationError("error", "<mdl:model>", "model missing 'name'"))
        return (None, errors)

    source = _source_from_model(model)
    if not source:
        errors.append(
            ValidationError(
                "error",
                f"model '{name}'",
                "has neither a usable table_reference nor ref_sql — skipped",
            )
        )
        return (None, errors)

    pk_raw = model.get("primary_key")
    if isinstance(pk_raw, list):
        pk_names = [str(c) for c in pk_raw if c]
    elif isinstance(pk_raw, str) and pk_raw:
        pk_names = [pk_raw]
    else:
        pk_names = []

    fields: list[dict] = []
    column_types: dict[str, str] = {}
    skipped_relationship_columns: list[str] = []
    for column in model.get("columns") or []:
        if not isinstance(column, dict):
            continue
        cname = column.get("name")
        if not isinstance(cname, str) or not cname:
            continue
        # Relationship columns are navigation handles, not physical fields.
        if column.get("relationship"):
            skipped_relationship_columns.append(cname)
            continue
        fields.append(
            _export_field(
                column,
                dialect=dialect,
                pk_names=set(pk_names),
                with_datatype=with_datatype,
            )
        )
        ctype = column.get("type")
        if isinstance(ctype, str) and ctype:
            column_types[cname] = ctype

    dataset: dict = {"name": name, "source": source}
    if pk_names:
        dataset["primary_key"] = pk_names
    props = model.get("properties") if isinstance(model.get("properties"), dict) else {}
    if isinstance(props.get("description"), str) and props["description"]:
        dataset["description"] = props["description"]
    if column_types:
        dataset["custom_extensions"] = [_wren_extension({"column_types": column_types})]
    dataset["fields"] = fields

    if skipped_relationship_columns:
        errors.append(
            ValidationError(
                "warning",
                f"model '{name}'",
                f"{len(skipped_relationship_columns)} relationship column(s) "
                f"not exported ({', '.join(skipped_relationship_columns)}) — "
                "Ossie has no navigation columns; the relationships[] entries "
                "carry the join.",
            )
        )
    dropped = [
        key
        for key in ("row_level_access_controls", "column_level_access_control")
        if props.get(key) or model.get(key)
    ]
    if dropped:
        errors.append(
            ValidationError(
                "warning",
                f"model '{name}'",
                f"{', '.join(dropped)} not exported — Ossie has no access controls.",
            )
        )
    return (dataset, errors)


def _parse_join_condition(condition: Any) -> list[tuple[str, str, str, str]] | None:
    """``a.x = b.y AND a.z = b.w`` → ``[(a, x, b, y), (a, z, b, w)]``.

    Returns None for anything that is not a conjunction of simple
    column-equality pairs — Ossie relationships are column lists, so any other
    predicate cannot be represented.
    """
    if not isinstance(condition, str) or not condition.strip():
        return None
    pairs: list[tuple[str, str, str, str]] = []
    for clause in re.split(r"\s+AND\s+", condition.strip(), flags=re.IGNORECASE):
        m = _JOIN_PAIR_PATTERN.match(clause)
        if not m:
            return None
        lm, lc, rm, rc = (g.strip('"') for g in m.groups())
        pairs.append((lm, lc, rm, rc))
    return pairs


def _export_relationship(rel: dict) -> tuple[dict | None, list[ValidationError]]:
    errors: list[ValidationError] = []
    name = rel.get("name") if isinstance(rel.get("name"), str) else "<unnamed>"
    models = rel.get("models")
    if not isinstance(models, list) or len(models) != 2:
        errors.append(
            ValidationError(
                "error", f"relationship '{name}'", "needs exactly two models — skipped"
            )
        )
        return (None, errors)
    left, right = models
    pairs = _parse_join_condition(rel.get("condition"))
    if pairs is None:
        errors.append(
            ValidationError(
                "warning",
                f"relationship '{name}'",
                f"condition {rel.get('condition')!r} is not a conjunction of "
                "column equalities — Ossie relationships are column lists; skipped.",
            )
        )
        return (None, errors)

    join_type = str(rel.get("join_type") or "MANY_TO_ONE").upper()
    # Ossie relationships are always many(from) → one(to).
    if join_type == "ONE_TO_MANY":
        from_model, to_model = right, left
    else:
        from_model, to_model = left, right
        if join_type not in ("MANY_TO_ONE",):
            errors.append(
                ValidationError(
                    "warning",
                    f"relationship '{name}'",
                    f"join_type {join_type} exported as many-to-one "
                    f"({from_model} → {to_model}) — Ossie models only that shape.",
                )
            )

    from_cols: list[str] = []
    to_cols: list[str] = []
    for lm, lc, rm, rc in pairs:
        if lm == from_model and rm == to_model:
            from_cols.append(lc)
            to_cols.append(rc)
        elif lm == to_model and rm == from_model:
            from_cols.append(rc)
            to_cols.append(lc)
        else:
            errors.append(
                ValidationError(
                    "warning",
                    f"relationship '{name}'",
                    f"condition references '{lm}' / '{rm}' which are not the "
                    f"relationship's models ({left}, {right}); skipped.",
                )
            )
            return (None, errors)

    ossie_rel: dict = {
        "name": name,
        "from": from_model,
        "to": to_model,
        "from_columns": from_cols,
        "to_columns": to_cols,
    }
    # Ossie relationships have no ``description``; ``ai_context.instructions``
    # is the spec'd free-text slot and the importer reads it back.
    props = rel.get("properties")
    if isinstance(props, dict) and isinstance(props.get("description"), str):
        if props["description"]:
            ossie_rel["ai_context"] = {"instructions": props["description"]}
    return (ossie_rel, errors)


def _qualify_measure_expression(expression: str, base_object: str) -> str | None:
    """Prefix unqualified column references with the cube's base object.

    Cube measures are written against the base object's own columns
    (``SUM(amount)``); Ossie metrics are free-floating and must name the
    dataset (``SUM(orders.amount)``). Returns None when sqlglot cannot parse
    the expression.
    """
    import sqlglot  # noqa: PLC0415
    from sqlglot import exp  # noqa: PLC0415

    try:
        tree = sqlglot.parse_one(expression)
    except sqlglot.errors.SqlglotError:
        # ParseError for bad grammar, TokenError for e.g. an unterminated
        # string literal — both mean "cannot qualify", not "crash".
        return None

    def _qualify(node: exp.Expression) -> exp.Expression:
        # Only columns in the outer expression scope belong to the base
        # object; a column inside a nested query (or subquery) resolves
        # against that query's own FROM clause and must be left alone.
        if (
            isinstance(node, exp.Column)
            and not node.table
            and node.find_ancestor(exp.Query, exp.Subquery) is None
        ):
            return exp.Column(this=node.this, table=exp.to_identifier(base_object))
        return node

    return tree.transform(_qualify).sql()


def _export_metrics(
    cubes: list, *, dialect: str, dataset_names: set[str], with_datatype: bool
) -> tuple[list[dict], list[ValidationError]]:
    errors: list[ValidationError] = []
    metrics: list[dict] = []
    seen: set[str] = set()
    for cube in cubes:
        if not isinstance(cube, dict):
            continue
        cname = cube.get("name") if isinstance(cube.get("name"), str) else "<unnamed>"
        base = cube.get("base_object")
        if not isinstance(base, str) or base not in dataset_names:
            errors.append(
                ValidationError(
                    "warning",
                    f"cube '{cname}'",
                    f"base_object {base!r} is not an exported dataset — "
                    "measures skipped.",
                )
            )
            continue
        n_dims = len(cube.get("dimensions") or []) + len(
            cube.get("time_dimensions") or []
        )
        if n_dims:
            errors.append(
                ValidationError(
                    "warning",
                    f"cube '{cname}'",
                    f"{n_dims} dimension(s) not exported — Ossie metrics carry "
                    "only the aggregate expression.",
                )
            )
        for measure in cube.get("measures") or []:
            if not isinstance(measure, dict):
                continue
            mname = measure.get("name")
            expression = measure.get("expression")
            if not isinstance(mname, str) or not mname:
                continue
            if not isinstance(expression, str) or not expression.strip():
                errors.append(
                    ValidationError(
                        "warning",
                        f"cube '{cname}' > measure '{mname}'",
                        "has no expression — skipped.",
                    )
                )
                continue
            qualified = _qualify_measure_expression(expression, base)
            if qualified is None:
                errors.append(
                    ValidationError(
                        "warning",
                        f"cube '{cname}' > measure '{mname}'",
                        "expression could not be parsed — exported verbatim "
                        "without dataset qualification.",
                    )
                )
                qualified = expression
            metric_name = mname if mname not in seen else f"{cname}_{mname}"
            if metric_name in seen:
                errors.append(
                    ValidationError(
                        "warning",
                        f"cube '{cname}' > measure '{mname}'",
                        f"duplicate metric name '{metric_name}' — skipped.",
                    )
                )
                continue
            seen.add(metric_name)
            metric: dict = {
                "name": metric_name,
                "expression": _expression_block(qualified, dialect),
            }
            datatype = _ossie_datatype(measure.get("type"))
            if datatype and with_datatype:
                metric["datatype"] = datatype
            desc = measure.get("description")
            if not isinstance(desc, str):
                props = measure.get("properties")
                desc = props.get("description") if isinstance(props, dict) else None
            if isinstance(desc, str) and desc:
                metric["description"] = desc
            metrics.append(metric)
    return (metrics, errors)


def export_ossie_from_manifest(
    manifest: dict,
    *,
    name: str | None = None,
    instructions: str | None = None,
    dialect: str | None = None,
    spec_version: str = SPEC_VERSION_RELEASED,
) -> tuple[dict, list[ValidationError]]:
    """Convert a snake_case MDL manifest (as :func:`wren.context.build_manifest`
    returns it) into an Ossie document dict.

    ``spec_version`` picks the document layout: ``0.1.1`` (default, the
    released spec: ``semantic_model[]`` wrapper, no ``datatype``) or
    ``0.2.0.dev0`` (root-level model with ``datatype``). Both are readable by
    :func:`build_manifest_from_ossie`.

    ``name`` becomes ``semantic_model[0].name`` (falls back to the manifest's
    own ``name`` and then ``wren_project``). ``instructions`` lands in
    ``ai_context.instructions``. ``dialect`` labels every exported expression;
    when omitted it is inferred from ``data_source`` the same way the importer
    does, defaulting to ``ANSI_SQL``.
    """
    if spec_version not in SUPPORTED_SPEC_VERSIONS:
        raise ValueError(
            f"unsupported Ossie spec version {spec_version!r}; "
            f"expected one of {', '.join(SUPPORTED_SPEC_VERSIONS)}"
        )
    with_datatype = spec_version == SPEC_VERSION_DRAFT
    errors: list[ValidationError] = []
    data_source = manifest.get("data_source")
    if not dialect:
        dialect = (
            _DATA_SOURCE_TO_DIALECT.get(data_source.lower(), DEFAULT_DIALECT)
            if isinstance(data_source, str)
            else DEFAULT_DIALECT
        )

    datasets: list[dict] = []
    for model in manifest.get("models") or []:
        if not isinstance(model, dict):
            continue
        dataset, ds_errors = _export_dataset(
            model, dialect=dialect, with_datatype=with_datatype
        )
        errors.extend(ds_errors)
        if dataset:
            datasets.append(dataset)
    dataset_names = {d["name"] for d in datasets}

    relationships: list[dict] = []
    for rel in manifest.get("relationships") or []:
        if not isinstance(rel, dict):
            continue
        ossie_rel, r_errors = _export_relationship(rel)
        errors.extend(r_errors)
        if ossie_rel:
            relationships.append(ossie_rel)

    metrics, m_errors = _export_metrics(
        manifest.get("cubes") or [],
        dialect=dialect,
        dataset_names=dataset_names,
        with_datatype=with_datatype,
    )
    errors.extend(m_errors)

    views = manifest.get("views") or []
    if views:
        view_names = [v.get("name", "?") for v in views if isinstance(v, dict)]
        errors.append(
            ValidationError(
                "warning",
                "views",
                f"{len(views)} view(s) not exported ({', '.join(map(str, view_names))}) "
                "— Ossie has no view concept.",
            )
        )

    sm_name = name or manifest.get("name")
    if not isinstance(sm_name, str) or not sm_name:
        sm_name = "wren_project"
    semantic_model: dict = {"name": sm_name}
    if instructions:
        semantic_model["ai_context"] = {"instructions": instructions}
    semantic_model["datasets"] = datasets
    if relationships:
        semantic_model["relationships"] = relationships
    if metrics:
        semantic_model["metrics"] = metrics

    doc: dict = {"version": spec_version}
    if spec_version == SPEC_VERSION_DRAFT:
        # One model per document: the semantic model's own keys sit at the
        # root, so the dialect pin goes on the model itself.
        doc.update(semantic_model)
        if dialect != DEFAULT_DIALECT:
            doc["custom_extensions"] = [_wren_extension({"dialect": dialect})]
        return (doc, errors)
    if dialect != DEFAULT_DIALECT:
        doc["custom_extensions"] = [_wren_extension({"dialect": dialect})]
    doc["semantic_model"] = [semantic_model]
    return (doc, errors)


def dump_ossie(doc: dict) -> str:
    """Serialise an Ossie document as YAML in authoring order."""
    return yaml.dump(
        doc, default_flow_style=False, sort_keys=False, allow_unicode=True, width=100
    )
