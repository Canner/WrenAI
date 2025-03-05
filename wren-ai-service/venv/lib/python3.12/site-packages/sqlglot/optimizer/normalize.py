from __future__ import annotations

import logging

from sqlglot import exp
from sqlglot.errors import OptimizeError
from sqlglot.helper import while_changing
from sqlglot.optimizer.scope import find_all_in_scope
from sqlglot.optimizer.simplify import flatten, rewrite_between, uniq_sort

logger = logging.getLogger("sqlglot")


def normalize(expression: exp.Expression, dnf: bool = False, max_distance: int = 128):
    """
    Rewrite sqlglot AST into conjunctive normal form or disjunctive normal form.

    Example:
        >>> import sqlglot
        >>> expression = sqlglot.parse_one("(x AND y) OR z")
        >>> normalize(expression, dnf=False).sql()
        '(x OR z) AND (y OR z)'

    Args:
        expression: expression to normalize
        dnf: rewrite in disjunctive normal form instead.
        max_distance (int): the maximal estimated distance from cnf/dnf to attempt conversion
    Returns:
        sqlglot.Expression: normalized expression
    """
    for node in tuple(expression.walk(prune=lambda e: isinstance(e, exp.Connector))):
        if isinstance(node, exp.Connector):
            if normalized(node, dnf=dnf):
                continue
            root = node is expression
            original = node.copy()

            node.transform(rewrite_between, copy=False)
            distance = normalization_distance(node, dnf=dnf, max_=max_distance)

            if distance > max_distance:
                logger.info(
                    f"Skipping normalization because distance {distance} exceeds max {max_distance}"
                )
                return expression

            try:
                node = node.replace(
                    while_changing(node, lambda e: distributive_law(e, dnf, max_distance))
                )
            except OptimizeError as e:
                logger.info(e)
                node.replace(original)
                if root:
                    return original
                return expression

            if root:
                expression = node

    return expression


def normalized(expression: exp.Expression, dnf: bool = False) -> bool:
    """
    Checks whether a given expression is in a normal form of interest.

    Example:
        >>> from sqlglot import parse_one
        >>> normalized(parse_one("(a AND b) OR c OR (d AND e)"), dnf=True)
        True
        >>> normalized(parse_one("(a OR b) AND c"))  # Checks CNF by default
        True
        >>> normalized(parse_one("a AND (b OR c)"), dnf=True)
        False

    Args:
        expression: The expression to check if it's normalized.
        dnf: Whether to check if the expression is in Disjunctive Normal Form (DNF).
            Default: False, i.e. we check if it's in Conjunctive Normal Form (CNF).
    """
    ancestor, root = (exp.And, exp.Or) if dnf else (exp.Or, exp.And)
    return not any(
        connector.find_ancestor(ancestor) for connector in find_all_in_scope(expression, root)
    )


def normalization_distance(
    expression: exp.Expression, dnf: bool = False, max_: float = float("inf")
) -> int:
    """
    The difference in the number of predicates between a given expression and its normalized form.

    This is used as an estimate of the cost of the conversion which is exponential in complexity.

    Example:
        >>> import sqlglot
        >>> expression = sqlglot.parse_one("(a AND b) OR (c AND d)")
        >>> normalization_distance(expression)
        4

    Args:
        expression: The expression to compute the normalization distance for.
        dnf: Whether to check if the expression is in Disjunctive Normal Form (DNF).
            Default: False, i.e. we check if it's in Conjunctive Normal Form (CNF).
        max_: stop early if count exceeds this.

    Returns:
        The normalization distance.
    """
    total = -(sum(1 for _ in expression.find_all(exp.Connector)) + 1)

    for length in _predicate_lengths(expression, dnf, max_):
        total += length
        if total > max_:
            return total

    return total


def _predicate_lengths(expression, dnf, max_=float("inf"), depth=0):
    """
    Returns a list of predicate lengths when expanded to normalized form.

    (A AND B) OR C -> [2, 2] because len(A OR C), len(B OR C).
    """
    if depth > max_:
        yield depth
        return

    expression = expression.unnest()

    if not isinstance(expression, exp.Connector):
        yield 1
        return

    depth += 1
    left, right = expression.args.values()

    if isinstance(expression, exp.And if dnf else exp.Or):
        for a in _predicate_lengths(left, dnf, max_, depth):
            for b in _predicate_lengths(right, dnf, max_, depth):
                yield a + b
    else:
        yield from _predicate_lengths(left, dnf, max_, depth)
        yield from _predicate_lengths(right, dnf, max_, depth)


def distributive_law(expression, dnf, max_distance):
    """
    x OR (y AND z) -> (x OR y) AND (x OR z)
    (x AND y) OR (y AND z) -> (x OR y) AND (x OR z) AND (y OR y) AND (y OR z)
    """
    if normalized(expression, dnf=dnf):
        return expression

    distance = normalization_distance(expression, dnf=dnf, max_=max_distance)

    if distance > max_distance:
        raise OptimizeError(f"Normalization distance {distance} exceeds max {max_distance}")

    exp.replace_children(expression, lambda e: distributive_law(e, dnf, max_distance))
    to_exp, from_exp = (exp.Or, exp.And) if dnf else (exp.And, exp.Or)

    if isinstance(expression, from_exp):
        a, b = expression.unnest_operands()

        from_func = exp.and_ if from_exp == exp.And else exp.or_
        to_func = exp.and_ if to_exp == exp.And else exp.or_

        if isinstance(a, to_exp) and isinstance(b, to_exp):
            if len(tuple(a.find_all(exp.Connector))) > len(tuple(b.find_all(exp.Connector))):
                return _distribute(a, b, from_func, to_func)
            return _distribute(b, a, from_func, to_func)
        if isinstance(a, to_exp):
            return _distribute(b, a, from_func, to_func)
        if isinstance(b, to_exp):
            return _distribute(a, b, from_func, to_func)

    return expression


def _distribute(a, b, from_func, to_func):
    if isinstance(a, exp.Connector):
        exp.replace_children(
            a,
            lambda c: to_func(
                uniq_sort(flatten(from_func(c, b.left))),
                uniq_sort(flatten(from_func(c, b.right))),
                copy=False,
            ),
        )
    else:
        a = to_func(
            uniq_sort(flatten(from_func(a, b.left))),
            uniq_sort(flatten(from_func(a, b.right))),
            copy=False,
        )

    return a
