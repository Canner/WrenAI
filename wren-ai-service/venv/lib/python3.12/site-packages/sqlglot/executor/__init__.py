"""
.. include:: ../../posts/python_sql_engine.md

----
"""

from __future__ import annotations

import logging
import time
import typing as t

from sqlglot import exp
from sqlglot.errors import ExecuteError
from sqlglot.executor.python import PythonExecutor
from sqlglot.executor.table import Table, ensure_tables
from sqlglot.helper import dict_depth
from sqlglot.optimizer import optimize
from sqlglot.optimizer.annotate_types import annotate_types
from sqlglot.planner import Plan
from sqlglot.schema import ensure_schema, flatten_schema, nested_get, nested_set

logger = logging.getLogger("sqlglot")

if t.TYPE_CHECKING:
    from sqlglot.dialects.dialect import DialectType
    from sqlglot.expressions import Expression
    from sqlglot.schema import Schema


def execute(
    sql: str | Expression,
    schema: t.Optional[t.Dict | Schema] = None,
    read: DialectType = None,
    dialect: DialectType = None,
    tables: t.Optional[t.Dict] = None,
) -> Table:
    """
    Run a sql query against data.

    Args:
        sql: a sql statement.
        schema: database schema.
            This can either be an instance of `Schema` or a mapping in one of the following forms:
            1. {table: {col: type}}
            2. {db: {table: {col: type}}}
            3. {catalog: {db: {table: {col: type}}}}
        read: the SQL dialect to apply during parsing (eg. "spark", "hive", "presto", "mysql").
        dialect: the SQL dialect (alias for read).
        tables: additional tables to register.

    Returns:
        Simple columnar data structure.
    """
    read = read or dialect
    tables_ = ensure_tables(tables, dialect=read)

    if not schema:
        schema = {}
        flattened_tables = flatten_schema(tables_.mapping, depth=dict_depth(tables_.mapping))

        for keys in flattened_tables:
            table = nested_get(tables_.mapping, *zip(keys, keys))
            assert table is not None

            for column in table.columns:
                value = table[0][column]
                column_type = annotate_types(exp.convert(value)).type or type(value).__name__
                nested_set(schema, [*keys, column], column_type)

    schema = ensure_schema(schema, dialect=read)

    if tables_.supported_table_args and tables_.supported_table_args != schema.supported_table_args:
        raise ExecuteError("Tables must support the same table args as schema")

    now = time.time()
    expression = optimize(
        sql, schema, leave_tables_isolated=True, infer_csv_schemas=True, dialect=read
    )

    logger.debug("Optimization finished: %f", time.time() - now)
    logger.debug("Optimized SQL: %s", expression.sql(pretty=True))

    plan = Plan(expression)

    logger.debug("Logical Plan: %s", plan)

    now = time.time()
    result = PythonExecutor(tables=tables_).execute(plan)

    logger.debug("Query finished: %f", time.time() - now)

    return result
