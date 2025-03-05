from __future__ import annotations

import itertools
import typing as t

from sqlglot import expressions as exp
from sqlglot.helper import find_new_name
from sqlglot.optimizer.scope import Scope, build_scope

if t.TYPE_CHECKING:
    ExistingCTEsMapping = t.Dict[exp.Expression, str]
    TakenNameMapping = t.Dict[str, t.Union[Scope, exp.Expression]]


def eliminate_subqueries(expression: exp.Expression) -> exp.Expression:
    """
    Rewrite derived tables as CTES, deduplicating if possible.

    Example:
        >>> import sqlglot
        >>> expression = sqlglot.parse_one("SELECT a FROM (SELECT * FROM x) AS y")
        >>> eliminate_subqueries(expression).sql()
        'WITH y AS (SELECT * FROM x) SELECT a FROM y AS y'

    This also deduplicates common subqueries:
        >>> expression = sqlglot.parse_one("SELECT a FROM (SELECT * FROM x) AS y CROSS JOIN (SELECT * FROM x) AS z")
        >>> eliminate_subqueries(expression).sql()
        'WITH y AS (SELECT * FROM x) SELECT a FROM y AS y CROSS JOIN y AS z'

    Args:
        expression (sqlglot.Expression): expression
    Returns:
        sqlglot.Expression: expression
    """
    if isinstance(expression, exp.Subquery):
        # It's possible to have subqueries at the root, e.g. (SELECT * FROM x) LIMIT 1
        eliminate_subqueries(expression.this)
        return expression

    root = build_scope(expression)

    if not root:
        return expression

    # Map of alias->Scope|Table
    # These are all aliases that are already used in the expression.
    # We don't want to create new CTEs that conflict with these names.
    taken: TakenNameMapping = {}

    # All CTE aliases in the root scope are taken
    for scope in root.cte_scopes:
        taken[scope.expression.parent.alias] = scope

    # All table names are taken
    for scope in root.traverse():
        taken.update(
            {
                source.name: source
                for _, source in scope.sources.items()
                if isinstance(source, exp.Table)
            }
        )

    # Map of Expression->alias
    # Existing CTES in the root expression. We'll use this for deduplication.
    existing_ctes: ExistingCTEsMapping = {}

    with_ = root.expression.args.get("with")
    recursive = False
    if with_:
        recursive = with_.args.get("recursive")
        for cte in with_.expressions:
            existing_ctes[cte.this] = cte.alias
    new_ctes = []

    # We're adding more CTEs, but we want to maintain the DAG order.
    # Derived tables within an existing CTE need to come before the existing CTE.
    for cte_scope in root.cte_scopes:
        # Append all the new CTEs from this existing CTE
        for scope in cte_scope.traverse():
            if scope is cte_scope:
                # Don't try to eliminate this CTE itself
                continue
            new_cte = _eliminate(scope, existing_ctes, taken)
            if new_cte:
                new_ctes.append(new_cte)

        # Append the existing CTE itself
        new_ctes.append(cte_scope.expression.parent)

    # Now append the rest
    for scope in itertools.chain(root.union_scopes, root.subquery_scopes, root.table_scopes):
        for child_scope in scope.traverse():
            new_cte = _eliminate(child_scope, existing_ctes, taken)
            if new_cte:
                new_ctes.append(new_cte)

    if new_ctes:
        query = expression.expression if isinstance(expression, exp.DDL) else expression
        query.set("with", exp.With(expressions=new_ctes, recursive=recursive))

    return expression


def _eliminate(
    scope: Scope, existing_ctes: ExistingCTEsMapping, taken: TakenNameMapping
) -> t.Optional[exp.Expression]:
    if scope.is_derived_table:
        return _eliminate_derived_table(scope, existing_ctes, taken)

    if scope.is_cte:
        return _eliminate_cte(scope, existing_ctes, taken)

    return None


def _eliminate_derived_table(
    scope: Scope, existing_ctes: ExistingCTEsMapping, taken: TakenNameMapping
) -> t.Optional[exp.Expression]:
    # This makes sure that we don't:
    # - drop the "pivot" arg from a pivoted subquery
    # - eliminate a lateral correlated subquery
    if scope.parent.pivots or isinstance(scope.parent.expression, exp.Lateral):
        return None

    # Get rid of redundant exp.Subquery expressions, i.e. those that are just used as wrappers
    to_replace = scope.expression.parent.unwrap()
    name, cte = _new_cte(scope, existing_ctes, taken)
    table = exp.alias_(exp.table_(name), alias=to_replace.alias or name)
    table.set("joins", to_replace.args.get("joins"))

    to_replace.replace(table)

    return cte


def _eliminate_cte(
    scope: Scope, existing_ctes: ExistingCTEsMapping, taken: TakenNameMapping
) -> t.Optional[exp.Expression]:
    parent = scope.expression.parent
    name, cte = _new_cte(scope, existing_ctes, taken)

    with_ = parent.parent
    parent.pop()
    if not with_.expressions:
        with_.pop()

    # Rename references to this CTE
    for child_scope in scope.parent.traverse():
        for table, source in child_scope.selected_sources.values():
            if source is scope:
                new_table = exp.alias_(exp.table_(name), alias=table.alias_or_name, copy=False)
                table.replace(new_table)

    return cte


def _new_cte(
    scope: Scope, existing_ctes: ExistingCTEsMapping, taken: TakenNameMapping
) -> t.Tuple[str, t.Optional[exp.Expression]]:
    """
    Returns:
        tuple of (name, cte)
        where `name` is a new name for this CTE in the root scope and `cte` is a new CTE instance.
        If this CTE duplicates an existing CTE, `cte` will be None.
    """
    duplicate_cte_alias = existing_ctes.get(scope.expression)
    parent = scope.expression.parent
    name = parent.alias

    if not name:
        name = find_new_name(taken=taken, base="cte")

    if duplicate_cte_alias:
        name = duplicate_cte_alias
    elif taken.get(name):
        name = find_new_name(taken=taken, base=name)

    taken[name] = scope

    if not duplicate_cte_alias:
        existing_ctes[scope.expression] = name
        cte = exp.CTE(
            this=scope.expression,
            alias=exp.TableAlias(this=exp.to_identifier(name)),
        )
    else:
        cte = None
    return name, cte
