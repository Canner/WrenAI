from __future__ import annotations

from functools import reduce
from typing import TYPE_CHECKING
from typing import Any
from typing import Callable
from typing import Iterable
from typing import Literal
from typing import Sequence

from narwhals._expression_parsing import combine_root_names
from narwhals._expression_parsing import parse_into_exprs
from narwhals._expression_parsing import reduce_output_names
from narwhals._pandas_like.dataframe import PandasLikeDataFrame
from narwhals._pandas_like.expr import PandasLikeExpr
from narwhals._pandas_like.selectors import PandasSelectorNamespace
from narwhals._pandas_like.series import PandasLikeSeries
from narwhals._pandas_like.utils import create_compliant_series
from narwhals._pandas_like.utils import diagonal_concat
from narwhals._pandas_like.utils import horizontal_concat
from narwhals._pandas_like.utils import rename
from narwhals._pandas_like.utils import vertical_concat
from narwhals.typing import CompliantNamespace
from narwhals.utils import import_dtypes_module

if TYPE_CHECKING:
    from narwhals._pandas_like.typing import IntoPandasLikeExpr
    from narwhals.dtypes import DType
    from narwhals.utils import Implementation
    from narwhals.utils import Version


class PandasLikeNamespace(CompliantNamespace[PandasLikeSeries]):
    @property
    def selectors(self) -> PandasSelectorNamespace:
        return PandasSelectorNamespace(
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    # --- not in spec ---
    def __init__(
        self,
        implementation: Implementation,
        backend_version: tuple[int, ...],
        version: Version,
    ) -> None:
        self._implementation = implementation
        self._backend_version = backend_version
        self._version = version

    def _create_expr_from_callable(
        self,
        func: Callable[[PandasLikeDataFrame], Sequence[PandasLikeSeries]],
        *,
        depth: int,
        function_name: str,
        root_names: list[str] | None,
        output_names: list[str] | None,
        kwargs: dict[str, Any],
    ) -> PandasLikeExpr:
        return PandasLikeExpr(
            func,
            depth=depth,
            function_name=function_name,
            root_names=root_names,
            output_names=output_names,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
            kwargs=kwargs,
        )

    def _create_series_from_scalar(
        self, value: Any, *, reference_series: PandasLikeSeries
    ) -> PandasLikeSeries:
        return PandasLikeSeries._from_iterable(
            [value],
            name=reference_series._native_series.name,
            index=reference_series._native_series.index[0:1],
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    def _create_expr_from_series(self, series: PandasLikeSeries) -> PandasLikeExpr:
        return PandasLikeExpr(
            lambda _df: [series],
            depth=0,
            function_name="series",
            root_names=None,
            output_names=None,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={},
        )

    def _create_compliant_series(self, value: Any) -> PandasLikeSeries:
        return create_compliant_series(
            value,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    # --- selection ---
    def col(self, *column_names: str) -> PandasLikeExpr:
        return PandasLikeExpr.from_column_names(
            *column_names,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    def nth(self, *column_indices: int) -> PandasLikeExpr:
        return PandasLikeExpr.from_column_indices(
            *column_indices,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
        )

    def all(self) -> PandasLikeExpr:
        return PandasLikeExpr(
            lambda df: [
                PandasLikeSeries(
                    df._native_frame[column_name],
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                    version=self._version,
                )
                for column_name in df.columns
            ],
            depth=0,
            function_name="all",
            root_names=None,
            output_names=None,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={},
        )

    def lit(self, value: Any, dtype: DType | None) -> PandasLikeExpr:
        def _lit_pandas_series(df: PandasLikeDataFrame) -> PandasLikeSeries:
            pandas_series = PandasLikeSeries._from_iterable(
                data=[value],
                name="literal",
                index=df._native_frame.index[0:1],
                implementation=self._implementation,
                backend_version=self._backend_version,
                version=self._version,
            )
            if dtype:
                return pandas_series.cast(dtype)
            return pandas_series

        return PandasLikeExpr(
            lambda df: [_lit_pandas_series(df)],
            depth=0,
            function_name="lit",
            root_names=None,
            output_names=["literal"],
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={},
        )

    def len(self) -> PandasLikeExpr:
        return PandasLikeExpr(
            lambda df: [
                PandasLikeSeries._from_iterable(
                    [len(df._native_frame)],
                    name="len",
                    index=[0],
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                    version=self._version,
                )
            ],
            depth=0,
            function_name="len",
            root_names=None,
            output_names=["len"],
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={},
        )

    # --- horizontal ---
    def sum_horizontal(self, *exprs: IntoPandasLikeExpr) -> PandasLikeExpr:
        parsed_exprs = parse_into_exprs(*exprs, namespace=self)

        def func(df: PandasLikeDataFrame) -> list[PandasLikeSeries]:
            series = (s.fill_null(0) for _expr in parsed_exprs for s in _expr(df))
            return [reduce(lambda x, y: x + y, series)]

        return self._create_expr_from_callable(
            func=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="sum_horizontal",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            kwargs={"exprs": exprs},
        )

    def all_horizontal(self, *exprs: IntoPandasLikeExpr) -> PandasLikeExpr:
        parsed_exprs = parse_into_exprs(*exprs, namespace=self)

        def func(df: PandasLikeDataFrame) -> list[PandasLikeSeries]:
            series = (s for _expr in parsed_exprs for s in _expr(df))
            return [reduce(lambda x, y: x & y, series)]

        return self._create_expr_from_callable(
            func=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="all_horizontal",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            kwargs={"exprs": exprs},
        )

    def any_horizontal(self, *exprs: IntoPandasLikeExpr) -> PandasLikeExpr:
        parsed_exprs = parse_into_exprs(*exprs, namespace=self)

        def func(df: PandasLikeDataFrame) -> list[PandasLikeSeries]:
            series = (s for _expr in parsed_exprs for s in _expr(df))
            return [reduce(lambda x, y: x | y, series)]

        return self._create_expr_from_callable(
            func=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="any_horizontal",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            kwargs={"exprs": exprs},
        )

    def mean_horizontal(self, *exprs: IntoPandasLikeExpr) -> PandasLikeExpr:
        parsed_exprs = parse_into_exprs(*exprs, namespace=self)

        def func(df: PandasLikeDataFrame) -> list[PandasLikeSeries]:
            series = (s.fill_null(0) for _expr in parsed_exprs for s in _expr(df))
            non_na = (1 - s.is_null() for _expr in parsed_exprs for s in _expr(df))
            return [
                reduce(lambda x, y: x + y, series) / reduce(lambda x, y: x + y, non_na)
            ]

        return self._create_expr_from_callable(
            func=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="mean_horizontal",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            kwargs={"exprs": exprs},
        )

    def min_horizontal(self, *exprs: IntoPandasLikeExpr) -> PandasLikeExpr:
        parsed_exprs = parse_into_exprs(*exprs, namespace=self)

        def func(df: PandasLikeDataFrame) -> list[PandasLikeSeries]:
            series = [s for _expr in parsed_exprs for s in _expr(df)]

            return [
                PandasLikeSeries(
                    native_series=rename(
                        self.concat(
                            (s.to_frame() for s in series), how="horizontal"
                        )._native_frame.min(axis=1),
                        series[0].name,
                        implementation=self._implementation,
                        backend_version=self._backend_version,
                    ),
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                    version=self._version,
                )
            ]

        return self._create_expr_from_callable(
            func=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="min_horizontal",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            kwargs={"exprs": exprs},
        )

    def max_horizontal(self, *exprs: IntoPandasLikeExpr) -> PandasLikeExpr:
        parsed_exprs = parse_into_exprs(*exprs, namespace=self)

        def func(df: PandasLikeDataFrame) -> list[PandasLikeSeries]:
            series = [s for _expr in parsed_exprs for s in _expr(df)]

            return [
                PandasLikeSeries(
                    rename(
                        self.concat(
                            (s.to_frame() for s in series), how="horizontal"
                        )._native_frame.max(axis=1),
                        series[0].name,
                        implementation=self._implementation,
                        backend_version=self._backend_version,
                    ),
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                    version=self._version,
                )
            ]

        return self._create_expr_from_callable(
            func=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="max_horizontal",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            kwargs={"exprs": exprs},
        )

    def concat(
        self,
        items: Iterable[PandasLikeDataFrame],
        *,
        how: Literal["horizontal", "vertical", "diagonal"],
    ) -> PandasLikeDataFrame:
        dfs: list[Any] = [item._native_frame for item in items]
        if how == "horizontal":
            return PandasLikeDataFrame(
                horizontal_concat(
                    dfs,
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                ),
                implementation=self._implementation,
                backend_version=self._backend_version,
                version=self._version,
            )
        if how == "vertical":
            return PandasLikeDataFrame(
                vertical_concat(
                    dfs,
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                ),
                implementation=self._implementation,
                backend_version=self._backend_version,
                version=self._version,
            )

        if how == "diagonal":
            return PandasLikeDataFrame(
                diagonal_concat(
                    dfs,
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                ),
                implementation=self._implementation,
                backend_version=self._backend_version,
                version=self._version,
            )
        raise NotImplementedError

    def when(
        self,
        *predicates: IntoPandasLikeExpr,
    ) -> PandasWhen:
        plx = self.__class__(
            self._implementation, self._backend_version, version=self._version
        )
        condition = plx.all_horizontal(*predicates)
        return PandasWhen(
            condition, self._implementation, self._backend_version, version=self._version
        )

    def concat_str(
        self,
        exprs: Iterable[IntoPandasLikeExpr],
        *more_exprs: IntoPandasLikeExpr,
        separator: str,
        ignore_nulls: bool,
    ) -> PandasLikeExpr:
        parsed_exprs = [
            *parse_into_exprs(*exprs, namespace=self),
            *parse_into_exprs(*more_exprs, namespace=self),
        ]
        dtypes = import_dtypes_module(self._version)

        def func(df: PandasLikeDataFrame) -> list[PandasLikeSeries]:
            series = (
                s for _expr in parsed_exprs for s in _expr.cast(dtypes.String())(df)
            )
            null_mask = [s for _expr in parsed_exprs for s in _expr.is_null()(df)]

            if not ignore_nulls:
                null_mask_result = reduce(lambda x, y: x | y, null_mask)
                result = reduce(lambda x, y: x + separator + y, series).zip_with(
                    ~null_mask_result, None
                )
            else:
                init_value, *values = [
                    s.zip_with(~nm, "") for s, nm in zip(series, null_mask)
                ]

                sep_array = init_value.__class__._from_iterable(
                    data=[separator] * len(init_value),
                    name="sep",
                    index=init_value._native_series.index,
                    implementation=self._implementation,
                    backend_version=self._backend_version,
                    version=self._version,
                )
                separators = (sep_array.zip_with(~nm, "") for nm in null_mask[:-1])
                result = reduce(
                    lambda x, y: x + y,
                    (s + v for s, v in zip(separators, values)),
                    init_value,
                )

            return [result]

        return self._create_expr_from_callable(
            func=func,
            depth=max(x._depth for x in parsed_exprs) + 1,
            function_name="concat_str",
            root_names=combine_root_names(parsed_exprs),
            output_names=reduce_output_names(parsed_exprs),
            kwargs={
                "exprs": exprs,
                "more_exprs": more_exprs,
                "separator": separator,
                "ignore_nulls": ignore_nulls,
            },
        )


class PandasWhen:
    def __init__(
        self,
        condition: PandasLikeExpr,
        implementation: Implementation,
        backend_version: tuple[int, ...],
        then_value: Any = None,
        otherwise_value: Any = None,
        *,
        version: Version,
    ) -> None:
        self._implementation = implementation
        self._backend_version = backend_version
        self._condition = condition
        self._then_value = then_value
        self._otherwise_value = otherwise_value
        self._version = version

    def __call__(self, df: PandasLikeDataFrame) -> Sequence[PandasLikeSeries]:
        from narwhals._expression_parsing import parse_into_expr
        from narwhals._pandas_like.utils import broadcast_align_and_extract_native

        plx = df.__narwhals_namespace__()
        condition = parse_into_expr(self._condition, namespace=plx)(df)[0]
        try:
            value_series = parse_into_expr(self._then_value, namespace=plx)(df)[0]
        except TypeError:
            # `self._otherwise_value` is a scalar and can't be converted to an expression
            value_series = condition.__class__._from_iterable(
                [self._then_value] * len(condition),
                name="literal",
                index=condition._native_series.index,
                implementation=self._implementation,
                backend_version=self._backend_version,
                version=self._version,
            )
        value_series_native, condition_native = broadcast_align_and_extract_native(
            value_series, condition
        )

        if self._otherwise_value is None:
            return [
                value_series._from_native_series(
                    value_series_native.where(condition_native)
                )
            ]
        try:
            otherwise_expr = parse_into_expr(self._otherwise_value, namespace=plx)
        except TypeError:
            # `self._otherwise_value` is a scalar and can't be converted to an expression
            return [
                value_series._from_native_series(
                    value_series_native.where(condition_native, self._otherwise_value)
                )
            ]
        else:
            otherwise_series = otherwise_expr(df)[0]
            return [value_series.zip_with(condition, otherwise_series)]

    def then(self, value: PandasLikeExpr | PandasLikeSeries | Any) -> PandasThen:
        self._then_value = value

        return PandasThen(
            self,
            depth=0,
            function_name="whenthen",
            root_names=None,
            output_names=None,
            implementation=self._implementation,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={"value": value},
        )


class PandasThen(PandasLikeExpr):
    def __init__(
        self,
        call: PandasWhen,
        *,
        depth: int,
        function_name: str,
        root_names: list[str] | None,
        output_names: list[str] | None,
        implementation: Implementation,
        backend_version: tuple[int, ...],
        version: Version,
        kwargs: dict[str, Any],
    ) -> None:
        self._implementation = implementation
        self._backend_version = backend_version
        self._version = version
        self._call = call
        self._depth = depth
        self._function_name = function_name
        self._root_names = root_names
        self._output_names = output_names
        self._kwargs = kwargs

    def otherwise(self, value: PandasLikeExpr | PandasLikeSeries | Any) -> PandasLikeExpr:
        # type ignore because we are setting the `_call` attribute to a
        # callable object of type `PandasWhen`, base class has the attribute as
        # only a `Callable`
        self._call._otherwise_value = value  # type: ignore[attr-defined]
        self._function_name = "whenotherwise"
        return self
