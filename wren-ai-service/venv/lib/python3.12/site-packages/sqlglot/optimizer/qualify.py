from __future__ import annotations

import typing as t

from sqlglot import exp
from sqlglot.dialects.dialect import Dialect, DialectType
from sqlglot.optimizer.isolate_table_selects import isolate_table_selects
from sqlglot.optimizer.normalize_identifiers import normalize_identifiers
from sqlglot.optimizer.qualify_columns import (
    pushdown_cte_alias_columns as pushdown_cte_alias_columns_func,
    qualify_columns as qualify_columns_func,
    quote_identifiers as quote_identifiers_func,
    validate_qualify_columns as validate_qualify_columns_func,
)
from sqlglot.optimizer.qualify_tables import qualify_tables
from sqlglot.schema import Schema, ensure_schema


def qualify(
    expression: exp.Expression,
    dialect: DialectType = None,
    db: t.Optional[str] = None,
    catalog: t.Optional[str] = None,
    schema: t.Optional[dict | Schema] = None,
    expand_alias_refs: bool = True,
    expand_stars: bool = True,
    infer_schema: t.Optional[bool] = None,
    isolate_tables: bool = False,
    qualify_columns: bool = True,
    allow_partial_qualification: bool = False,
    validate_qualify_columns: bool = True,
    quote_identifiers: bool = True,
    identify: bool = True,
    infer_csv_schemas: bool = False,
) -> exp.Expression:
    """
    Rewrite sqlglot AST to have normalized and qualified tables and columns.

    This step is necessary for all further SQLGlot optimizations.

    Example:
        >>> import sqlglot
        >>> schema = {"tbl": {"col": "INT"}}
        >>> expression = sqlglot.parse_one("SELECT col FROM tbl")
        >>> qualify(expression, schema=schema).sql()
        'SELECT "tbl"."col" AS "col" FROM "tbl" AS "tbl"'

    Args:
        expression: Expression to qualify.
        db: Default database name for tables.
        catalog: Default catalog name for tables.
        schema: Schema to infer column names and types.
        expand_alias_refs: Whether to expand references to aliases.
        expand_stars: Whether to expand star queries. This is a necessary step
            for most of the optimizer's rules to work; do not set to False unless you
            know what you're doing!
        infer_schema: Whether to infer the schema if missing.
        isolate_tables: Whether to isolate table selects.
        qualify_columns: Whether to qualify columns.
        allow_partial_qualification: Whether to allow partial qualification.
        validate_qualify_columns: Whether to validate columns.
        quote_identifiers: Whether to run the quote_identifiers step.
            This step is necessary to ensure correctness for case sensitive queries.
            But this flag is provided in case this step is performed at a later time.
        identify: If True, quote all identifiers, else only necessary ones.
        infer_csv_schemas: Whether to scan READ_CSV calls in order to infer the CSVs' schemas.

    Returns:
        The qualified expression.
    """
    schema = ensure_schema(schema, dialect=dialect)
    expression = normalize_identifiers(expression, dialect=dialect)
    expression = qualify_tables(
        expression,
        db=db,
        catalog=catalog,
        schema=schema,
        dialect=dialect,
        infer_csv_schemas=infer_csv_schemas,
    )

    if isolate_tables:
        expression = isolate_table_selects(expression, schema=schema)

    if Dialect.get_or_raise(dialect).PREFER_CTE_ALIAS_COLUMN:
        expression = pushdown_cte_alias_columns_func(expression)

    if qualify_columns:
        expression = qualify_columns_func(
            expression,
            schema,
            expand_alias_refs=expand_alias_refs,
            expand_stars=expand_stars,
            infer_schema=infer_schema,
            allow_partial_qualification=allow_partial_qualification,
        )

    if quote_identifiers:
        expression = quote_identifiers_func(expression, dialect=dialect, identify=identify)

    if validate_qualify_columns:
        validate_qualify_columns_func(expression)

    return expression
