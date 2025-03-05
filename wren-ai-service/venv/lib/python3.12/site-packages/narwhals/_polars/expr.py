from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any
from typing import Callable
from typing import Sequence

from narwhals._polars.utils import extract_args_kwargs
from narwhals._polars.utils import extract_native
from narwhals._polars.utils import narwhals_to_native_dtype
from narwhals.utils import Implementation

if TYPE_CHECKING:
    import polars as pl
    from typing_extensions import Self

    from narwhals.dtypes import DType
    from narwhals.utils import Version


class PolarsExpr:
    def __init__(
        self: Self, expr: pl.Expr, version: Version, backend_version: tuple[int, ...]
    ) -> None:
        self._native_expr = expr
        self._implementation = Implementation.POLARS
        self._version = version
        self._backend_version = backend_version

    def __repr__(self: Self) -> str:  # pragma: no cover
        return "PolarsExpr"

    def _from_native_expr(self: Self, expr: pl.Expr) -> Self:
        return self.__class__(
            expr, version=self._version, backend_version=self._backend_version
        )

    def __getattr__(self: Self, attr: str) -> Any:
        def func(*args: Any, **kwargs: Any) -> Any:
            args, kwargs = extract_args_kwargs(args, kwargs)  # type: ignore[assignment]
            return self._from_native_expr(
                getattr(self._native_expr, attr)(*args, **kwargs)
            )

        return func

    def cast(self: Self, dtype: DType) -> Self:
        expr = self._native_expr
        dtype_pl = narwhals_to_native_dtype(dtype, self._version)
        return self._from_native_expr(expr.cast(dtype_pl))

    def ewm_mean(
        self: Self,
        *,
        com: float | None,
        span: float | None,
        half_life: float | None,
        alpha: float | None,
        adjust: bool,
        min_periods: int,
        ignore_nulls: bool,
    ) -> Self:
        expr = self._native_expr

        native_expr = expr.ewm_mean(
            com=com,
            span=span,
            half_life=half_life,
            alpha=alpha,
            adjust=adjust,
            min_periods=min_periods,
            ignore_nulls=ignore_nulls,
        )
        if self._backend_version < (1,):  # pragma: no cover
            import polars as pl

            return self._from_native_expr(
                pl.when(~expr.is_null()).then(native_expr).otherwise(None)
            )
        return self._from_native_expr(native_expr)

    def is_nan(self: Self) -> Self:
        if self._backend_version < (1, 18):  # pragma: no cover
            import polars as pl

            return self._from_native_expr(
                pl.when(self._native_expr.is_not_null()).then(self._native_expr.is_nan())
            )
        return self._from_native_expr(self._native_expr.is_nan())

    def rolling_var(
        self: Self,
        window_size: int,
        *,
        min_periods: int | None,
        center: bool,
        ddof: int,
    ) -> Self:
        if self._backend_version < (1,):  # pragma: no cover
            msg = "`rolling_var` not implemented for polars older than 1.0"
            raise NotImplementedError(msg)

        return self._from_native_expr(
            self._native_expr.rolling_var(
                window_size=window_size,
                min_periods=min_periods,
                center=center,
                ddof=ddof,
            )
        )

    def rolling_std(
        self: Self,
        window_size: int,
        *,
        min_periods: int | None,
        center: bool,
        ddof: int,
    ) -> Self:
        if self._backend_version < (1,):  # pragma: no cover
            msg = "`rolling_std` not implemented for polars older than 1.0"
            raise NotImplementedError(msg)

        return self._from_native_expr(
            self._native_expr.rolling_std(
                window_size=window_size,
                min_periods=min_periods,
                center=center,
                ddof=ddof,
            )
        )

    def map_batches(
        self,
        function: Callable[..., Self],
        return_dtype: DType | None,
    ) -> Self:
        if return_dtype is not None:
            return_dtype_pl = narwhals_to_native_dtype(return_dtype, self._version)
            return self._from_native_expr(
                self._native_expr.map_batches(function, return_dtype_pl)
            )
        else:
            return self._from_native_expr(self._native_expr.map_batches(function))

    def replace_strict(
        self: Self, old: Sequence[Any], new: Sequence[Any], *, return_dtype: DType | None
    ) -> Self:
        expr = self._native_expr
        return_dtype_pl = (
            narwhals_to_native_dtype(return_dtype, self._version)
            if return_dtype
            else None
        )
        if self._backend_version < (1,):
            msg = f"`replace_strict` is only available in Polars>=1.0, found version {self._backend_version}"
            raise NotImplementedError(msg)
        return self._from_native_expr(
            expr.replace_strict(old, new, return_dtype=return_dtype_pl)
        )

    def __eq__(self: Self, other: object) -> Self:  # type: ignore[override]
        return self._from_native_expr(self._native_expr.__eq__(extract_native(other)))  # type: ignore[operator]

    def __ne__(self: Self, other: object) -> Self:  # type: ignore[override]
        return self._from_native_expr(self._native_expr.__ne__(extract_native(other)))  # type: ignore[operator]

    def __ge__(self: Self, other: Any) -> Self:
        return self._from_native_expr(self._native_expr.__ge__(extract_native(other)))

    def __gt__(self: Self, other: Any) -> Self:
        return self._from_native_expr(self._native_expr.__gt__(extract_native(other)))

    def __le__(self: Self, other: Any) -> Self:
        return self._from_native_expr(self._native_expr.__le__(extract_native(other)))

    def __lt__(self: Self, other: Any) -> Self:
        return self._from_native_expr(self._native_expr.__lt__(extract_native(other)))

    def __and__(self: Self, other: PolarsExpr | bool | Any) -> Self:
        return self._from_native_expr(self._native_expr.__and__(extract_native(other)))  # type: ignore[operator]

    def __or__(self: Self, other: PolarsExpr | bool | Any) -> Self:
        return self._from_native_expr(self._native_expr.__or__(extract_native(other)))  # type: ignore[operator]

    def __add__(self: Self, other: Any) -> Self:
        return self._from_native_expr(self._native_expr.__add__(extract_native(other)))

    def __sub__(self: Self, other: Any) -> Self:
        return self._from_native_expr(self._native_expr.__sub__(extract_native(other)))

    def __mul__(self: Self, other: Any) -> Self:
        return self._from_native_expr(self._native_expr.__mul__(extract_native(other)))

    def __pow__(self: Self, other: Any) -> Self:
        return self._from_native_expr(self._native_expr.__pow__(extract_native(other)))

    def __invert__(self: Self) -> Self:
        return self._from_native_expr(self._native_expr.__invert__())

    def cum_count(self: Self, *, reverse: bool) -> Self:
        if self._backend_version < (0, 20, 4):
            not_null = ~self._native_expr.is_null()
            result = not_null.cum_sum(reverse=reverse)
        else:
            result = self._native_expr.cum_count(reverse=reverse)

        return self._from_native_expr(result)

    @property
    def dt(self: Self) -> PolarsExprDateTimeNamespace:
        return PolarsExprDateTimeNamespace(self)

    @property
    def str(self: Self) -> PolarsExprStringNamespace:
        return PolarsExprStringNamespace(self)

    @property
    def cat(self: Self) -> PolarsExprCatNamespace:
        return PolarsExprCatNamespace(self)

    @property
    def name(self: Self) -> PolarsExprNameNamespace:
        return PolarsExprNameNamespace(self)

    @property
    def list(self: Self) -> PolarsExprListNamespace:
        return PolarsExprListNamespace(self)


class PolarsExprDateTimeNamespace:
    def __init__(self: Self, expr: PolarsExpr) -> None:
        self._compliant_expr = expr

    def __getattr__(self: Self, attr: str) -> Callable[[Any], PolarsExpr]:
        def func(*args: Any, **kwargs: Any) -> PolarsExpr:
            args, kwargs = extract_args_kwargs(args, kwargs)  # type: ignore[assignment]
            return self._compliant_expr._from_native_expr(
                getattr(self._compliant_expr._native_expr.dt, attr)(*args, **kwargs)
            )

        return func


class PolarsExprStringNamespace:
    def __init__(self: Self, expr: PolarsExpr) -> None:
        self._compliant_expr = expr

    def __getattr__(self: Self, attr: str) -> Callable[[Any], PolarsExpr]:
        def func(*args: Any, **kwargs: Any) -> PolarsExpr:
            args, kwargs = extract_args_kwargs(args, kwargs)  # type: ignore[assignment]
            return self._compliant_expr._from_native_expr(
                getattr(self._compliant_expr._native_expr.str, attr)(*args, **kwargs)
            )

        return func


class PolarsExprCatNamespace:
    def __init__(self: Self, expr: PolarsExpr) -> None:
        self._compliant_expr = expr

    def __getattr__(self: Self, attr: str) -> Callable[[Any], PolarsExpr]:
        def func(*args: Any, **kwargs: Any) -> PolarsExpr:
            args, kwargs = extract_args_kwargs(args, kwargs)  # type: ignore[assignment]
            return self._compliant_expr._from_native_expr(
                getattr(self._compliant_expr._native_expr.cat, attr)(*args, **kwargs)
            )

        return func


class PolarsExprNameNamespace:
    def __init__(self: Self, expr: PolarsExpr) -> None:
        self._compliant_expr = expr

    def __getattr__(self: Self, attr: str) -> Callable[[Any], PolarsExpr]:
        def func(*args: Any, **kwargs: Any) -> PolarsExpr:
            args, kwargs = extract_args_kwargs(args, kwargs)  # type: ignore[assignment]
            return self._compliant_expr._from_native_expr(
                getattr(self._compliant_expr._native_expr.name, attr)(*args, **kwargs)
            )

        return func


class PolarsExprListNamespace:
    def __init__(self: Self, expr: PolarsExpr) -> None:
        self._expr = expr

    def len(self: Self) -> PolarsExpr:
        native_expr = self._expr._native_expr
        native_result = native_expr.list.len()

        if self._expr._backend_version < (1, 16):  # pragma: no cover
            import polars as pl

            native_result: pl.Expr = (  # type: ignore[no-redef]
                pl.when(~native_expr.is_null()).then(native_result).cast(pl.UInt32())
            )
        elif self._expr._backend_version < (1, 17):  # pragma: no cover
            import polars as pl

            native_result = native_result.cast(pl.UInt32())

        return self._expr._from_native_expr(native_result)

    # TODO(FBruzzesi): Remove `pragma: no cover` once other namespace methods are added
    def __getattr__(
        self: Self, attr: str
    ) -> Callable[[Any], PolarsExpr]:  # pragma: no cover
        def func(*args: Any, **kwargs: Any) -> PolarsExpr:
            args, kwargs = extract_args_kwargs(args, kwargs)  # type: ignore[assignment]
            return self._expr._from_native_expr(
                getattr(self._expr._native_expr.list, attr)(*args, **kwargs)
            )

        return func
