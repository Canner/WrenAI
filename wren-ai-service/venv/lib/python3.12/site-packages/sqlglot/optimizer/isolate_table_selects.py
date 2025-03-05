from sqlglot import alias, exp
from sqlglot.errors import OptimizeError
from sqlglot.optimizer.scope import traverse_scope
from sqlglot.schema import ensure_schema


def isolate_table_selects(expression, schema=None):
    schema = ensure_schema(schema)

    for scope in traverse_scope(expression):
        if len(scope.selected_sources) == 1:
            continue

        for _, source in scope.selected_sources.values():
            if (
                not isinstance(source, exp.Table)
                or not schema.column_names(source)
                or isinstance(source.parent, exp.Subquery)
                or isinstance(source.parent.parent, exp.Table)
            ):
                continue

            if not source.alias:
                raise OptimizeError("Tables require an alias. Run qualify_tables optimization.")

            source.replace(
                exp.select("*")
                .from_(
                    alias(source, source.alias_or_name, table=True),
                    copy=False,
                )
                .subquery(source.alias, copy=False)
            )

    return expression
