from __future__ import annotations

import collections
from typing import TYPE_CHECKING
from typing import Any
from typing import Callable
from typing import Iterator
from typing import Sequence

from narwhals._expression_parsing import is_simple_aggregation
from narwhals._expression_parsing import parse_into_exprs
from narwhals.utils import generate_temporary_column_name
from narwhals.utils import remove_prefix

if TYPE_CHECKING:
    import pyarrow as pa
    import pyarrow.compute as pc
    from typing_extensions import Self

    from narwhals._arrow.dataframe import ArrowDataFrame
    from narwhals._arrow.series import ArrowSeries
    from narwhals._arrow.typing import IntoArrowExpr
    from narwhals.typing import CompliantExpr

POLARS_TO_ARROW_AGGREGATIONS = {
    "sum": "sum",
    "mean": "mean",
    "median": "approximate_median",
    "max": "max",
    "min": "min",
    "std": "stddev",
    "var": "variance",
    "len": "count",
    "n_unique": "count_distinct",
    "count": "count",
}


class ArrowGroupBy:
    def __init__(
        self: Self, df: ArrowDataFrame, keys: list[str], *, drop_null_keys: bool
    ) -> None:
        import pyarrow as pa

        if drop_null_keys:
            self._df = df.drop_nulls(keys)
        else:
            self._df = df
        self._keys = list(keys)
        self._grouped = pa.TableGroupBy(self._df._native_frame, list(self._keys))

    def agg(
        self: Self,
        *aggs: IntoArrowExpr,
        **named_aggs: IntoArrowExpr,
    ) -> ArrowDataFrame:
        exprs = parse_into_exprs(
            *aggs,
            namespace=self._df.__narwhals_namespace__(),
            **named_aggs,
        )
        for expr in exprs:
            if expr._output_names is None:
                msg = (
                    "Anonymous expressions are not supported in group_by.agg.\n"
                    "Instead of `nw.all()`, try using a named expression, such as "
                    "`nw.col('a', 'b')`\n"
                )
                raise ValueError(msg)

        return agg_arrow(
            self._grouped,
            exprs,
            self._keys,
            self._df._from_native_frame,
            backend_version=self._df._backend_version,
        )

    def __iter__(self: Self) -> Iterator[tuple[Any, ArrowDataFrame]]:
        import pyarrow as pa
        import pyarrow.compute as pc

        col_token = generate_temporary_column_name(n_bytes=8, columns=self._df.columns)
        null_token = "__null_token_value__"  # noqa: S105

        table = self._df._native_frame
        key_values = pc.binary_join_element_wise(
            *[pc.cast(table[key], pa.string()) for key in self._keys],
            "",
            null_handling="replace",
            null_replacement=null_token,
        )
        table = table.add_column(i=0, field_=col_token, column=key_values)

        yield from (
            (
                next(
                    (
                        t := self._df._from_native_frame(
                            table.filter(pc.equal(table[col_token], v)).drop([col_token])
                        )
                    )
                    .select(*self._keys)
                    .head(1)
                    .iter_rows(named=False, buffer_size=512)
                ),
                t,
            )
            for v in pc.unique(key_values)
        )


def agg_arrow(
    grouped: pa.TableGroupBy,
    exprs: Sequence[CompliantExpr[ArrowSeries]],
    keys: list[str],
    from_dataframe: Callable[[Any], ArrowDataFrame],
    backend_version: tuple[int, ...],
) -> ArrowDataFrame:
    import pyarrow.compute as pc

    all_simple_aggs = True
    for expr in exprs:
        if not (
            is_simple_aggregation(expr)
            and remove_prefix(expr._function_name, "col->")
            in POLARS_TO_ARROW_AGGREGATIONS
        ):
            all_simple_aggs = False
            break

    if not all_simple_aggs:
        msg = (
            "Non-trivial complex aggregation found.\n\n"
            "Hint: you were probably trying to apply a non-elementary aggregation with a "
            "pyarrow table.\n"
            "Please rewrite your query such that group-by aggregations "
            "are elementary. For example, instead of:\n\n"
            "    df.group_by('a').agg(nw.col('b').round(2).mean())\n\n"
            "use:\n\n"
            "    df.with_columns(nw.col('b').round(2)).group_by('a').agg(nw.col('b').mean())\n\n"
        )
        raise ValueError(msg)

    aggs: list[tuple[str, str, pc.FunctionOptions | None]] = []
    expected_pyarrow_column_names: list[str] = keys.copy()
    new_column_names: list[str] = keys.copy()

    for expr in exprs:
        if expr._depth == 0:
            # e.g. agg(nw.len()) # noqa: ERA001
            if (
                expr._output_names is None or expr._function_name != "len"
            ):  # pragma: no cover
                msg = "Safety assertion failed, please report a bug to https://github.com/narwhals-dev/narwhals/issues"
                raise AssertionError(msg)

            new_column_names.append(expr._output_names[0])
            expected_pyarrow_column_names.append(f"{keys[0]}_count")
            aggs.append((keys[0], "count", pc.CountOptions(mode="all")))

            continue

        # e.g. agg(nw.mean('a')) # noqa: ERA001
        if (
            expr._depth != 1 or expr._root_names is None or expr._output_names is None
        ):  # pragma: no cover
            msg = "Safety assertion failed, please report a bug to https://github.com/narwhals-dev/narwhals/issues"
            raise AssertionError(msg)

        function_name = remove_prefix(expr._function_name, "col->")

        if function_name in {"std", "var"}:
            option = pc.VarianceOptions(ddof=expr._kwargs["ddof"])
        elif function_name in {"len", "n_unique"}:
            option = pc.CountOptions(mode="all")
        elif function_name == "count":
            option = pc.CountOptions(mode="only_valid")
        else:
            option = None

        function_name = POLARS_TO_ARROW_AGGREGATIONS[function_name]

        new_column_names.extend(expr._output_names)
        expected_pyarrow_column_names.extend(
            [f"{root_name}_{function_name}" for root_name in expr._root_names]
        )
        aggs.extend(
            [(root_name, function_name, option) for root_name in expr._root_names]
        )

    result_simple = grouped.aggregate(aggs)

    # Rename columns, being very careful
    expected_old_names_indices: dict[str, list[int]] = collections.defaultdict(list)
    for idx, item in enumerate(expected_pyarrow_column_names):
        expected_old_names_indices[item].append(idx)
    if not (
        set(result_simple.column_names) == set(expected_pyarrow_column_names)
        and len(result_simple.column_names) == len(expected_pyarrow_column_names)
    ):  # pragma: no cover
        msg = (
            f"Safety assertion failed, expected {expected_pyarrow_column_names} "
            f"got {result_simple.column_names}, "
            "please report a bug at https://github.com/narwhals-dev/narwhals/issues"
        )
        raise AssertionError(msg)
    index_map: list[int] = [
        expected_old_names_indices[item].pop(0) for item in result_simple.column_names
    ]
    new_column_names = [new_column_names[i] for i in index_map]
    result_simple = result_simple.rename_columns(new_column_names)
    if backend_version < (12, 0, 0):
        columns = result_simple.column_names
        result_simple = result_simple.select(
            [*keys, *[col for col in columns if col not in keys]]
        )
    return from_dataframe(result_simple)
