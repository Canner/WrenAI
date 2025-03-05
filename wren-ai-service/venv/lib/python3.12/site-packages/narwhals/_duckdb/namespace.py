from __future__ import annotations

import functools
import operator
from functools import reduce
from typing import TYPE_CHECKING
from typing import Any
from typing import Literal
from typing import Sequence
from typing import cast

from narwhals._duckdb.expr import DuckDBExpr
from narwhals._duckdb.utils import narwhals_to_native_dtype
from narwhals._expression_parsing import combine_root_names
from narwhals._expression_parsing import parse_into_exprs
from narwhals._expression_parsing import reduce_output_names
from narwhals.typing import CompliantNamespace

if TYPE_CHECKING:
    import duckdb

    from narwhals._duckdb.dataframe import DuckDBLazyFrame
    from narwhals._duckdb.typing import IntoDuckDBExpr
    from narwhals.dtypes import DType
    from narwhals.utils import Version


def get_column_name(df: DuckDBLazyFrame, column: duckdb.Expression) -> str:
    return str(df._native_frame.select(column).columns[0])


class DuckDBNamespace(CompliantNamespace["duckdb.Expression"]):
    def __init__(self, *, backend_version: tuple[int, ...], version: Version) -> None:
        self._backend_version = backend_version
        self._version = version

    def all(self) -> DuckDBExpr:
        def _all(df: DuckDBLazyFrame) -> list[duckdb.Expression]:
            from duckdb import ColumnExpression

            return [ColumnExpression(col_name) for col_name in df.columns]

        return DuckDBExpr(
            call=_all,
            depth=0,
            function_name="all",
            root_names=None,
            output_names=None,
            returns_scalar=False,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={},
        )

    def concat(
        self,
        items: Sequence[DuckDBLazyFrame],
        *,
        how: Literal["horizontal", "vertical", "diagonal"],
    ) -> DuckDBLazyFrame:
        if how == "horizontal":
            msg = "horizontal concat not supported for duckdb. Please join instead"
            raise TypeError(msg)
        if how == "diagonal":
            msg = "Not implemented yet"
            raise NotImplementedError(msg)
        first = items[0]
        schema = first.schema
        if how == "vertical" and not all(x.schema == schema for x in items[1:]):
            msg = "inputs should all have the same schema"
            raise TypeError(msg)
        res = functools.reduce(
            lambda x, y: x.union(y), (item._native_frame for item in items)
        )
        return first._from_native_frame(res)

    def all_horizontal(self, *exprs: IntoDuckDBExpr) -> DuckDBExpr:
        parsed_exprs = parse_into_exprs(*exprs, namespace=self)

        def func(df: DuckDBLazyFrame) -> list[duckdb.Expression]:
            cols = [c for _expr in parsed_exprs for c in _expr(df)]
            col_name = get_column_name(df, cols[0])
            return [reduce(operator.and_, cols).alias(col_name)]

        return DuckDBExpr(
            call=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="all_horizontal",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            returns_scalar=False,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={"exprs": exprs},
        )

    def any_horizontal(self, *exprs: IntoDuckDBExpr) -> DuckDBExpr:
        parsed_exprs = parse_into_exprs(*exprs, namespace=self)

        def func(df: DuckDBLazyFrame) -> list[duckdb.Expression]:
            cols = [c for _expr in parsed_exprs for c in _expr(df)]
            col_name = get_column_name(df, cols[0])
            return [reduce(operator.or_, cols).alias(col_name)]

        return DuckDBExpr(
            call=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="or_horizontal",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            returns_scalar=False,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={"exprs": exprs},
        )

    def max_horizontal(self, *exprs: IntoDuckDBExpr) -> DuckDBExpr:
        from duckdb import FunctionExpression

        parsed_exprs = parse_into_exprs(*exprs, namespace=self)

        def func(df: DuckDBLazyFrame) -> list[duckdb.Expression]:
            cols = [c for _expr in parsed_exprs for c in _expr(df)]
            col_name = get_column_name(df, cols[0])
            return [FunctionExpression("greatest", *cols).alias(col_name)]

        return DuckDBExpr(
            call=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="max_horizontal",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            returns_scalar=False,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={"exprs": exprs},
        )

    def min_horizontal(self, *exprs: IntoDuckDBExpr) -> DuckDBExpr:
        from duckdb import FunctionExpression

        parsed_exprs = parse_into_exprs(*exprs, namespace=self)

        def func(df: DuckDBLazyFrame) -> list[duckdb.Expression]:
            cols = [c for _expr in parsed_exprs for c in _expr(df)]
            col_name = get_column_name(df, cols[0])
            return [FunctionExpression("least", *cols).alias(col_name)]

        return DuckDBExpr(
            call=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="min_horizontal",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            returns_scalar=False,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={"exprs": exprs},
        )

    def when(
        self,
        *predicates: IntoDuckDBExpr,
    ) -> DuckDBWhen:
        plx = self.__class__(backend_version=self._backend_version, version=self._version)
        condition = plx.all_horizontal(*predicates)
        return DuckDBWhen(
            condition, self._backend_version, returns_scalar=False, version=self._version
        )

    def col(self, *column_names: str) -> DuckDBExpr:
        return DuckDBExpr.from_column_names(
            *column_names, backend_version=self._backend_version, version=self._version
        )

    def lit(self, value: Any, dtype: DType | None) -> DuckDBExpr:
        from duckdb import ConstantExpression

        def func(_df: DuckDBLazyFrame) -> list[duckdb.Expression]:
            if dtype is not None:
                return [
                    ConstantExpression(value)
                    .cast(narwhals_to_native_dtype(dtype, version=self._version))
                    .alias("literal")
                ]
            return [ConstantExpression(value).alias("literal")]

        return DuckDBExpr(
            func,
            depth=0,
            function_name="lit",
            root_names=None,
            output_names=["literal"],
            returns_scalar=True,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={},
        )

    def len(self) -> DuckDBExpr:
        def func(_df: DuckDBLazyFrame) -> list[duckdb.Expression]:
            from duckdb import FunctionExpression

            return [FunctionExpression("count").alias("len")]

        return DuckDBExpr(
            call=func,
            depth=0,
            function_name="len",
            root_names=None,
            output_names=["len"],
            returns_scalar=True,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={},
        )


class DuckDBWhen:
    def __init__(
        self,
        condition: DuckDBExpr,
        backend_version: tuple[int, ...],
        then_value: Any = None,
        otherwise_value: Any = None,
        *,
        returns_scalar: bool,
        version: Version,
    ) -> None:
        self._backend_version = backend_version
        self._condition = condition
        self._then_value = then_value
        self._otherwise_value = otherwise_value
        self._returns_scalar = returns_scalar
        self._version = version

    def __call__(self, df: DuckDBLazyFrame) -> Sequence[duckdb.Expression]:
        from duckdb import CaseExpression
        from duckdb import ConstantExpression

        from narwhals._expression_parsing import parse_into_expr

        plx = df.__narwhals_namespace__()
        condition = parse_into_expr(self._condition, namespace=plx)(df)[0]
        condition = cast("duckdb.Expression", condition)

        try:
            value = parse_into_expr(self._then_value, namespace=plx)(df)[0]
        except TypeError:
            # `self._otherwise_value` is a scalar and can't be converted to an expression
            value = ConstantExpression(self._then_value)
        value = cast("duckdb.Expression", value)

        if self._otherwise_value is None:
            return [CaseExpression(condition=condition, value=value)]
        try:
            otherwise_expr = parse_into_expr(self._otherwise_value, namespace=plx)
        except TypeError:
            # `self._otherwise_value` is a scalar and can't be converted to an expression
            return [
                CaseExpression(condition=condition, value=value).otherwise(
                    ConstantExpression(self._otherwise_value)
                )
            ]
        otherwise = otherwise_expr(df)[0]
        return [CaseExpression(condition=condition, value=value).otherwise(otherwise)]

    def then(self, value: DuckDBExpr | Any) -> DuckDBThen:
        self._then_value = value

        return DuckDBThen(
            self,
            depth=0,
            function_name="whenthen",
            root_names=None,
            output_names=None,
            returns_scalar=self._returns_scalar,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={"value": value},
        )


class DuckDBThen(DuckDBExpr):
    def __init__(
        self,
        call: DuckDBWhen,
        *,
        depth: int,
        function_name: str,
        root_names: list[str] | None,
        output_names: list[str] | None,
        returns_scalar: bool,
        backend_version: tuple[int, ...],
        version: Version,
        kwargs: dict[str, Any],
    ) -> None:
        self._backend_version = backend_version
        self._version = version
        self._call = call
        self._depth = depth
        self._function_name = function_name
        self._root_names = root_names
        self._output_names = output_names
        self._returns_scalar = returns_scalar
        self._kwargs = kwargs

    def otherwise(self, value: DuckDBExpr | Any) -> DuckDBExpr:
        # type ignore because we are setting the `_call` attribute to a
        # callable object of type `DuckDBWhen`, base class has the attribute as
        # only a `Callable`
        self._call._otherwise_value = value  # type: ignore[attr-defined]
        self._function_name = "whenotherwise"
        return self
