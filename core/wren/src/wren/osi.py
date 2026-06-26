"""Convert OSI (Open Semantic Interchange) semantic models to Wren MDL.

OSI is a vendor-agnostic semantic model spec
(https://github.com/open-semantic-interchange/OSI). This module reads an OSI
YAML (or JSON) file and produces a Wren MDL manifest dict, suitable for
``wren context build`` to write as ``target/mdl.json``.

The OSI file itself is the single source of truth — we never copy it into a
parallel wren project. Wren-specific build hints (column types, dialect
preference, metrics handling) live inside the OSI file via the spec's
``custom_extensions: [{vendor_name: WREN, data: '<json>'}]`` mechanism, which
is OSI's only sanctioned vendor escape hatch.

Resolution order for any setting (highest first):
  1. CLI flag / explicit kwarg
  2. ``custom_extensions[vendor_name=WREN]`` on the chosen semantic_model
  3. ``custom_extensions[vendor_name=WREN]`` at the OSI document root
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
DEFAULT_DIALECT = "ANSI_SQL"
DEFAULT_METRICS_MODE = "note"
VALID_METRICS_MODES = frozenset({"skip", "note"})

# Wren data_source → OSI dialect identifier (used when the user hasn't set
# `dialect` in the WREN block). Anything not listed here falls back to
# ANSI_SQL, which the OSI spec mandates as the universal baseline.
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


def parse_osi(text: str, *, suffix: str = ".yaml") -> dict:
    """Parse OSI text. JSON if suffix is .json, else YAML."""
    if suffix.lower() == ".json":
        return json.loads(text)
    parsed = yaml.safe_load(text)
    return parsed if isinstance(parsed, dict) else {}


def load_osi_file(path: Path) -> dict:
    return parse_osi(path.read_text(encoding="utf-8"), suffix=path.suffix)


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
    """Pick one semantic_model from the OSI document.

    Resolution:
      - Explicit ``name`` wins.
      - Otherwise, root-level WREN.default_semantic_model.
      - Otherwise, the only semantic_model present.
      - More than one and nothing pinned: error with snippet.
    """
    models = osi.get("semantic_model") or []
    errors: list[ValidationError] = []
    if not isinstance(models, list) or not models:
        errors.append(
            ValidationError("error", "<osi>", "OSI file has no semantic_model entries")
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
                "<osi>",
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
            "<osi>",
            f"OSI file has {len(models)} semantic_models: {', '.join(names)}.\n"
            f"  Pass --semantic-model <name> or add at the OSI document root:\n\n"
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
                "<osi:WREN>",
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
    """Parse OSI ``dataset.source`` into either table_reference or ref_sql.

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
    """Extract a SQL expression from OSI's expression block.

    Order: preferred dialect → ANSI_SQL fallback → first available.
    OSI also permits a bare string for the expression (shorthand) — we honor
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
    if dialect_preference in by_dialect:
        return by_dialect[dialect_preference]
    if "ANSI_SQL" in by_dialect:
        return by_dialect["ANSI_SQL"]
    first = dialects[0]
    if isinstance(first, dict):
        val = first.get("expression", "")
        return val if isinstance(val, str) else ""
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
    if override:
        return override
    dim = field_obj.get("dimension")
    if isinstance(dim, dict) and dim.get("is_time"):
        return "TIMESTAMP"
    return "VARCHAR"


def _join_description(*parts: str | None) -> str | None:
    chunks = [p for p in parts if p]
    return "\n\n".join(chunks) if chunks else None


def _osi_description(obj: dict) -> str | None:
    """Render OSI description + ai_context into one description string."""
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
) -> dict:
    name = field_obj["name"]
    expr = _pick_expression(field_obj.get("expression"), dialect)
    is_calc = _is_calculated_expression(expr, name)
    col_type = _infer_type(field_obj, type_override)

    column: dict = {
        "name": name,
        "type": col_type,
        "is_calculated": is_calc,
        "not_null": False,
        "properties": {},
    }
    if is_calc:
        column["expression"] = expr
    if name in primary_key_names:
        column["is_primary_key"] = True
        column["not_null"] = True
    if desc := _osi_description(field_obj):
        column["properties"]["description"] = desc
    return column


def _format_column_types_snippet(dataset_name: str, field_names: list[str]) -> str:
    """Produce a copy-pasteable column_types snippet for one dataset."""
    pairs = ",\n              ".join(f'"{fn}": "VARCHAR"' for fn in field_names)
    return (
        f"  Add to dataset '{dataset_name}' in the OSI file:\n\n"
        "    custom_extensions:\n"
        "      - vendor_name: WREN\n"
        "        data: |\n"
        "          {\n"
        '            "column_types": {\n'
        f"              {pairs}\n"
        "            }\n"
        "          }"
    )


def _convert_dataset(
    ds: dict, *, wren_cfg: WrenConfig
) -> tuple[dict, list[ValidationError]]:
    errors: list[ValidationError] = []
    name = ds.get("name")
    if not isinstance(name, str) or not name:
        errors.append(
            ValidationError("error", "<osi:dataset>", "dataset missing 'name'")
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

    # Primary key — OSI allows a single string or a composite array; wren MDL
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
        )
        columns.append(col)
        if type_override is None:
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
    if desc := _osi_description(ds):
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
    if desc := _osi_description(rel):
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
    """Render OSI top-level metrics as a markdown block of business rules.

    Surfaced via the manifest's ``_instructions`` carrier, which the importer
    writes to ``knowledge/rules/`` (or indexes as rules on build).

    Wren has no first-class equivalent of OSI's free-floating metrics
    (cubes are bound to a single base_object). For v1 we surface them as
    LLM-readable notes; cross-dataset metrics get a warning.
    """
    errors: list[ValidationError] = []
    if wren_cfg.metrics_mode == "skip" or not metrics:
        return (None, errors)

    lines = ["## Metrics (from OSI)", ""]
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


def build_manifest_from_osi(
    osi_path: Path,
    *,
    data_source: str,
    catalog: str = "wren",
    schema: str = "public",
    semantic_model: str | None = None,
    dialect_override: str | None = None,
    metrics_override: str | None = None,
) -> tuple[dict, list[ValidationError]]:
    """Build a Wren MDL manifest dict (snake_case) from an OSI file.

    Returns (manifest, errors). The manifest mirrors the shape of
    ``context.build_manifest``; pass through :func:`build_json_from_osi` to
    get camelCase JSON for the engine.
    """
    errors: list[ValidationError] = []
    try:
        osi = load_osi_file(osi_path)
    except (OSError, yaml.YAMLError, json.JSONDecodeError) as exc:
        errors.append(
            ValidationError(
                "error",
                str(osi_path),
                f"failed to read OSI file: {exc}",
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
    # Carry the OSI semantic_model name through so downstream consumers
    # (notably context.convert_mdl_to_project for `init --from-osi`) can
    # stamp it into wren_project.yml. The wren engine ignores extra
    # top-level fields, so the build-path output is unaffected.
    sm_name = sm.get("name")
    if isinstance(sm_name, str) and sm_name:
        manifest["name"] = sm_name
    if instructions:
        manifest["_instructions"] = instructions
    return (manifest, errors)


def build_json_from_osi(
    osi_path: Path,
    *,
    data_source: str,
    catalog: str = "wren",
    schema: str = "public",
    semantic_model: str | None = None,
    dialect_override: str | None = None,
    metrics_override: str | None = None,
) -> tuple[dict, list[ValidationError]]:
    """Like :func:`build_manifest_from_osi` but returns the camelCase JSON
    dict the engine consumes. Stamps layoutVersion=2 (table_reference as
    struct, which is what we emit)."""
    manifest, errors = build_manifest_from_osi(
        osi_path,
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
    manifest_json = _convert_keys(manifest)
    manifest_json["layoutVersion"] = 2
    if instructions:
        manifest_json["_instructions"] = instructions
    return (manifest_json, errors)


def lint_osi_file(
    osi_path: Path,
    *,
    data_source: str | None,
    semantic_model: str | None = None,
) -> list[ValidationError]:
    """Run the OSI→MDL conversion solely to collect errors / warnings.

    Used by ``wren context validate --from-osi``. Hard errors include the
    missing-file / missing-data_source preconditions; everything else flows
    out of :func:`build_manifest_from_osi`.
    """
    if not osi_path.exists():
        return [ValidationError("error", str(osi_path), "OSI file not found")]
    if not data_source:
        return [
            ValidationError(
                "error",
                "<cli>",
                "--data-source is required for --from-osi "
                "(e.g. postgres, snowflake, ...)",
            )
        ]
    _, errors = build_manifest_from_osi(
        osi_path,
        data_source=data_source,
        semantic_model=semantic_model,
    )
    return errors
