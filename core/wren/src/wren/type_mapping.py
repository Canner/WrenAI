"""SQL type normalization via sqlglot.

Use as a library:

    from wren.type_mapping import parse_type, parse_types

    parse_type("character varying(255)", "postgres")  # → "VARCHAR(255)"

    parse_types([
        {"column": "id", "raw_type": "int8"},
        {"column": "name", "raw_type": "character varying"},
    ], dialect="postgres")
    # → [
    #     {"column": "id", "raw_type": "int8", "type": "BIGINT"},
    #     {"column": "name", "raw_type": "character varying", "type": "VARCHAR"},
    # ]
"""

from __future__ import annotations

import sqlglot
import sqlglot.errors
from sqlglot.expressions import DataType


def parse_type(type_str: str, dialect: str) -> str:
    """Normalize a SQL type string to sqlglot canonical form.

    Args:
        type_str: Raw database type (e.g. "character varying(255)", "INT64").
        dialect: sqlglot dialect name (e.g. "postgres", "bigquery", "clickhouse").

    Returns:
        Canonical type string (e.g. "VARCHAR(255)", "BIGINT").
        Falls back to original string if parsing fails.
    """
    if not type_str:
        return type_str
    try:
        return sqlglot.parse_one(type_str, into=DataType, dialect=dialect).sql()
    except (sqlglot.errors.ParseError, ValueError):
        return type_str


def parse_types(
    columns: list[dict],
    dialect: str,
    *,
    type_field: str = "raw_type",
) -> list[dict]:
    """Batch-normalize types for a list of column dicts.

    Each dict must have a key matching *type_field* (default "raw_type").
    Returns a new list with an added "type" key containing the normalized type.
    Original dicts are not mutated.
    """
    results = []
    for col in columns:
        row = dict(col)
        row["type"] = parse_type(row.get(type_field, ""), dialect)
        results.append(row)
    return results
