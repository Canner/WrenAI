from __future__ import annotations

from copy import copy
from typing import TYPE_CHECKING
from typing import Any
from typing import Callable
from typing import Sequence

from narwhals._expression_parsing import is_simple_aggregation
from narwhals._expression_parsing import parse_into_exprs
from narwhals.utils import remove_prefix

if TYPE_CHECKING:
    import dask.dataframe as dd

    try:
        import dask.dataframe.dask_expr as dx
    except ModuleNotFoundError:
        import dask_expr as dx

    import pandas as pd

    from narwhals._dask.dataframe import DaskLazyFrame
    from narwhals._dask.typing import IntoDaskExpr
    from narwhals.typing import CompliantExpr


def n_unique() -> dd.Aggregation:
    import dask.dataframe as dd

    def chunk(s: pd.core.groupby.generic.SeriesGroupBy) -> int:
        return s.nunique(dropna=False)  # type: ignore[no-any-return]

    def agg(s0: pd.core.groupby.generic.SeriesGroupBy) -> int:
        return s0.sum()  # type: ignore[no-any-return]

    return dd.Aggregation(
        name="nunique",
        chunk=chunk,
        agg=agg,
    )


def var(
    ddof: int = 1,
) -> Callable[
    [pd.core.groupby.generic.SeriesGroupBy], pd.core.groupby.generic.SeriesGroupBy
]:
    from functools import partial

    try:
        import dask.dataframe.dask_expr as dx
    except ModuleNotFoundError:
        import dask_expr as dx

    return partial(dx._groupby.GroupBy.var, ddof=ddof)


def std(
    ddof: int = 1,
) -> Callable[
    [pd.core.groupby.generic.SeriesGroupBy], pd.core.groupby.generic.SeriesGroupBy
]:
    from functools import partial

    try:
        import dask.dataframe.dask_expr as dx
    except ModuleNotFoundError:
        import dask_expr as dx

    return partial(dx._groupby.GroupBy.std, ddof=ddof)


POLARS_TO_DASK_AGGREGATIONS = {
    "sum": "sum",
    "mean": "mean",
    "median": "median",
    "max": "max",
    "min": "min",
    "std": std,
    "var": var,
    "len": "size",
    "n_unique": n_unique,
    "count": "count",
}


class DaskLazyGroupBy:
    def __init__(
        self, df: DaskLazyFrame, keys: list[str], *, drop_null_keys: bool
    ) -> None:
        self._df = df
        self._keys = keys
        self._grouped = self._df._native_frame.groupby(
            list(self._keys),
            dropna=drop_null_keys,
            observed=True,
        )

    def agg(
        self,
        *aggs: IntoDaskExpr,
        **named_aggs: IntoDaskExpr,
    ) -> DaskLazyFrame:
        exprs = parse_into_exprs(
            *aggs,
            namespace=self._df.__narwhals_namespace__(),
            **named_aggs,
        )
        output_names: list[str] = copy(self._keys)
        for expr in exprs:
            if expr._output_names is None:
                msg = (
                    "Anonymous expressions are not supported in group_by.agg.\n"
                    "Instead of `nw.all()`, try using a named expression, such as "
                    "`nw.col('a', 'b')`\n"
                )
                raise ValueError(msg)

            output_names.extend(expr._output_names)

        return agg_dask(
            self._df,
            self._grouped,
            exprs,
            self._keys,
            self._from_native_frame,
        )

    def _from_native_frame(self, df: DaskLazyFrame) -> DaskLazyFrame:
        from narwhals._dask.dataframe import DaskLazyFrame

        return DaskLazyFrame(
            df, backend_version=self._df._backend_version, version=self._df._version
        )


def agg_dask(
    df: DaskLazyFrame,
    grouped: Any,
    exprs: Sequence[CompliantExpr[dx.Series]],
    keys: list[str],
    from_dataframe: Callable[[Any], DaskLazyFrame],
) -> DaskLazyFrame:
    """This should be the fastpath, but cuDF is too far behind to use it.

    - https://github.com/rapidsai/cudf/issues/15118
    - https://github.com/rapidsai/cudf/issues/15084
    """
    if not exprs:
        # No aggregation provided
        return df.select(*keys).unique(subset=keys)

    all_simple_aggs = True
    for expr in exprs:
        if not (
            is_simple_aggregation(expr)
            and remove_prefix(expr._function_name, "col->") in POLARS_TO_DASK_AGGREGATIONS
        ):
            all_simple_aggs = False
            break

    if all_simple_aggs:
        simple_aggregations: dict[str, tuple[str, str | dd.Aggregation]] = {}
        for expr in exprs:
            if expr._depth == 0:
                # e.g. agg(nw.len()) # noqa: ERA001
                if expr._output_names is None:  # pragma: no cover
                    msg = "Safety assertion failed, please report a bug to https://github.com/narwhals-dev/narwhals/issues"
                    raise AssertionError(msg)

                function_name = POLARS_TO_DASK_AGGREGATIONS.get(
                    expr._function_name, expr._function_name
                )
                simple_aggregations.update(
                    {
                        output_name: (keys[0], function_name)
                        for output_name in expr._output_names
                    }
                )
                continue

            # e.g. agg(nw.mean('a')) # noqa: ERA001
            if (
                expr._depth != 1 or expr._root_names is None or expr._output_names is None
            ):  # pragma: no cover
                msg = "Safety assertion failed, please report a bug to https://github.com/narwhals-dev/narwhals/issues"
                raise AssertionError(msg)

            function_name = remove_prefix(expr._function_name, "col->")
            kwargs = (
                {"ddof": expr._kwargs["ddof"]} if function_name in {"std", "var"} else {}
            )

            agg_function = POLARS_TO_DASK_AGGREGATIONS.get(function_name, function_name)
            # deal with n_unique case in a "lazy" mode to not depend on dask globally
            agg_function = (
                agg_function(**kwargs) if callable(agg_function) else agg_function
            )

            simple_aggregations.update(
                {
                    output_name: (root_name, agg_function)
                    for root_name, output_name in zip(
                        expr._root_names, expr._output_names
                    )
                }
            )
        result_simple = grouped.agg(**simple_aggregations)
        return from_dataframe(result_simple.reset_index())

    msg = (
        "Non-trivial complex aggregation found.\n\n"
        "Hint: you were probably trying to apply a non-elementary aggregation with a "
        "dask dataframe.\n"
        "Please rewrite your query such that group-by aggregations "
        "are elementary. For example, instead of:\n\n"
        "    df.group_by('a').agg(nw.col('b').round(2).mean())\n\n"
        "use:\n\n"
        "    df.with_columns(nw.col('b').round(2)).group_by('a').agg(nw.col('b').mean())\n\n"
    )
    raise ValueError(msg)
