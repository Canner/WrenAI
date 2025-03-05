from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any
from typing import Callable
from typing import Literal
from typing import Sequence

from narwhals._expression_parsing import infer_new_root_output_names
from narwhals._spark_like.expr_str import SparkLikeExprStringNamespace
from narwhals._spark_like.utils import get_column_name
from narwhals._spark_like.utils import maybe_evaluate
from narwhals.typing import CompliantExpr
from narwhals.utils import Implementation
from narwhals.utils import parse_version

if TYPE_CHECKING:
    from pyspark.sql import Column
    from typing_extensions import Self

    from narwhals._spark_like.dataframe import SparkLikeLazyFrame
    from narwhals._spark_like.namespace import SparkLikeNamespace
    from narwhals.utils import Version


class SparkLikeExpr(CompliantExpr["Column"]):
    _implementation = Implementation.PYSPARK

    def __init__(
        self,
        call: Callable[[SparkLikeLazyFrame], list[Column]],
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

    def __call__(self, df: SparkLikeLazyFrame) -> Sequence[Column]:
        return self._call(df)

    def __narwhals_expr__(self) -> None: ...

    def __narwhals_namespace__(self) -> SparkLikeNamespace:  # pragma: no cover
        # Unused, just for compatibility with PandasLikeExpr
        from narwhals._spark_like.namespace import SparkLikeNamespace

        return SparkLikeNamespace(
            backend_version=self._backend_version, version=self._version
        )

    @classmethod
    def from_column_names(
        cls: type[Self],
        *column_names: str,
        backend_version: tuple[int, ...],
        version: Version,
    ) -> Self:
        def func(_: SparkLikeLazyFrame) -> list[Column]:
            from pyspark.sql import functions as F  # noqa: N812

            return [F.col(col_name) for col_name in column_names]

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
        call: Callable[..., Column],
        expr_name: str,
        *,
        returns_scalar: bool,
        **kwargs: Any,
    ) -> Self:
        def func(df: SparkLikeLazyFrame) -> list[Column]:
            results = []
            inputs = self._call(df)
            _kwargs = {key: maybe_evaluate(df, value) for key, value in kwargs.items()}
            for _input in inputs:
                input_col_name = get_column_name(df, _input)
                column_result = call(_input, **_kwargs)
                if not returns_scalar:
                    column_result = column_result.alias(input_col_name)
                results.append(column_result)
            return results

        root_names, output_names = infer_new_root_output_names(self, **kwargs)

        return self.__class__(
            func,
            depth=self._depth + 1,
            function_name=f"{self._function_name}->{expr_name}",
            root_names=root_names,
            output_names=output_names,
            returns_scalar=self._returns_scalar or returns_scalar,
            backend_version=self._backend_version,
            version=self._version,
            kwargs=kwargs,
        )

    def __eq__(self, other: SparkLikeExpr) -> Self:  # type: ignore[override]
        return self._from_call(
            lambda _input, other: _input.__eq__(other),
            "__eq__",
            other=other,
            returns_scalar=False,
        )

    def __ne__(self, other: SparkLikeExpr) -> Self:  # type: ignore[override]
        return self._from_call(
            lambda _input, other: _input.__ne__(other),
            "__ne__",
            other=other,
            returns_scalar=False,
        )

    def __add__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__add__(other),
            "__add__",
            other=other,
            returns_scalar=False,
        )

    def __sub__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__sub__(other),
            "__sub__",
            other=other,
            returns_scalar=False,
        )

    def __mul__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__mul__(other),
            "__mul__",
            other=other,
            returns_scalar=False,
        )

    def __truediv__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__truediv__(other),
            "__truediv__",
            other=other,
            returns_scalar=False,
        )

    def __floordiv__(self, other: SparkLikeExpr) -> Self:
        def _floordiv(_input: Column, other: Column) -> Column:
            from pyspark.sql import functions as F  # noqa: N812

            return F.floor(_input / other)

        return self._from_call(
            _floordiv, "__floordiv__", other=other, returns_scalar=False
        )

    def __pow__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__pow__(other),
            "__pow__",
            other=other,
            returns_scalar=False,
        )

    def __mod__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__mod__(other),
            "__mod__",
            other=other,
            returns_scalar=False,
        )

    def __ge__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__ge__(other),
            "__ge__",
            other=other,
            returns_scalar=False,
        )

    def __gt__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input > other,
            "__gt__",
            other=other,
            returns_scalar=False,
        )

    def __le__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__le__(other),
            "__le__",
            other=other,
            returns_scalar=False,
        )

    def __lt__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__lt__(other),
            "__lt__",
            other=other,
            returns_scalar=False,
        )

    def __and__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__and__(other),
            "__and__",
            other=other,
            returns_scalar=False,
        )

    def __or__(self, other: SparkLikeExpr) -> Self:
        return self._from_call(
            lambda _input, other: _input.__or__(other),
            "__or__",
            other=other,
            returns_scalar=False,
        )

    def __invert__(self) -> Self:
        return self._from_call(
            lambda _input: _input.__invert__(),
            "__invert__",
            returns_scalar=self._returns_scalar,
        )

    def abs(self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812

        return self._from_call(F.abs, "abs", returns_scalar=self._returns_scalar)

    def alias(self, name: str) -> Self:
        def _alias(df: SparkLikeLazyFrame) -> list[Column]:
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

    def all(self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812

        return self._from_call(F.bool_and, "all", returns_scalar=True)

    def any(self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812

        return self._from_call(F.bool_or, "any", returns_scalar=True)

    def count(self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812

        return self._from_call(F.count, "count", returns_scalar=True)

    def max(self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812

        return self._from_call(F.max, "max", returns_scalar=True)

    def mean(self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812

        return self._from_call(F.mean, "mean", returns_scalar=True)

    def median(self) -> Self:
        def _median(_input: Column) -> Column:
            import pyspark  # ignore-banned-import
            from pyspark.sql import functions as F  # noqa: N812

            if parse_version(pyspark.__version__) < (3, 4):
                # Use percentile_approx with default accuracy parameter (10000)
                return F.percentile_approx(_input.cast("double"), 0.5)

            return F.median(_input)

        return self._from_call(_median, "median", returns_scalar=True)

    def min(self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812

        return self._from_call(F.min, "min", returns_scalar=True)

    def null_count(self) -> Self:
        def _null_count(_input: Column) -> Column:
            from pyspark.sql import functions as F  # noqa: N812

            return F.count_if(F.isnull(_input))

        return self._from_call(_null_count, "null_count", returns_scalar=True)

    def sum(self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812

        return self._from_call(F.sum, "sum", returns_scalar=True)

    def std(self: Self, ddof: int) -> Self:
        from functools import partial

        import numpy as np  # ignore-banned-import

        from narwhals._spark_like.utils import _std

        func = partial(_std, ddof=ddof, np_version=parse_version(np.__version__))

        return self._from_call(func, "std", returns_scalar=True, ddof=ddof)

    def var(self: Self, ddof: int) -> Self:
        from functools import partial

        import numpy as np  # ignore-banned-import

        from narwhals._spark_like.utils import _var

        func = partial(_var, ddof=ddof, np_version=parse_version(np.__version__))

        return self._from_call(func, "var", returns_scalar=True, ddof=ddof)

    def clip(
        self,
        lower_bound: Any | None = None,
        upper_bound: Any | None = None,
    ) -> Self:
        def _clip(_input: Column, lower_bound: Any, upper_bound: Any) -> Column:
            from pyspark.sql import functions as F  # noqa: N812

            result = _input
            if lower_bound is not None:
                # Convert lower_bound to a literal Column
                result = F.when(result < lower_bound, F.lit(lower_bound)).otherwise(
                    result
                )
            if upper_bound is not None:
                # Convert upper_bound to a literal Column
                result = F.when(result > upper_bound, F.lit(upper_bound)).otherwise(
                    result
                )
            return result

        return self._from_call(
            _clip,
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
        def _is_between(_input: Column, lower_bound: Any, upper_bound: Any) -> Column:
            if closed == "both":
                return (_input >= lower_bound) & (_input <= upper_bound)
            if closed == "none":
                return (_input > lower_bound) & (_input < upper_bound)
            if closed == "left":
                return (_input >= lower_bound) & (_input < upper_bound)
            return (_input > lower_bound) & (_input <= upper_bound)

        return self._from_call(
            _is_between,
            "is_between",
            lower_bound=lower_bound,
            upper_bound=upper_bound,
            returns_scalar=self._returns_scalar,
        )

    def is_duplicated(self) -> Self:
        def _is_duplicated(_input: Column) -> Column:
            from pyspark.sql import Window
            from pyspark.sql import functions as F  # noqa: N812

            # Create a window spec that treats each value separately.
            return F.count("*").over(Window.partitionBy(_input)) > 1

        return self._from_call(
            _is_duplicated, "is_duplicated", returns_scalar=self._returns_scalar
        )

    def is_finite(self) -> Self:
        def _is_finite(_input: Column) -> Column:
            from pyspark.sql import functions as F  # noqa: N812

            # A value is finite if it's not NaN, not NULL, and not infinite
            return (
                ~F.isnan(_input)
                & ~F.isnull(_input)
                & (_input != float("inf"))
                & (_input != float("-inf"))
            )

        return self._from_call(
            _is_finite, "is_finite", returns_scalar=self._returns_scalar
        )

    def is_in(self, values: Sequence[Any]) -> Self:
        def _is_in(_input: Column, values: Sequence[Any]) -> Column:
            return _input.isin(values)

        return self._from_call(
            _is_in,
            "is_in",
            values=values,
            returns_scalar=self._returns_scalar,
        )

    def is_unique(self) -> Self:
        def _is_unique(_input: Column) -> Column:
            from pyspark.sql import Window
            from pyspark.sql import functions as F  # noqa: N812

            # Create a window spec that treats each value separately
            return F.count("*").over(Window.partitionBy(_input)) == 1

        return self._from_call(
            _is_unique, "is_unique", returns_scalar=self._returns_scalar
        )

    def len(self) -> Self:
        def _len(_input: Column) -> Column:
            from pyspark.sql import functions as F  # noqa: N812

            # Use count(*) to count all rows including nulls
            return F.count("*")

        return self._from_call(_len, "len", returns_scalar=True)

    def round(self, decimals: int) -> Self:
        def _round(_input: Column, decimals: int) -> Column:
            from pyspark.sql import functions as F  # noqa: N812

            return F.round(_input, decimals)

        return self._from_call(
            _round,
            "round",
            decimals=decimals,
            returns_scalar=self._returns_scalar,
        )

    def skew(self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812

        return self._from_call(F.skewness, "skew", returns_scalar=True)

    def n_unique(self: Self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812
        from pyspark.sql.types import IntegerType

        def _n_unique(_input: Column) -> Column:
            return F.count_distinct(_input) + F.max(F.isnull(_input).cast(IntegerType()))

        return self._from_call(_n_unique, "n_unique", returns_scalar=True)

    def is_null(self: Self) -> Self:
        from pyspark.sql import functions as F  # noqa: N812

        return self._from_call(F.isnull, "is_null", returns_scalar=self._returns_scalar)

    @property
    def str(self: Self) -> SparkLikeExprStringNamespace:
        return SparkLikeExprStringNamespace(self)
