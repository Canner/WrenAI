from __future__ import annotations

import itertools
import typing as t

from sqlglot import alias, exp
from sqlglot.dialects.dialect import DialectType
from sqlglot.helper import csv_reader, name_sequence
from sqlglot.optimizer.scope import Scope, traverse_scope
from sqlglot.schema import Schema

if t.TYPE_CHECKING:
    from sqlglot._typing import E


def qualify_tables(
    expression: E,
    db: t.Optional[str | exp.Identifier] = None,
    catalog: t.Optional[str | exp.Identifier] = None,
    schema: t.Optional[Schema] = None,
    infer_csv_schemas: bool = False,
    dialect: DialectType = None,
) -> E:
    """
    Rewrite sqlglot AST to have fully qualified tables. Join constructs such as
    (t1 JOIN t2) AS t will be expanded into (SELECT * FROM t1 AS t1, t2 AS t2) AS t.

    Examples:
        >>> import sqlglot
        >>> expression = sqlglot.parse_one("SELECT 1 FROM tbl")
        >>> qualify_tables(expression, db="db").sql()
        'SELECT 1 FROM db.tbl AS tbl'
        >>>
        >>> expression = sqlglot.parse_one("SELECT 1 FROM (t1 JOIN t2) AS t")
        >>> qualify_tables(expression).sql()
        'SELECT 1 FROM (SELECT * FROM t1 AS t1, t2 AS t2) AS t'

    Args:
        expression: Expression to qualify
        db: Database name
        catalog: Catalog name
        schema: A schema to populate
        infer_csv_schemas: Whether to scan READ_CSV calls in order to infer the CSVs' schemas.
        dialect: The dialect to parse catalog and schema into.

    Returns:
        The qualified expression.
    """
    next_alias_name = name_sequence("_q_")
    db = exp.parse_identifier(db, dialect=dialect) if db else None
    catalog = exp.parse_identifier(catalog, dialect=dialect) if catalog else None

    def _qualify(table: exp.Table) -> None:
        if isinstance(table.this, exp.Identifier):
            if not table.args.get("db"):
                table.set("db", db)
            if not table.args.get("catalog") and table.args.get("db"):
                table.set("catalog", catalog)

    if (db or catalog) and not isinstance(expression, exp.Query):
        for node in expression.walk(prune=lambda n: isinstance(n, exp.Query)):
            if isinstance(node, exp.Table):
                _qualify(node)

    for scope in traverse_scope(expression):
        for derived_table in itertools.chain(scope.ctes, scope.derived_tables):
            if isinstance(derived_table, exp.Subquery):
                unnested = derived_table.unnest()
                if isinstance(unnested, exp.Table):
                    joins = unnested.args.pop("joins", None)
                    derived_table.this.replace(exp.select("*").from_(unnested.copy(), copy=False))
                    derived_table.this.set("joins", joins)

            if not derived_table.args.get("alias"):
                alias_ = next_alias_name()
                derived_table.set("alias", exp.TableAlias(this=exp.to_identifier(alias_)))
                scope.rename_source(None, alias_)

            pivots = derived_table.args.get("pivots")
            if pivots and not pivots[0].alias:
                pivots[0].set("alias", exp.TableAlias(this=exp.to_identifier(next_alias_name())))

        table_aliases = {}

        for name, source in scope.sources.items():
            if isinstance(source, exp.Table):
                pivots = source.args.get("pivots")
                if not source.alias:
                    # Don't add the pivot's alias to the pivoted table, use the table's name instead
                    if pivots and pivots[0].alias == name:
                        name = source.name

                    # Mutates the source by attaching an alias to it
                    alias(source, name or source.name or next_alias_name(), copy=False, table=True)

                table_aliases[".".join(p.name for p in source.parts)] = exp.to_identifier(
                    source.alias
                )

                _qualify(source)

                if pivots and not pivots[0].alias:
                    pivots[0].set(
                        "alias", exp.TableAlias(this=exp.to_identifier(next_alias_name()))
                    )

                if infer_csv_schemas and schema and isinstance(source.this, exp.ReadCSV):
                    with csv_reader(source.this) as reader:
                        header = next(reader)
                        columns = next(reader)
                        schema.add_table(
                            source,
                            {k: type(v).__name__ for k, v in zip(header, columns)},
                            match_depth=False,
                        )
            elif isinstance(source, Scope) and source.is_udtf:
                udtf = source.expression
                table_alias = udtf.args.get("alias") or exp.TableAlias(
                    this=exp.to_identifier(next_alias_name())
                )
                udtf.set("alias", table_alias)

                if not table_alias.name:
                    table_alias.set("this", exp.to_identifier(next_alias_name()))
                if isinstance(udtf, exp.Values) and not table_alias.columns:
                    for i, e in enumerate(udtf.expressions[0].expressions):
                        table_alias.append("columns", exp.to_identifier(f"_col_{i}"))
            else:
                for node in scope.walk():
                    if (
                        isinstance(node, exp.Table)
                        and not node.alias
                        and isinstance(node.parent, (exp.From, exp.Join))
                    ):
                        # Mutates the table by attaching an alias to it
                        alias(node, node.name, copy=False, table=True)

        for column in scope.columns:
            if column.db:
                table_alias = table_aliases.get(".".join(p.name for p in column.parts[0:-1]))

                if table_alias:
                    for p in exp.COLUMN_PARTS[1:]:
                        column.set(p, None)
                    column.set("table", table_alias)

    return expression
