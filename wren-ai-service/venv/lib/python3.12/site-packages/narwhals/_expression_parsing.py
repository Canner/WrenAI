# Utilities for expression parsing
# Useful for backends which don't have any concept of expressions, such
# and pandas or PyArrow.
from __future__ import annotations

from copy import copy
from typing import TYPE_CHECKING
from typing import Any
from typing import Sequence
from typing import TypeVar
from typing import Union
from typing import cast
from typing import overload

from narwhals.dependencies import is_numpy_array
from narwhals.exceptions import InvalidIntoExprError
from narwhals.utils import Implementation

if TYPE_CHECKING:
    from typing_extensions import TypeAlias

    from narwhals._arrow.expr import ArrowExpr
    from narwhals._pandas_like.expr import PandasLikeExpr
    from narwhals.typing import CompliantDataFrame
    from narwhals.typing import CompliantExpr
    from narwhals.typing import CompliantLazyFrame
    from narwhals.typing import CompliantNamespace
    from narwhals.typing import CompliantSeries
    from narwhals.typing import CompliantSeriesT_co

    IntoCompliantExpr: TypeAlias = (
        CompliantExpr[CompliantSeriesT_co] | str | CompliantSeriesT_co
    )
    CompliantExprT = TypeVar("CompliantExprT", bound=CompliantExpr[Any])

    ArrowOrPandasLikeExpr = TypeVar(
        "ArrowOrPandasLikeExpr", bound=Union[ArrowExpr, PandasLikeExpr]
    )
    PandasLikeExprT = TypeVar("PandasLikeExprT", bound=PandasLikeExpr)
    ArrowExprT = TypeVar("ArrowExprT", bound=ArrowExpr)

    T = TypeVar("T")


def evaluate_into_expr(
    df: CompliantDataFrame | CompliantLazyFrame,
    into_expr: IntoCompliantExpr[CompliantSeriesT_co],
) -> Sequence[CompliantSeriesT_co]:
    """Return list of raw columns."""
    expr = parse_into_expr(into_expr, namespace=df.__narwhals_namespace__())
    return expr(df)


def evaluate_into_exprs(
    df: CompliantDataFrame,
    *exprs: IntoCompliantExpr[CompliantSeriesT_co],
    **named_exprs: IntoCompliantExpr[CompliantSeriesT_co],
) -> Sequence[CompliantSeriesT_co]:
    """Evaluate each expr into Series."""
    series = [
        item
        for sublist in (evaluate_into_expr(df, into_expr) for into_expr in exprs)
        for item in sublist
    ]
    for name, expr in named_exprs.items():
        evaluated_expr = evaluate_into_expr(df, expr)
        if len(evaluated_expr) > 1:
            msg = "Named expressions must return a single column"  # pragma: no cover
            raise AssertionError(msg)
        to_append = evaluated_expr[0].alias(name)
        series.append(to_append)
    return series


def maybe_evaluate_expr(
    df: CompliantDataFrame, expr: CompliantExpr[CompliantSeriesT_co] | T
) -> Sequence[CompliantSeriesT_co] | T:
    """Evaluate `expr` if it's an expression, otherwise return it as is."""
    if hasattr(expr, "__narwhals_expr__"):
        compliant_expr = cast("CompliantExpr[Any]", expr)
        return compliant_expr(df)
    return expr


def parse_into_exprs(
    *exprs: IntoCompliantExpr[CompliantSeriesT_co],
    namespace: CompliantNamespace[CompliantSeriesT_co],
    **named_exprs: IntoCompliantExpr[CompliantSeriesT_co],
) -> Sequence[CompliantExpr[CompliantSeriesT_co]]:
    """Parse each input as an expression (if it's not already one).

    See `parse_into_expr` for more details.
    """
    return [parse_into_expr(into_expr, namespace=namespace) for into_expr in exprs] + [
        parse_into_expr(expr, namespace=namespace).alias(name)
        for name, expr in named_exprs.items()
    ]


def parse_into_expr(
    into_expr: IntoCompliantExpr[CompliantSeriesT_co],
    *,
    namespace: CompliantNamespace[CompliantSeriesT_co],
) -> CompliantExpr[CompliantSeriesT_co]:
    """Parse `into_expr` as an expression.

    For example, in Polars, we can do both `df.select('a')` and `df.select(pl.col('a'))`.
    We do the same in Narwhals:

    - if `into_expr` is already an expression, just return it
    - if it's a Series, then convert it to an expression
    - if it's a numpy array, then convert it to a Series and then to an expression
    - if it's a string, then convert it to an expression
    - else, raise
    """
    if hasattr(into_expr, "__narwhals_expr__"):
        return into_expr  # type: ignore[return-value]
    if hasattr(into_expr, "__narwhals_series__"):
        return namespace._create_expr_from_series(into_expr)  # type: ignore[no-any-return, attr-defined]
    if isinstance(into_expr, str):
        return namespace.col(into_expr)
    if is_numpy_array(into_expr):
        series = namespace._create_compliant_series(into_expr)
        return namespace._create_expr_from_series(series)
    raise InvalidIntoExprError.from_invalid_type(type(into_expr))


def infer_new_root_output_names(
    expr: CompliantExpr[Any], **kwargs: Any
) -> tuple[list[str] | None, list[str] | None]:
    """Return new root and output names after chaining expressions.

    Try tracking root and output names by combining them from all expressions appearing in kwargs.
    If any anonymous expression appears (e.g. nw.all()), then give up on tracking root names
    and just set it to None.
    """
    root_names = copy(expr._root_names)
    output_names = expr._output_names
    for arg in list(kwargs.values()):
        if root_names is not None and isinstance(arg, expr.__class__):
            if arg._root_names is not None:
                root_names.extend(arg._root_names)
            else:
                root_names = None
                output_names = None
                break
        elif root_names is None:
            output_names = None
            break

    if not (
        (output_names is None and root_names is None)
        or (output_names is not None and root_names is not None)
    ):  # pragma: no cover
        msg = "Safety assertion failed, please report a bug to https://github.com/narwhals-dev/narwhals/issues"
        raise AssertionError(msg)
    return root_names, output_names


@overload
def reuse_series_implementation(
    expr: PandasLikeExprT,
    attr: str,
    *,
    returns_scalar: bool = False,
    **kwargs: Any,
) -> PandasLikeExprT: ...


@overload
def reuse_series_implementation(
    expr: ArrowExprT,
    attr: str,
    *,
    returns_scalar: bool = False,
    **kwargs: Any,
) -> ArrowExprT: ...


def reuse_series_implementation(
    expr: ArrowExprT | PandasLikeExprT,
    attr: str,
    *,
    returns_scalar: bool = False,
    **kwargs: Any,
) -> ArrowExprT | PandasLikeExprT:
    """Reuse Series implementation for expression.

    If Series.foo is already defined, and we'd like Expr.foo to be the same, we can
    leverage this method to do that for us.

    Arguments:
        expr: expression object.
        attr: name of method.
        returns_scalar: whether the Series version returns a scalar. In this case,
            the expression version should return a 1-row Series.
        args: arguments to pass to function.
        kwargs: keyword arguments to pass to function.
    """
    plx = expr.__narwhals_namespace__()

    def func(df: CompliantDataFrame) -> Sequence[CompliantSeries]:
        _kwargs = {  # type: ignore[var-annotated]
            arg_name: maybe_evaluate_expr(df, arg_value)
            for arg_name, arg_value in kwargs.items()
        }

        # For PyArrow.Series, we return Python Scalars (like Polars does) instead of PyArrow Scalars.
        # However, when working with expressions, we keep everything PyArrow-native.
        extra_kwargs = (
            {"_return_py_scalar": False}
            if returns_scalar and expr._implementation is Implementation.PYARROW
            else {}
        )

        out: list[CompliantSeries] = [
            plx._create_series_from_scalar(
                getattr(series, attr)(**extra_kwargs, **_kwargs),
                reference_series=series,  # type: ignore[arg-type]
            )
            if returns_scalar
            else getattr(series, attr)(**_kwargs)
            for series in expr(df)  # type: ignore[arg-type]
        ]
        if expr._output_names is not None and (
            [s.name for s in out] != expr._output_names
        ):  # pragma: no cover
            msg = (
                f"Safety assertion failed, please report a bug to https://github.com/narwhals-dev/narwhals/issues\n"
                f"Expression output names: {expr._output_names}\n"
                f"Series names: {[s.name for s in out]}"
            )
            raise AssertionError(msg)
        return out

    root_names, output_names = infer_new_root_output_names(expr, **kwargs)

    return plx._create_expr_from_callable(  # type: ignore[return-value]
        func,  # type: ignore[arg-type]
        depth=expr._depth + 1,
        function_name=f"{expr._function_name}->{attr}",
        root_names=root_names,
        output_names=output_names,
        kwargs={**expr._kwargs, **kwargs},
    )


@overload
def reuse_series_namespace_implementation(
    expr: ArrowExprT, series_namespace: str, attr: str, **kwargs: Any
) -> ArrowExprT: ...
@overload
def reuse_series_namespace_implementation(
    expr: PandasLikeExprT, series_namespace: str, attr: str, **kwargs: Any
) -> PandasLikeExprT: ...
def reuse_series_namespace_implementation(
    expr: ArrowExprT | PandasLikeExprT,
    series_namespace: str,
    attr: str,
    **kwargs: Any,
) -> ArrowExprT | PandasLikeExprT:
    """Reuse Series implementation for expression.

    Just like `reuse_series_implementation`, but for e.g. `Expr.dt.foo` instead
    of `Expr.foo`.

    Arguments:
        expr: expression object.
        series_namespace: The Series namespace (e.g. `dt`, `cat`, `str`, `list`, `name`)
        attr: name of method.
        args: arguments to pass to function.
        kwargs: keyword arguments to pass to function.
    """
    plx = expr.__narwhals_namespace__()
    return plx._create_expr_from_callable(  # type: ignore[return-value]
        lambda df: [
            getattr(getattr(series, series_namespace), attr)(**kwargs)
            for series in expr(df)  # type: ignore[arg-type]
        ],
        depth=expr._depth + 1,
        function_name=f"{expr._function_name}->{series_namespace}.{attr}",
        root_names=expr._root_names,
        output_names=expr._output_names,
        kwargs={**expr._kwargs, **kwargs},
    )


def is_simple_aggregation(expr: CompliantExpr[Any]) -> bool:
    """Check if expr is a very simple one.

    Examples:
        - nw.col('a').mean()  # depth 1
        - nw.mean('a')  # depth 1
        - nw.len()  # depth 0

    as opposed to, say

        - nw.col('a').filter(nw.col('b')>nw.col('c')).max()

    because then, we can use a fastpath in pandas.
    """
    return expr._depth < 2


def combine_root_names(parsed_exprs: Sequence[CompliantExpr[Any]]) -> list[str] | None:
    root_names = copy(parsed_exprs[0]._root_names)
    for arg in parsed_exprs[1:]:
        if root_names is not None:
            if arg._root_names is not None:
                root_names.extend(arg._root_names)
            else:
                root_names = None
                break
    return root_names


def reduce_output_names(parsed_exprs: Sequence[CompliantExpr[Any]]) -> list[str] | None:
    """Returns the left-most output name."""
    return (
        parsed_exprs[0]._output_names[:1]
        if parsed_exprs[0]._output_names is not None
        else None
    )


def extract_compliant(
    plx: CompliantNamespace[CompliantSeriesT_co], other: Any
) -> CompliantExpr[CompliantSeriesT_co] | CompliantSeriesT_co | Any:
    from narwhals.expr import Expr
    from narwhals.series import Series

    if isinstance(other, Expr):
        return other._to_compliant_expr(plx)
    if isinstance(other, Series):
        return other._compliant_series
    return other
