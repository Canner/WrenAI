from sqlglot import expressions as exp
from sqlglot.optimizer.normalize import normalized
from sqlglot.optimizer.scope import Scope, traverse_scope


def eliminate_joins(expression):
    """
    Remove unused joins from an expression.

    This only removes joins when we know that the join condition doesn't produce duplicate rows.

    Example:
        >>> import sqlglot
        >>> sql = "SELECT x.a FROM x LEFT JOIN (SELECT DISTINCT y.b FROM y) AS y ON x.b = y.b"
        >>> expression = sqlglot.parse_one(sql)
        >>> eliminate_joins(expression).sql()
        'SELECT x.a FROM x'

    Args:
        expression (sqlglot.Expression): expression to optimize
    Returns:
        sqlglot.Expression: optimized expression
    """
    for scope in traverse_scope(expression):
        # If any columns in this scope aren't qualified, it's hard to determine if a join isn't used.
        # It's probably possible to infer this from the outputs of derived tables.
        # But for now, let's just skip this rule.
        if scope.unqualified_columns:
            continue

        joins = scope.expression.args.get("joins", [])

        # Reverse the joins so we can remove chains of unused joins
        for join in reversed(joins):
            alias = join.alias_or_name
            if _should_eliminate_join(scope, join, alias):
                join.pop()
                scope.remove_source(alias)
    return expression


def _should_eliminate_join(scope, join, alias):
    inner_source = scope.sources.get(alias)
    return (
        isinstance(inner_source, Scope)
        and not _join_is_used(scope, join, alias)
        and (
            (join.side == "LEFT" and _is_joined_on_all_unique_outputs(inner_source, join))
            or (not join.args.get("on") and _has_single_output_row(inner_source))
        )
    )


def _join_is_used(scope, join, alias):
    # We need to find all columns that reference this join.
    # But columns in the ON clause shouldn't count.
    on = join.args.get("on")
    if on:
        on_clause_columns = {id(column) for column in on.find_all(exp.Column)}
    else:
        on_clause_columns = set()
    return any(
        column for column in scope.source_columns(alias) if id(column) not in on_clause_columns
    )


def _is_joined_on_all_unique_outputs(scope, join):
    unique_outputs = _unique_outputs(scope)
    if not unique_outputs:
        return False

    _, join_keys, _ = join_condition(join)
    remaining_unique_outputs = unique_outputs - {c.name for c in join_keys}
    return not remaining_unique_outputs


def _unique_outputs(scope):
    """Determine output columns of `scope` that must have a unique combination per row"""
    if scope.expression.args.get("distinct"):
        return set(scope.expression.named_selects)

    group = scope.expression.args.get("group")
    if group:
        grouped_expressions = set(group.expressions)
        grouped_outputs = set()

        unique_outputs = set()
        for select in scope.expression.selects:
            output = select.unalias()
            if output in grouped_expressions:
                grouped_outputs.add(output)
                unique_outputs.add(select.alias_or_name)

        # All the grouped expressions must be in the output
        if not grouped_expressions.difference(grouped_outputs):
            return unique_outputs
        else:
            return set()

    if _has_single_output_row(scope):
        return set(scope.expression.named_selects)

    return set()


def _has_single_output_row(scope):
    return isinstance(scope.expression, exp.Select) and (
        all(isinstance(e.unalias(), exp.AggFunc) for e in scope.expression.selects)
        or _is_limit_1(scope)
        or not scope.expression.args.get("from")
    )


def _is_limit_1(scope):
    limit = scope.expression.args.get("limit")
    return limit and limit.expression.this == "1"


def join_condition(join):
    """
    Extract the join condition from a join expression.

    Args:
        join (exp.Join)
    Returns:
        tuple[list[str], list[str], exp.Expression]:
            Tuple of (source key, join key, remaining predicate)
    """
    name = join.alias_or_name
    on = (join.args.get("on") or exp.true()).copy()
    source_key = []
    join_key = []

    def extract_condition(condition):
        left, right = condition.unnest_operands()
        left_tables = exp.column_table_names(left)
        right_tables = exp.column_table_names(right)

        if name in left_tables and name not in right_tables:
            join_key.append(left)
            source_key.append(right)
            condition.replace(exp.true())
        elif name in right_tables and name not in left_tables:
            join_key.append(right)
            source_key.append(left)
            condition.replace(exp.true())

    # find the join keys
    # SELECT
    # FROM x
    # JOIN y
    #   ON x.a = y.b AND y.b > 1
    #
    # should pull y.b as the join key and x.a as the source key
    if normalized(on):
        on = on if isinstance(on, exp.And) else exp.and_(on, exp.true(), copy=False)

        for condition in on.flatten():
            if isinstance(condition, exp.EQ):
                extract_condition(condition)
    elif normalized(on, dnf=True):
        conditions = None

        for condition in on.flatten():
            parts = [part for part in condition.flatten() if isinstance(part, exp.EQ)]
            if conditions is None:
                conditions = parts
            else:
                temp = []
                for p in parts:
                    cs = [c for c in conditions if p == c]

                    if cs:
                        temp.append(p)
                        temp.extend(cs)
                conditions = temp

        for condition in conditions:
            extract_condition(condition)

    return source_key, join_key, on
