from __future__ import annotations

from copy import copy
from typing import TYPE_CHECKING

from narwhals._expression_parsing import parse_into_exprs

if TYPE_CHECKING:
    from narwhals._duckdb.dataframe import DuckDBLazyFrame
    from narwhals._duckdb.typing import IntoDuckDBExpr


class DuckDBGroupBy:
    def __init__(
        self,
        compliant_frame: DuckDBLazyFrame,
        keys: list[str],
        drop_null_keys: bool,  # noqa: FBT001
    ) -> None:
        self._compliant_frame = compliant_frame
        self._keys = keys

    def agg(
        self,
        *aggs: IntoDuckDBExpr,
        **named_aggs: IntoDuckDBExpr,
    ) -> DuckDBLazyFrame:
        exprs = parse_into_exprs(
            *aggs,
            namespace=self._compliant_frame.__narwhals_namespace__(),
            **named_aggs,
        )
        output_names: list[str] = copy(self._keys)
        for expr in exprs:
            if expr._output_names is None:  # pragma: no cover
                msg = (
                    "Anonymous expressions are not supported in group_by.agg.\n"
                    "Instead of `nw.all()`, try using a named expression, such as "
                    "`nw.col('a', 'b')`\n"
                )
                raise ValueError(msg)

            output_names.extend(expr._output_names)

        agg_columns = [
            *self._keys,
            *(x for expr in exprs for x in expr(self._compliant_frame)),
        ]
        try:
            return self._compliant_frame._from_native_frame(
                self._compliant_frame._native_frame.aggregate(
                    agg_columns, group_expr=",".join(self._keys)
                )
            )
        except ValueError as exc:  # pragma: no cover
            msg = "Failed to aggregated - does your aggregation function return a scalar?"
            raise RuntimeError(msg) from exc
