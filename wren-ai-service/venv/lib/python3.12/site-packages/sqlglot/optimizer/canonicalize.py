from __future__ import annotations

import itertools
import typing as t

from sqlglot import exp
from sqlglot.dialects.dialect import Dialect, DialectType
from sqlglot.helper import is_date_unit, is_iso_date, is_iso_datetime
from sqlglot.optimizer.annotate_types import TypeAnnotator


def canonicalize(expression: exp.Expression, dialect: DialectType = None) -> exp.Expression:
    """Converts a sql expression into a standard form.

    This method relies on annotate_types because many of the
    conversions rely on type inference.

    Args:
        expression: The expression to canonicalize.
    """

    dialect = Dialect.get_or_raise(dialect)

    def _canonicalize(expression: exp.Expression) -> exp.Expression:
        expression = add_text_to_concat(expression)
        expression = replace_date_funcs(expression)
        expression = coerce_type(expression, dialect.PROMOTE_TO_INFERRED_DATETIME_TYPE)
        expression = remove_redundant_casts(expression)
        expression = ensure_bools(expression, _replace_int_predicate)
        expression = remove_ascending_order(expression)
        return expression

    return exp.replace_tree(expression, _canonicalize)


def add_text_to_concat(node: exp.Expression) -> exp.Expression:
    if isinstance(node, exp.Add) and node.type and node.type.this in exp.DataType.TEXT_TYPES:
        node = exp.Concat(expressions=[node.left, node.right])
    return node


def replace_date_funcs(node: exp.Expression) -> exp.Expression:
    if (
        isinstance(node, (exp.Date, exp.TsOrDsToDate))
        and not node.expressions
        and not node.args.get("zone")
        and node.this.is_string
        and is_iso_date(node.this.name)
    ):
        return exp.cast(node.this, to=exp.DataType.Type.DATE)
    if isinstance(node, exp.Timestamp) and not node.args.get("zone"):
        if not node.type:
            from sqlglot.optimizer.annotate_types import annotate_types

            node = annotate_types(node)
        return exp.cast(node.this, to=node.type or exp.DataType.Type.TIMESTAMP)

    return node


COERCIBLE_DATE_OPS = (
    exp.Add,
    exp.Sub,
    exp.EQ,
    exp.NEQ,
    exp.GT,
    exp.GTE,
    exp.LT,
    exp.LTE,
    exp.NullSafeEQ,
    exp.NullSafeNEQ,
)


def coerce_type(node: exp.Expression, promote_to_inferred_datetime_type: bool) -> exp.Expression:
    if isinstance(node, COERCIBLE_DATE_OPS):
        _coerce_date(node.left, node.right, promote_to_inferred_datetime_type)
    elif isinstance(node, exp.Between):
        _coerce_date(node.this, node.args["low"], promote_to_inferred_datetime_type)
    elif isinstance(node, exp.Extract) and not node.expression.type.is_type(
        *exp.DataType.TEMPORAL_TYPES
    ):
        _replace_cast(node.expression, exp.DataType.Type.DATETIME)
    elif isinstance(node, (exp.DateAdd, exp.DateSub, exp.DateTrunc)):
        _coerce_timeunit_arg(node.this, node.unit)
    elif isinstance(node, exp.DateDiff):
        _coerce_datediff_args(node)

    return node


def remove_redundant_casts(expression: exp.Expression) -> exp.Expression:
    if (
        isinstance(expression, exp.Cast)
        and expression.this.type
        and expression.to.this == expression.this.type.this
    ):
        return expression.this
    if (
        isinstance(expression, (exp.Date, exp.TsOrDsToDate))
        and expression.this.type
        and expression.this.type.this == exp.DataType.Type.DATE
    ):
        return expression.this
    return expression


def ensure_bools(
    expression: exp.Expression, replace_func: t.Callable[[exp.Expression], None]
) -> exp.Expression:
    if isinstance(expression, exp.Connector):
        replace_func(expression.left)
        replace_func(expression.right)
    elif isinstance(expression, exp.Not):
        replace_func(expression.this)
        # We can't replace num in CASE x WHEN num ..., because it's not the full predicate
    elif isinstance(expression, exp.If) and not (
        isinstance(expression.parent, exp.Case) and expression.parent.this
    ):
        replace_func(expression.this)
    elif isinstance(expression, (exp.Where, exp.Having)):
        replace_func(expression.this)

    return expression


def remove_ascending_order(expression: exp.Expression) -> exp.Expression:
    if isinstance(expression, exp.Ordered) and expression.args.get("desc") is False:
        # Convert ORDER BY a ASC to ORDER BY a
        expression.set("desc", None)

    return expression


def _coerce_date(
    a: exp.Expression,
    b: exp.Expression,
    promote_to_inferred_datetime_type: bool,
) -> None:
    for a, b in itertools.permutations([a, b]):
        if isinstance(b, exp.Interval):
            a = _coerce_timeunit_arg(a, b.unit)

        a_type = a.type
        if (
            not a_type
            or a_type.this not in exp.DataType.TEMPORAL_TYPES
            or not b.type
            or b.type.this not in exp.DataType.TEXT_TYPES
        ):
            continue

        if promote_to_inferred_datetime_type:
            if b.is_string:
                date_text = b.name
                if is_iso_date(date_text):
                    b_type = exp.DataType.Type.DATE
                elif is_iso_datetime(date_text):
                    b_type = exp.DataType.Type.DATETIME
                else:
                    b_type = a_type.this
            else:
                # If b is not a datetime string, we conservatively promote it to a DATETIME,
                # in order to ensure there are no surprising truncations due to downcasting
                b_type = exp.DataType.Type.DATETIME

            target_type = (
                b_type if b_type in TypeAnnotator.COERCES_TO.get(a_type.this, {}) else a_type
            )
        else:
            target_type = a_type

        if target_type != a_type:
            _replace_cast(a, target_type)

        _replace_cast(b, target_type)


def _coerce_timeunit_arg(arg: exp.Expression, unit: t.Optional[exp.Expression]) -> exp.Expression:
    if not arg.type:
        return arg

    if arg.type.this in exp.DataType.TEXT_TYPES:
        date_text = arg.name
        is_iso_date_ = is_iso_date(date_text)

        if is_iso_date_ and is_date_unit(unit):
            return arg.replace(exp.cast(arg.copy(), to=exp.DataType.Type.DATE))

        # An ISO date is also an ISO datetime, but not vice versa
        if is_iso_date_ or is_iso_datetime(date_text):
            return arg.replace(exp.cast(arg.copy(), to=exp.DataType.Type.DATETIME))

    elif arg.type.this == exp.DataType.Type.DATE and not is_date_unit(unit):
        return arg.replace(exp.cast(arg.copy(), to=exp.DataType.Type.DATETIME))

    return arg


def _coerce_datediff_args(node: exp.DateDiff) -> None:
    for e in (node.this, node.expression):
        if e.type.this not in exp.DataType.TEMPORAL_TYPES:
            e.replace(exp.cast(e.copy(), to=exp.DataType.Type.DATETIME))


def _replace_cast(node: exp.Expression, to: exp.DATA_TYPE) -> None:
    node.replace(exp.cast(node.copy(), to=to))


# this was originally designed for presto, there is a similar transform for tsql
# this is different in that it only operates on int types, this is because
# presto has a boolean type whereas tsql doesn't (people use bits)
# with y as (select true as x) select x = 0 FROM y -- illegal presto query
def _replace_int_predicate(expression: exp.Expression) -> None:
    if isinstance(expression, exp.Coalesce):
        for child in expression.iter_expressions():
            _replace_int_predicate(child)
    elif expression.type and expression.type.this in exp.DataType.INTEGER_TYPES:
        expression.replace(expression.neq(0))
