from __future__ import annotations

import collections
import warnings
from copy import copy
from typing import TYPE_CHECKING
from typing import Any
from typing import Callable
from typing import Iterator
from typing import Sequence

from narwhals._expression_parsing import is_simple_aggregation
from narwhals._expression_parsing import parse_into_exprs
from narwhals._pandas_like.utils import horizontal_concat
from narwhals._pandas_like.utils import native_series_from_iterable
from narwhals._pandas_like.utils import select_columns_by_name
from narwhals._pandas_like.utils import set_columns
from narwhals.utils import Implementation
from narwhals.utils import find_stacklevel
from narwhals.utils import remove_prefix

if TYPE_CHECKING:
    from narwhals._pandas_like.dataframe import PandasLikeDataFrame
    from narwhals._pandas_like.series import PandasLikeSeries
    from narwhals._pandas_like.typing import IntoPandasLikeExpr
    from narwhals.typing import CompliantExpr

POLARS_TO_PANDAS_AGGREGATIONS = {
    "sum": "sum",
    "mean": "mean",
    "median": "median",
    "max": "max",
    "min": "min",
    "std": "std",
    "var": "var",
    "len": "size",
    "n_unique": "nunique",
    "count": "count",
}


class PandasLikeGroupBy:
    def __init__(
        self, df: PandasLikeDataFrame, keys: list[str], *, drop_null_keys: bool
    ) -> None:
        self._df = df
        self._keys = keys
        if (
            self._df._implementation is Implementation.PANDAS
            and self._df._backend_version < (1, 1)
        ):  # pragma: no cover
            if (
                not drop_null_keys
                and select_columns_by_name(
                    self._df._native_frame,
                    self._keys,
                    self._df._backend_version,
                    self._df._implementation,
                )
                .isna()
                .any()
                .any()
            ):
                msg = "Grouping by null values is not supported in pandas < 1.0.0"
                raise NotImplementedError(msg)
            self._grouped = self._df._native_frame.groupby(
                list(self._keys),
                sort=False,
                as_index=True,
                observed=True,
            )
        else:
            self._grouped = self._df._native_frame.groupby(
                list(self._keys),
                sort=False,
                as_index=True,
                dropna=drop_null_keys,
                observed=True,
            )

    def agg(
        self,
        *aggs: IntoPandasLikeExpr,
        **named_aggs: IntoPandasLikeExpr,
    ) -> PandasLikeDataFrame:
        exprs = parse_into_exprs(
            *aggs,
            namespace=self._df.__narwhals_namespace__(),
            **named_aggs,
        )
        implementation: Implementation = self._df._implementation
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

        return agg_pandas(
            self._grouped,
            exprs,
            self._keys,
            output_names,
            self._from_native_frame,
            dataframe_is_empty=self._df._native_frame.empty,
            implementation=implementation,
            backend_version=self._df._backend_version,
            native_namespace=self._df.__native_namespace__(),
        )

    def _from_native_frame(self, df: PandasLikeDataFrame) -> PandasLikeDataFrame:
        from narwhals._pandas_like.dataframe import PandasLikeDataFrame

        return PandasLikeDataFrame(
            df,
            implementation=self._df._implementation,
            backend_version=self._df._backend_version,
            version=self._df._version,
        )

    def __iter__(self) -> Iterator[tuple[Any, PandasLikeDataFrame]]:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=".*a length 1 tuple will be returned",
                category=FutureWarning,
            )
            for key, group in self._grouped:
                yield (key, self._from_native_frame(group))


def agg_pandas(  # noqa: PLR0915
    grouped: Any,
    exprs: Sequence[CompliantExpr[PandasLikeSeries]],
    keys: list[str],
    output_names: list[str],
    from_dataframe: Callable[[Any], PandasLikeDataFrame],
    *,
    implementation: Any,
    backend_version: tuple[int, ...],
    dataframe_is_empty: bool,
    native_namespace: Any,
) -> PandasLikeDataFrame:
    """This should be the fastpath, but cuDF is too far behind to use it.

    - https://github.com/rapidsai/cudf/issues/15118
    - https://github.com/rapidsai/cudf/issues/15084
    """
    all_aggs_are_simple = True
    for expr in exprs:
        if not (
            is_simple_aggregation(expr)
            and remove_prefix(expr._function_name, "col->")
            in POLARS_TO_PANDAS_AGGREGATIONS
        ):
            all_aggs_are_simple = False
            break

    # dict of {output_name: root_name} that we count n_unique on
    # We need to do this separately from the rest so that we
    # can pass the `dropna` kwargs.
    nunique_aggs: dict[str, str] = {}
    simple_aggs: dict[str, list[str]] = collections.defaultdict(list)

    # ddof to (root_names, output_names) mapping
    std_aggs: dict[int, tuple[list[str], list[str]]] = collections.defaultdict(
        lambda: ([], [])
    )
    var_aggs: dict[int, tuple[list[str], list[str]]] = collections.defaultdict(
        lambda: ([], [])
    )

    expected_old_names: list[str] = []
    new_names: list[str] = []

    if all_aggs_are_simple:
        for expr in exprs:
            if expr._depth == 0:
                # e.g. agg(nw.len()) # noqa: ERA001
                if expr._output_names is None:  # pragma: no cover
                    msg = "Safety assertion failed, please report a bug to https://github.com/narwhals-dev/narwhals/issues"
                    raise AssertionError(msg)

                function_name = POLARS_TO_PANDAS_AGGREGATIONS.get(
                    expr._function_name, expr._function_name
                )
                for output_name in expr._output_names:
                    new_names.append(output_name)
                    expected_old_names.append(f"{keys[0]}_{function_name}")
                    simple_aggs[keys[0]].append(function_name)
                continue

            # e.g. agg(nw.mean('a')) # noqa: ERA001
            if (
                expr._depth != 1 or expr._root_names is None or expr._output_names is None
            ):  # pragma: no cover
                msg = "Safety assertion failed, please report a bug to https://github.com/narwhals-dev/narwhals/issues"
                raise AssertionError(msg)

            function_name = remove_prefix(expr._function_name, "col->")
            function_name = POLARS_TO_PANDAS_AGGREGATIONS.get(
                function_name, function_name
            )

            is_n_unique = function_name == "nunique"
            is_std = function_name == "std"
            is_var = function_name == "var"
            for root_name, output_name in zip(expr._root_names, expr._output_names):
                if is_n_unique:
                    nunique_aggs[output_name] = root_name
                elif is_std and (ddof := expr._kwargs["ddof"]) != 1:
                    std_aggs[ddof][0].append(root_name)
                    std_aggs[ddof][1].append(output_name)
                elif is_var and (ddof := expr._kwargs["ddof"]) != 1:
                    var_aggs[ddof][0].append(root_name)
                    var_aggs[ddof][1].append(output_name)
                else:
                    new_names.append(output_name)
                    expected_old_names.append(f"{root_name}_{function_name}")
                    simple_aggs[root_name].append(function_name)

        result_aggs = []

        if simple_aggs:
            result_simple_aggs = grouped.agg(simple_aggs)
            result_simple_aggs.columns = [
                f"{a}_{b}" for a, b in result_simple_aggs.columns
            ]
            if not (
                set(result_simple_aggs.columns) == set(expected_old_names)
                and len(result_simple_aggs.columns) == len(expected_old_names)
            ):  # pragma: no cover
                msg = (
                    f"Safety assertion failed, expected {expected_old_names} "
                    f"got {result_simple_aggs.columns}, "
                    "please report a bug at https://github.com/narwhals-dev/narwhals/issues"
                )
                raise AssertionError(msg)

            # Rename columns, being very careful
            expected_old_names_indices: dict[str, list[int]] = collections.defaultdict(
                list
            )
            for idx, item in enumerate(expected_old_names):
                expected_old_names_indices[item].append(idx)
            index_map: list[int] = [
                expected_old_names_indices[item].pop(0)
                for item in result_simple_aggs.columns
            ]
            new_names = [new_names[i] for i in index_map]
            result_simple_aggs.columns = new_names

            result_aggs.append(result_simple_aggs)

        if nunique_aggs:
            result_nunique_aggs = grouped[list(nunique_aggs.values())].nunique(
                dropna=False
            )
            result_nunique_aggs.columns = list(nunique_aggs.keys())

            result_aggs.append(result_nunique_aggs)

        if std_aggs:
            result_aggs.extend(
                [
                    set_columns(
                        grouped[std_root_names].std(ddof=ddof),
                        columns=std_output_names,
                        implementation=implementation,
                        backend_version=backend_version,
                    )
                    for ddof, (std_root_names, std_output_names) in std_aggs.items()
                ]
            )
        if var_aggs:
            result_aggs.extend(
                [
                    set_columns(
                        grouped[var_root_names].var(ddof=ddof),
                        columns=var_output_names,
                        implementation=implementation,
                        backend_version=backend_version,
                    )
                    for ddof, (var_root_names, var_output_names) in var_aggs.items()
                ]
            )

        if result_aggs:
            output_names_counter = collections.Counter(
                [c for frame in result_aggs for c in frame]
            )
            if any(v > 1 for v in output_names_counter.values()):
                msg = ""
                for key, value in output_names_counter.items():
                    if value > 1:
                        msg += f"\n- '{key}' {value} times"
                    else:  # pragma: no cover
                        pass
                msg = f"Expected unique output names, got:{msg}"
                raise ValueError(msg)
            result = horizontal_concat(
                dfs=result_aggs,
                implementation=implementation,
                backend_version=backend_version,
            )
        else:
            # No aggregation provided
            result = native_namespace.DataFrame(list(grouped.groups.keys()), columns=keys)
        # Keep inplace=True to avoid making a redundant copy.
        # This may need updating, depending on https://github.com/pandas-dev/pandas/pull/51466/files
        result.reset_index(inplace=True)  # noqa: PD002
        return from_dataframe(
            select_columns_by_name(result, output_names, backend_version, implementation)
        )

    if dataframe_is_empty:
        # Don't even attempt this, it's way too inconsistent across pandas versions.
        msg = (
            "No results for group-by aggregation.\n\n"
            "Hint: you were probably trying to apply a non-elementary aggregation with a "
            "pandas-like API.\n"
            "Please rewrite your query such that group-by aggregations "
            "are elementary. For example, instead of:\n\n"
            "    df.group_by('a').agg(nw.col('b').round(2).mean())\n\n"
            "use:\n\n"
            "    df.with_columns(nw.col('b').round(2)).group_by('a').agg(nw.col('b').mean())\n\n"
        )
        raise ValueError(msg)

    warnings.warn(
        "Found complex group-by expression, which can't be expressed efficiently with the "
        "pandas API. If you can, please rewrite your query such that group-by aggregations "
        "are simple (e.g. mean, std, min, max, ...). \n\n"
        "Please see: "
        "https://narwhals-dev.github.io/narwhals/pandas_like_concepts/improve_group_by_operation/",
        UserWarning,
        stacklevel=find_stacklevel(),
    )

    def func(df: Any) -> Any:
        out_group = []
        out_names = []
        for expr in exprs:
            results_keys = expr(from_dataframe(df))
            if not all(len(x) == 1 for x in results_keys):
                msg = f"Aggregation '{expr._function_name}' failed to aggregate - does your aggregation function return a scalar? \
                \n\n Please see: https://narwhals-dev.github.io/narwhals/pandas_like_concepts/improve_group_by_operation/"

                raise ValueError(msg)
            for result_keys in results_keys:
                out_group.append(result_keys._native_series.iloc[0])
                out_names.append(result_keys.name)
        return native_series_from_iterable(
            out_group,
            index=out_names,
            name="",
            implementation=implementation,
        )

    if implementation is Implementation.PANDAS and backend_version >= (2, 2):
        result_complex = grouped.apply(func, include_groups=False)
    else:  # pragma: no cover
        result_complex = grouped.apply(func)

    # Keep inplace=True to avoid making a redundant copy.
    # This may need updating, depending on https://github.com/pandas-dev/pandas/pull/51466/files
    result_complex.reset_index(inplace=True)  # noqa: PD002

    return from_dataframe(
        select_columns_by_name(
            result_complex, output_names, backend_version, implementation
        )
    )
