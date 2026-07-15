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

    translate_type("int8", "postgres", "bigquery")  # → "INT64"
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
    except (sqlglot.errors.SqlglotError, ValueError):
        # SqlglotError covers both ParseError and TokenError (the tokenizer
        # raises TokenError on unterminated quotes / stray control chars, and
        # it is NOT a subclass of ParseError). Fall back to the raw string.
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
        # Callers occasionally pass sparse / non-mapping rows from dynamic
        # schemas; skip rather than TypeError on dict(col).
        if not isinstance(col, dict):
            continue
        row = dict(col)
        row["type"] = parse_type(row.get(type_field, ""), dialect)
        results.append(row)
    return results


def translate_type(type_str: str, source_dialect: str, target_dialect: str) -> str:
    """Translate a SQL type string from one dialect to another.

    Parses *type_str* using *source_dialect* and re-serializes it in
    *target_dialect*, mapping vendor-specific spellings across engines
    (e.g. postgres ``int8`` → bigquery ``INT64``, postgres
    ``character varying(255)`` → clickhouse ``Nullable(String)``).

    Args:
        type_str: Raw type string in the source dialect.
        source_dialect: sqlglot dialect to parse with (e.g. "postgres").
        target_dialect: sqlglot dialect to render in (e.g. "bigquery").

    Returns:
        The type string rendered in *target_dialect*. Falls back to the
        original string if parsing fails.
    """
    if not type_str:
        return type_str
    try:
        parsed = sqlglot.parse_one(type_str, into=DataType, dialect=source_dialect)
    except (sqlglot.errors.SqlglotError, ValueError):
        # SqlglotError covers both ParseError and TokenError; see parse_type.
        return type_str
    try:
        return parsed.sql(dialect=target_dialect)
    except (sqlglot.errors.SqlglotError, ValueError):
        return type_str


def translate_types(
    columns: list[dict],
    source_dialect: str,
    target_dialect: str,
    *,
    type_field: str = "raw_type",
) -> list[dict]:
    """Batch-translate types from *source_dialect* to *target_dialect*.

    Each dict must have a key matching *type_field* (default "raw_type").
    Returns a new list with an added "type" key holding the translated type.
    Original dicts are not mutated.
    """
    results = []
    for col in columns:
        if not isinstance(col, dict):
            continue
        row = dict(col)
        row["type"] = translate_type(
            row.get(type_field, ""), source_dialect, target_dialect
        )
        results.append(row)
    return results
