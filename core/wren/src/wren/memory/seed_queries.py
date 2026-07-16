"""Generate canonical NL-SQL seed pairs from an MDL manifest.

Pure functions — no LanceDB or embedding dependency.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlglot
import sqlglot.errors
from sqlglot import exp

_NUMERIC_TYPES = {
    "int",
    "integer",
    "bigint",
    "smallint",
    "tinyint",
    "float",
    "double",
    "decimal",
    "numeric",
    "real",
    "number",
}

SEED_TAG = "source:seed"


def generate_seed_queries(manifest: dict) -> list[dict]:
    """Return a list of {"nl": ..., "sql": ...} seed pairs."""
    pairs: list[dict] = []
    model_layers = {
        model["name"]: _prop_value(model, "dbtLayer", "dbt_layer")
        for model in manifest.get("models", [])
    }
    relationship_keys = _relationship_key_columns(manifest)

    for model in manifest.get("models", []):
        if model_layers.get(model["name"]) == "raw":
            continue
        pairs.extend(
            _model_seeds(
                model, relationship_keys.get(_norm_ident(model["name"]), frozenset())
            )
        )

    for rel in manifest.get("relationships", []):
        pair = _relationship_seed(rel, model_layers)
        if pair:
            pairs.append(pair)

    return pairs


def _model_seeds(
    model: dict, relationship_keys: frozenset[str] = frozenset()
) -> list[dict]:
    name = model["name"]
    columns = model.get("columns", [])
    primary_keys = _primary_key_columns(model)
    pairs = []

    # Template 1: basic listing
    pairs.append(
        {
            "nl": f"List all {name}",
            "sql": f"SELECT * FROM {name} LIMIT 100",
        }
    )

    # Find first numeric column (non-calculated) and first groupable column
    numeric_col = None
    group_col = None
    for col in columns:
        if not isinstance(col, dict):
            continue
        col_name = col.get("name")
        if not col_name:
            continue
        norm_name = _norm_ident(str(col_name))
        col_type = (col.get("type") or "").split("(")[0].lower().strip()
        is_calc = col.get("isCalculated", False)
        is_pk = norm_name in primary_keys
        # Identifiers are numeric by storage but not measures: summing a join
        # key (e.g. SUM(customer_id)) is semantically meaningless.
        is_identifier = (
            is_pk or norm_name in relationship_keys or _is_id_like(str(col_name))
        )

        if (
            col_type in _NUMERIC_TYPES
            and not is_calc
            and not is_identifier
            and numeric_col is None
        ):
            numeric_col = col_name
        elif (
            col_type not in _NUMERIC_TYPES
            and not is_pk
            and not is_calc
            and group_col is None
        ):
            group_col = col_name

    # Template 2a: simple aggregation
    if numeric_col:
        pairs.append(
            {
                "nl": f"Total {numeric_col} in {name}",
                "sql": f"SELECT SUM({numeric_col}) FROM {name}",
            }
        )

    # Template 2b: grouped aggregation
    if numeric_col and group_col:
        pairs.append(
            {
                "nl": f"{numeric_col} by {group_col} in {name}",
                "sql": f"SELECT {group_col}, SUM({numeric_col}) FROM {name} GROUP BY 1",
            }
        )

    for col in columns:
        if not isinstance(col, dict):
            continue
        col_name = col.get("name")
        if not col_name:
            continue
        accepted_values = _prop_raw(col, "acceptedValues", "accepted_values")
        first_value = _first_accepted_value(accepted_values)
        if not first_value:
            continue
        quoted = first_value.replace("'", "''")
        pairs.append(
            {
                "nl": f"Show {name} where {col_name} is {first_value}",
                "sql": f"SELECT * FROM {name} WHERE {col_name} = '{quoted}' LIMIT 100",
            }
        )

    return pairs


def _relationship_seed(rel: dict, model_layers: dict[str, str]) -> dict | None:
    # Use `or` fallbacks so an explicit JSON null ("models": null /
    # "condition": null in the manifest) does not slip a None past `.get()`'s
    # default and crash `len(None)` / `None.strip()`. Mirrors the defensive
    # `rel.get("condition") or ""` in `_relationship_key_columns`.
    models = rel.get("models") or []
    condition = (rel.get("condition") or "").strip()

    if len(models) < 2 or not condition:
        return None

    left, right = models[0], models[1]
    if model_layers.get(left) == "raw" or model_layers.get(right) == "raw":
        return None

    return {
        "nl": f"{left} with {right} details",
        "sql": f"SELECT * FROM {left} JOIN {right} ON {condition} LIMIT 100",
    }


def _relationship_key_columns(manifest: dict) -> dict[str, frozenset[str]]:
    """Map each model to the set of columns it exposes as a relationship key.

    Relationship conditions (e.g. ``orders.customer_id = customers.customer_id``)
    are the manifest's own declaration of join keys, so we keep both sides out
    of aggregation seeds.
    """
    accum: dict[str, set[str]] = {}
    for rel in manifest.get("relationships", []):
        condition = rel.get("condition") or ""
        try:
            tree = sqlglot.parse_one(condition)
        except sqlglot.errors.SqlglotError:
            continue
        for col in tree.find_all(exp.Column):
            if col.table and col.name:
                accum.setdefault(_norm_ident(col.table), set()).add(
                    _norm_ident(col.name)
                )
    return {model: frozenset(cols) for model, cols in accum.items()}


def _primary_key_columns(model: dict) -> frozenset[str]:
    """Return primary key column names for string and composite-list PKs."""
    primary_key = model.get("primaryKey")
    if isinstance(primary_key, str):
        return frozenset([_norm_ident(primary_key)])
    if isinstance(primary_key, list):
        return frozenset(_norm_ident(str(part)) for part in primary_key if part)
    return frozenset()


def _norm_ident(name: str) -> str:
    """Canonicalize an identifier for case-insensitive membership checks.

    Primary-key, relationship-key and ``*_id`` matching all compare against a
    column name; normalizing keeps them consistent when a manifest mixes cases
    (e.g. a condition referencing ``ORDERS.CUSTKEY`` while the column is
    declared ``Custkey``). The original name is always used for generated SQL.
    """
    return name.strip().lower()


def _is_id_like(col_name: str) -> bool:
    """Cheap heuristic for identifier columns not declared as relationships.

    Case-insensitive: warehouses such as Snowflake/Oracle fold identifiers to
    upper case, so an undeclared ``CUSTOMER_ID`` must be caught too.
    """
    lowered = _norm_ident(col_name)
    return lowered == "id" or lowered.endswith("_id")


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


def _first_accepted_value(value) -> str | None:
    if isinstance(value, str):
        return next((part.strip() for part in value.split(",") if part.strip()), None)
    if isinstance(value, Sequence) and not isinstance(value, bytes):
        return next((str(part).strip() for part in value if str(part).strip()), None)
    return None
