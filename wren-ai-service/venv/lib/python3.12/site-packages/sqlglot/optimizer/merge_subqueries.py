from __future__ import annotations

import typing as t

from collections import defaultdict

from sqlglot import expressions as exp
from sqlglot.helper import find_new_name
from sqlglot.optimizer.scope import Scope, traverse_scope

if t.TYPE_CHECKING:
    from sqlglot._typing import E

    FromOrJoin = t.Union[exp.From, exp.Join]


def merge_subqueries(expression: E, leave_tables_isolated: bool = False) -> E:
    """
    Rewrite sqlglot AST to merge derived tables into the outer query.

    This also merges CTEs if they are selected from only once.

    Example:
        >>> import sqlglot
        >>> expression = sqlglot.parse_one("SELECT a FROM (SELECT x.a FROM x) CROSS JOIN y")
        >>> merge_subqueries(expression).sql()
        'SELECT x.a FROM x CROSS JOIN y'

    If `leave_tables_isolated` is True, this will not merge inner queries into outer
    queries if it would result in multiple table selects in a single query:
        >>> expression = sqlglot.parse_one("SELECT a FROM (SELECT x.a FROM x) CROSS JOIN y")
        >>> merge_subqueries(expression, leave_tables_isolated=True).sql()
        'SELECT a FROM (SELECT x.a FROM x) CROSS JOIN y'

    Inspired by https://dev.mysql.com/doc/refman/8.0/en/derived-table-optimization.html

    Args:
        expression (sqlglot.Expression): expression to optimize
        leave_tables_isolated (bool):
    Returns:
        sqlglot.Expression: optimized expression
    """
    expression = merge_ctes(expression, leave_tables_isolated)
    expression = merge_derived_tables(expression, leave_tables_isolated)
    return expression


# If a derived table has these Select args, it can't be merged
UNMERGABLE_ARGS = set(exp.Select.arg_types) - {
    "expressions",
    "from",
    "joins",
    "where",
    "order",
    "hint",
}


# Projections in the outer query that are instances of these types can be replaced
# without getting wrapped in parentheses, because the precedence won't be altered.
SAFE_TO_REPLACE_UNWRAPPED = (
    exp.Column,
    exp.EQ,
    exp.Func,
    exp.NEQ,
    exp.Paren,
)


def merge_ctes(expression: E, leave_tables_isolated: bool = False) -> E:
    scopes = traverse_scope(expression)

    # All places where we select from CTEs.
    # We key on the CTE scope so we can detect CTES that are selected from multiple times.
    cte_selections = defaultdict(list)
    for outer_scope in scopes:
        for table, inner_scope in outer_scope.selected_sources.values():
            if isinstance(inner_scope, Scope) and inner_scope.is_cte:
                cte_selections[id(inner_scope)].append(
                    (
                        outer_scope,
                        inner_scope,
                        table,
                    )
                )

    singular_cte_selections = [v[0] for k, v in cte_selections.items() if len(v) == 1]
    for outer_scope, inner_scope, table in singular_cte_selections:
        from_or_join = table.find_ancestor(exp.From, exp.Join)
        if _mergeable(outer_scope, inner_scope, leave_tables_isolated, from_or_join):
            alias = table.alias_or_name
            _rename_inner_sources(outer_scope, inner_scope, alias)
            _merge_from(outer_scope, inner_scope, table, alias)
            _merge_expressions(outer_scope, inner_scope, alias)
            _merge_joins(outer_scope, inner_scope, from_or_join)
            _merge_where(outer_scope, inner_scope, from_or_join)
            _merge_order(outer_scope, inner_scope)
            _merge_hints(outer_scope, inner_scope)
            _pop_cte(inner_scope)
            outer_scope.clear_cache()
    return expression


def merge_derived_tables(expression: E, leave_tables_isolated: bool = False) -> E:
    for outer_scope in traverse_scope(expression):
        for subquery in outer_scope.derived_tables:
            from_or_join = subquery.find_ancestor(exp.From, exp.Join)
            alias = subquery.alias_or_name
            inner_scope = outer_scope.sources[alias]
            if _mergeable(outer_scope, inner_scope, leave_tables_isolated, from_or_join):
                _rename_inner_sources(outer_scope, inner_scope, alias)
                _merge_from(outer_scope, inner_scope, subquery, alias)
                _merge_expressions(outer_scope, inner_scope, alias)
                _merge_joins(outer_scope, inner_scope, from_or_join)
                _merge_where(outer_scope, inner_scope, from_or_join)
                _merge_order(outer_scope, inner_scope)
                _merge_hints(outer_scope, inner_scope)
                outer_scope.clear_cache()

    return expression


def _mergeable(
    outer_scope: Scope, inner_scope: Scope, leave_tables_isolated: bool, from_or_join: FromOrJoin
) -> bool:
    """
    Return True if `inner_select` can be merged into outer query.
    """
    inner_select = inner_scope.expression.unnest()

    def _is_a_window_expression_in_unmergable_operation():
        window_expressions = inner_select.find_all(exp.Window)
        window_alias_names = {window.parent.alias_or_name for window in window_expressions}
        inner_select_name = from_or_join.alias_or_name
        unmergable_window_columns = [
            column
            for column in outer_scope.columns
            if column.find_ancestor(
                exp.Where, exp.Group, exp.Order, exp.Join, exp.Having, exp.AggFunc
            )
        ]
        window_expressions_in_unmergable = [
            column
            for column in unmergable_window_columns
            if column.table == inner_select_name and column.name in window_alias_names
        ]
        return any(window_expressions_in_unmergable)

    def _outer_select_joins_on_inner_select_join():
        """
        All columns from the inner select in the ON clause must be from the first FROM table.

        That is, this can be merged:
            SELECT * FROM x JOIN (SELECT y.a AS a FROM y JOIN z) AS q ON x.a = q.a
                                         ^^^           ^
        But this can't:
            SELECT * FROM x JOIN (SELECT z.a AS a FROM y JOIN z) AS q ON x.a = q.a
                                         ^^^                  ^
        """
        if not isinstance(from_or_join, exp.Join):
            return False

        alias = from_or_join.alias_or_name

        on = from_or_join.args.get("on")
        if not on:
            return False
        selections = [c.name for c in on.find_all(exp.Column) if c.table == alias]
        inner_from = inner_scope.expression.args.get("from")
        if not inner_from:
            return False
        inner_from_table = inner_from.alias_or_name
        inner_projections = {s.alias_or_name: s for s in inner_scope.expression.selects}
        return any(
            col.table != inner_from_table
            for selection in selections
            for col in inner_projections[selection].find_all(exp.Column)
        )

    def _is_recursive():
        # Recursive CTEs look like this:
        #     WITH RECURSIVE cte AS (
        #       SELECT * FROM x  <-- inner scope
        #       UNION ALL
        #       SELECT * FROM cte  <-- outer scope
        #     )
        cte = inner_scope.expression.parent
        node = outer_scope.expression.parent

        while node:
            if node is cte:
                return True
            node = node.parent
        return False

    return (
        isinstance(outer_scope.expression, exp.Select)
        and not outer_scope.expression.is_star
        and isinstance(inner_select, exp.Select)
        and not any(inner_select.args.get(arg) for arg in UNMERGABLE_ARGS)
        and inner_select.args.get("from") is not None
        and not outer_scope.pivots
        and not any(e.find(exp.AggFunc, exp.Select, exp.Explode) for e in inner_select.expressions)
        and not (leave_tables_isolated and len(outer_scope.selected_sources) > 1)
        and not (
            isinstance(from_or_join, exp.Join)
            and inner_select.args.get("where")
            and from_or_join.side in ("FULL", "LEFT", "RIGHT")
        )
        and not (
            isinstance(from_or_join, exp.From)
            and inner_select.args.get("where")
            and any(
                j.side in ("FULL", "RIGHT") for j in outer_scope.expression.args.get("joins", [])
            )
        )
        and not _outer_select_joins_on_inner_select_join()
        and not _is_a_window_expression_in_unmergable_operation()
        and not _is_recursive()
        and not (inner_select.args.get("order") and outer_scope.is_union)
    )


def _rename_inner_sources(outer_scope: Scope, inner_scope: Scope, alias: str) -> None:
    """
    Renames any sources in the inner query that conflict with names in the outer query.
    """
    inner_taken = set(inner_scope.selected_sources)
    outer_taken = set(outer_scope.selected_sources)
    conflicts = outer_taken.intersection(inner_taken)
    conflicts -= {alias}

    taken = outer_taken.union(inner_taken)

    for conflict in conflicts:
        new_name = find_new_name(taken, conflict)

        source, _ = inner_scope.selected_sources[conflict]
        new_alias = exp.to_identifier(new_name)

        if isinstance(source, exp.Subquery):
            source.set("alias", exp.TableAlias(this=new_alias))
        elif isinstance(source, exp.Table) and source.alias:
            source.set("alias", new_alias)
        elif isinstance(source, exp.Table):
            source.replace(exp.alias_(source, new_alias))

        for column in inner_scope.source_columns(conflict):
            column.set("table", exp.to_identifier(new_name))

        inner_scope.rename_source(conflict, new_name)


def _merge_from(
    outer_scope: Scope,
    inner_scope: Scope,
    node_to_replace: t.Union[exp.Subquery, exp.Table],
    alias: str,
) -> None:
    """
    Merge FROM clause of inner query into outer query.
    """
    new_subquery = inner_scope.expression.args["from"].this
    new_subquery.set("joins", node_to_replace.args.get("joins"))
    node_to_replace.replace(new_subquery)
    for join_hint in outer_scope.join_hints:
        tables = join_hint.find_all(exp.Table)
        for table in tables:
            if table.alias_or_name == node_to_replace.alias_or_name:
                table.set("this", exp.to_identifier(new_subquery.alias_or_name))
    outer_scope.remove_source(alias)
    outer_scope.add_source(
        new_subquery.alias_or_name, inner_scope.sources[new_subquery.alias_or_name]
    )


def _merge_joins(outer_scope: Scope, inner_scope: Scope, from_or_join: FromOrJoin) -> None:
    """
    Merge JOIN clauses of inner query into outer query.
    """

    new_joins = []

    joins = inner_scope.expression.args.get("joins") or []
    for join in joins:
        new_joins.append(join)
        outer_scope.add_source(join.alias_or_name, inner_scope.sources[join.alias_or_name])

    if new_joins:
        outer_joins = outer_scope.expression.args.get("joins", [])

        # Maintain the join order
        if isinstance(from_or_join, exp.From):
            position = 0
        else:
            position = outer_joins.index(from_or_join) + 1
        outer_joins[position:position] = new_joins

        outer_scope.expression.set("joins", outer_joins)


def _merge_expressions(outer_scope: Scope, inner_scope: Scope, alias: str) -> None:
    """
    Merge projections of inner query into outer query.

    Args:
        outer_scope (sqlglot.optimizer.scope.Scope)
        inner_scope (sqlglot.optimizer.scope.Scope)
        alias (str)
    """
    # Collect all columns that reference the alias of the inner query
    outer_columns = defaultdict(list)
    for column in outer_scope.columns:
        if column.table == alias:
            outer_columns[column.name].append(column)

    # Replace columns with the projection expression in the inner query
    for expression in inner_scope.expression.expressions:
        projection_name = expression.alias_or_name
        if not projection_name:
            continue
        columns_to_replace = outer_columns.get(projection_name, [])

        expression = expression.unalias()
        must_wrap_expression = not isinstance(expression, SAFE_TO_REPLACE_UNWRAPPED)

        for column in columns_to_replace:
            # Ensures we don't alter the intended operator precedence if there's additional
            # context surrounding the outer expression (i.e. it's not a simple projection).
            if isinstance(column.parent, (exp.Unary, exp.Binary)) and must_wrap_expression:
                expression = exp.paren(expression, copy=False)

            column.replace(expression.copy())


def _merge_where(outer_scope: Scope, inner_scope: Scope, from_or_join: FromOrJoin) -> None:
    """
    Merge WHERE clause of inner query into outer query.

    Args:
        outer_scope (sqlglot.optimizer.scope.Scope)
        inner_scope (sqlglot.optimizer.scope.Scope)
        from_or_join (exp.From|exp.Join)
    """
    where = inner_scope.expression.args.get("where")
    if not where or not where.this:
        return

    expression = outer_scope.expression

    if isinstance(from_or_join, exp.Join):
        # Merge predicates from an outer join to the ON clause
        # if it only has columns that are already joined
        from_ = expression.args.get("from")
        sources = {from_.alias_or_name} if from_ else set()

        for join in expression.args["joins"]:
            source = join.alias_or_name
            sources.add(source)
            if source == from_or_join.alias_or_name:
                break

        if exp.column_table_names(where.this) <= sources:
            from_or_join.on(where.this, copy=False)
            from_or_join.set("on", from_or_join.args.get("on"))
            return

    expression.where(where.this, copy=False)


def _merge_order(outer_scope: Scope, inner_scope: Scope) -> None:
    """
    Merge ORDER clause of inner query into outer query.

    Args:
        outer_scope (sqlglot.optimizer.scope.Scope)
        inner_scope (sqlglot.optimizer.scope.Scope)
    """
    if (
        any(
            outer_scope.expression.args.get(arg) for arg in ["group", "distinct", "having", "order"]
        )
        or len(outer_scope.selected_sources) != 1
        or any(expression.find(exp.AggFunc) for expression in outer_scope.expression.expressions)
    ):
        return

    outer_scope.expression.set("order", inner_scope.expression.args.get("order"))


def _merge_hints(outer_scope: Scope, inner_scope: Scope) -> None:
    inner_scope_hint = inner_scope.expression.args.get("hint")
    if not inner_scope_hint:
        return
    outer_scope_hint = outer_scope.expression.args.get("hint")
    if outer_scope_hint:
        for hint_expression in inner_scope_hint.expressions:
            outer_scope_hint.append("expressions", hint_expression)
    else:
        outer_scope.expression.set("hint", inner_scope_hint)


def _pop_cte(inner_scope: Scope) -> None:
    """
    Remove CTE from the AST.

    Args:
        inner_scope (sqlglot.optimizer.scope.Scope)
    """
    cte = inner_scope.expression.parent
    with_ = cte.parent
    if len(with_.expressions) == 1:
        with_.pop()
    else:
        cte.pop()
