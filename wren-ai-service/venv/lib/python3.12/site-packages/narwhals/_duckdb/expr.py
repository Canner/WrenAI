from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any
from typing import Callable
from typing import Literal
from typing import Sequence

from narwhals._duckdb.expr_dt import DuckDBExprDateTimeNamespace
from narwhals._duckdb.expr_str import DuckDBExprStringNamespace
from narwhals._duckdb.utils import binary_operation_returns_scalar
from narwhals._duckdb.utils import get_column_name
from narwhals._duckdb.utils import maybe_evaluate
from narwhals._duckdb.utils import narwhals_to_native_dtype
from narwhals._expression_parsing import infer_new_root_output_names
from narwhals.typing import CompliantExpr
from narwhals.utils import Implementation

if TYPE_CHECKING:
    import duckdb
    from typing_extensions import Self

    from narwhals._duckdb.dataframe import DuckDBLazyFrame
    from narwhals._duckdb.namespace import DuckDBNamespace
    from narwhals.dtypes import DType
    from narwhals.utils import Version


class DuckDBExpr(CompliantExpr["duckdb.Expression"]):
    _implementation = Implementation.DUCKDB

    def __init__(
        self,
        call: Callable[[DuckDBLazyFrame], Sequence[duckdb.Expression]],
        *,
        depth: int,
        function_name: str,
        root_names: list[str] | None,
        output_names: list[str] | None,
        # Whether the expression is a length-1 Column resulting from
        # a reduction, such as `nw.col('a').sum()`
        returns_scalar: bool,
        backend_version: tuple[int, ...],
        version: Version,
        kwargs: dict[str, Any],
    ) -> None:
        self._call = call
        self._depth = depth
        self._function_name = function_name
        self._root_names = root_names
        self._output_names = output_names
        self._returns_scalar = returns_scalar
        self._backend_version = backend_version
        self._version = version
        self._kwargs = kwargs

    def __call__(self, df: DuckDBLazyFrame) -> Sequence[duckdb.Expression]:
        return self._call(df)

    def __narwhals_expr__(self) -> None: ...

    def __narwhals_namespace__(self) -> DuckDBNamespace:  # pragma: no cover
        # Unused, just for compatibility with PandasLikeExpr
        from narwhals._duckdb.namespace import DuckDBNamespace

        return DuckDBNamespace(
            backend_version=self._backend_version, version=self._version
        )

    @classmethod
    def from_column_names(
        cls: type[Self],
        *column_names: str,
        backend_version: tuple[int, ...],
        version: Version,
    ) -> Self:
        def func(_: DuckDBLazyFrame) -> list[duckdb.Expression]:
            from duckdb import ColumnExpression

            return [ColumnExpression(col_name) for col_name in column_names]

        return cls(
            func,
            depth=0,
            function_name="col",
            root_names=list(column_names),
            output_names=list(column_names),
            returns_scalar=False,
            backend_version=backend_version,
            version=version,
            kwargs={},
        )

    def _from_call(
        self,
        call: Callable[..., duckdb.Expression],
        expr_name: str,
        *,
        returns_scalar: bool,
        **kwargs: Any,
    ) -> Self:
        def func(df: DuckDBLazyFrame) -> list[duckdb.Expression]:
            results = []
            inputs = self._call(df)
            _kwargs = {key: maybe_evaluate(df, value) for key, value in kwargs.items()}
            for _input in inputs:
                input_col_name = get_column_name(
                    df, _input, returns_scalar=self._returns_scalar
                )
                if self._returns_scalar:
                    # TODO(marco): once WindowExpression is supported, then
                    # we may need to call it with `over(1)` here,
                    # depending on the context?
                    pass

                column_result = call(_input, **_kwargs)
                column_result = column_result.alias(input_col_name)
                if returns_scalar:
                    # TODO(marco): once WindowExpression is supported, then
                    # we may need to call it with `over(1)` here,
                    # depending on the context?
                    pass
                results.append(column_result)
            return results

        root_names, output_names = infer_new_root_output_names(self, **kwargs)

        return self.__class__(
            func,
            depth=self._depth + 1,
            function_name=f"{self._function_name}->{expr_name}",
            root_names=root_names,
            output_names=output_names,
            returns_scalar=returns_scalar,
            backend_version=self._backend_version,
            version=self._version,
            kwargs=kwargs,
        )

    def __and__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input & other,
            "__and__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __or__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input | other,
            "__or__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __add__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input + other,
            "__add__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __truediv__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input / other,
            "__truediv__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __floordiv__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__floordiv__(other),
            "__floordiv__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __mod__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__mod__(other),
            "__mod__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __sub__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input - other,
            "__sub__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __mul__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input * other,
            "__mul__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __pow__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input**other,
            "__pow__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __lt__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input < other,
            "__lt__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __gt__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input > other,
            "__gt__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __le__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input <= other,
            "__le__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __ge__(self, other: DuckDBExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input >= other,
            "__ge__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __eq__(self, other: DuckDBExpr) -> Self:  # type: ignore[override]
        return self._from_call(
            lambda _input, other: _input == other,
            "__eq__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __ne__(self, other: DuckDBExpr) -> Self:  # type: ignore[override]
        return self._from_call(
            lambda _input, other: _input != other,
            "__ne__",
            other=other,
            returns_scalar=binary_operation_returns_scalar(self, other),
        )

    def __invert__(self) -> Self:
        return self._from_call(
            lambda _input: ~_input,
            "__invert__",
            returns_scalar=self._returns_scalar,
        )

    def alias(self, name: str) -> Self:
        def _alias(df: DuckDBLazyFrame) -> list[duckdb.Expression]:
            return [col.alias(name) for col in self._call(df)]

        # Define this one manually, so that we can
        # override `output_names` and not increase depth
        return self.__class__(
            _alias,
            depth=self._depth,
            function_name=self._function_name,
            root_names=self._root_names,
            output_names=[name],
            returns_scalar=self._returns_scalar,
            backend_version=self._backend_version,
            version=self._version,
            kwargs={**self._kwargs, "name": name},
        )

    def abs(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("abs", _input),
            "abs",
            returns_scalar=self._returns_scalar,
        )

    def mean(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("mean", _input),
            "mean",
            returns_scalar=True,
        )

    def skew(self) -> Self:
        from duckdb import CaseExpression
        from duckdb import ConstantExpression
        from duckdb import FunctionExpression

        def func(_input: duckdb.Expression) -> duckdb.Expression:
            count = FunctionExpression("count", _input)
            return CaseExpression(
                condition=count == 0, value=ConstantExpression(None)
            ).otherwise(
                CaseExpression(
                    condition=count == 1, value=ConstantExpression(float("nan"))
                ).otherwise(
                    CaseExpression(
                        condition=count == 2, value=ConstantExpression(0.0)
                    ).otherwise(FunctionExpression("skewness", _input))
                )
            )

        return self._from_call(func, "skew", returns_scalar=True)

    def median(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("median", _input),
            "median",
            returns_scalar=True,
        )

    def all(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("bool_and", _input),
            "all",
            returns_scalar=True,
        )

    def any(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("bool_or", _input),
            "any",
            returns_scalar=True,
        )

    def quantile(
        self,
        quantile: float,
        interpolation: Literal["nearest", "higher", "lower", "midpoint", "linear"],
    ) -> Self:
        from duckdb import ConstantExpression
        from duckdb import FunctionExpression

        def func(_input: duckdb.Expression) -> duckdb.Expression:
            if interpolation == "linear":
                return FunctionExpression(
                    "quantile_cont", _input, ConstantExpression(quantile)
                )
            msg = "Only linear interpolation methods are supported for DuckDB quantile."
            raise NotImplementedError(msg)

        return self._from_call(
            func,
            "quantile",
            returns_scalar=True,
        )

    def clip(self, lower_bound: Any, upper_bound: Any) -> Self:
        from duckdb import FunctionExpression

        def func(
            _input: duckdb.Expression, lower_bound: Any, upper_bound: Any
        ) -> duckdb.Expression:
            return FunctionExpression(
                "greatest", FunctionExpression("least", _input, upper_bound), lower_bound
            )

        return self._from_call(
            func,
            "clip",
            lower_bound=lower_bound,
            upper_bound=upper_bound,
            returns_scalar=self._returns_scalar,
        )

    def is_between(
        self,
        lower_bound: Any,
        upper_bound: Any,
        closed: Literal["left", "right", "none", "both"],
    ) -> Self:
        def func(
            _input: duckdb.Expression, lower_bound: Any, upper_bound: Any
        ) -> duckdb.Expression:
            if closed == "left":
                return (_input >= lower_bound) & (_input < upper_bound)
            elif closed == "right":
                return (_input > lower_bound) & (_input <= upper_bound)
            elif closed == "none":
                return (_input > lower_bound) & (_input < upper_bound)
            return (_input >= lower_bound) & (_input <= upper_bound)

        return self._from_call(
            func,
            "is_between",
            lower_bound=lower_bound,
            upper_bound=upper_bound,
            returns_scalar=self._returns_scalar,
        )

    def sum(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("sum", _input), "sum", returns_scalar=True
        )

    def n_unique(self) -> Self:
        from duckdb import CaseExpression
        from duckdb import ConstantExpression
        from duckdb import FunctionExpression

        def func(_input: duckdb.Expression) -> duckdb.Expression:
            # https://stackoverflow.com/a/79338887/4451315
            return FunctionExpression(
                "array_unique", FunctionExpression("array_agg", _input)
            ) + FunctionExpression(
                "max",
                CaseExpression(
                    condition=_input.isnotnull(), value=ConstantExpression(0)
                ).otherwise(ConstantExpression(1)),
            )

        return self._from_call(
            func,
            "n_unique",
            returns_scalar=True,
        )

    def count(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("count", _input),
            "count",
            returns_scalar=True,
        )

    def len(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("count"), "len", returns_scalar=True
        )

    def std(self, ddof: int) -> Self:
        from duckdb import FunctionExpression

        if ddof == 1:
            func = "stddev_samp"
        elif ddof == 0:
            func = "stddev_pop"
        else:
            msg = f"std with ddof {ddof} is not supported in DuckDB"
            raise NotImplementedError(msg)
        return self._from_call(
            lambda _input: FunctionExpression(func, _input), "std", returns_scalar=True
        )

    def var(self, ddof: int) -> Self:
        from duckdb import FunctionExpression

        if ddof == 1:
            func = "var_samp"
        elif ddof == 0:
            func = "var_pop"
        else:
            msg = f"var with ddof {ddof} is not supported in DuckDB"
            raise NotImplementedError(msg)
        return self._from_call(
            lambda _input: FunctionExpression(func, _input), "var", returns_scalar=True
        )

    def max(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("max", _input), "max", returns_scalar=True
        )

    def min(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("min", _input), "min", returns_scalar=True
        )

    def null_count(self) -> Self:
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression("sum", _input.isnull().cast("int")),
            "null_count",
            returns_scalar=True,
        )

    def is_null(self) -> Self:
        return self._from_call(
            lambda _input: _input.isnull(), "is_null", returns_scalar=self._returns_scalar
        )

    def is_in(self, other: Sequence[Any]) -> Self:
        from duckdb import ConstantExpression

        return self._from_call(
            lambda _input: _input.isin(*[ConstantExpression(x) for x in other]),
            "is_in",
            returns_scalar=self._returns_scalar,
        )

    def round(self, decimals: int) -> Self:
        from duckdb import ConstantExpression
        from duckdb import FunctionExpression

        return self._from_call(
            lambda _input: FunctionExpression(
                "round", _input, ConstantExpression(decimals)
            ),
            "round",
            returns_scalar=self._returns_scalar,
        )

    def fill_null(self, value: Any, strategy: Any, limit: int | None) -> Self:
        from duckdb import CoalesceOperator
        from duckdb import ConstantExpression

        if strategy is not None:
            msg = "todo"
            raise NotImplementedError(msg)

        return self._from_call(
            lambda _input: CoalesceOperator(_input, ConstantExpression(value)),
            "fill_null",
            returns_scalar=self._returns_scalar,
        )

    def cast(
        self: Self,
        dtype: DType | type[DType],
    ) -> Self:
        def func(_input: Any, dtype: DType | type[DType]) -> Any:
            native_dtype = narwhals_to_native_dtype(dtype, self._version)
            return _input.cast(native_dtype)

        return self._from_call(
            func,
            "cast",
            dtype=dtype,
            returns_scalar=self._returns_scalar,
        )

    @property
    def str(self: Self) -> DuckDBExprStringNamespace:
        return DuckDBExprStringNamespace(self)

    @property
    def dt(self: Self) -> DuckDBExprDateTimeNamespace:
        return DuckDBExprDateTimeNamespace(self)
