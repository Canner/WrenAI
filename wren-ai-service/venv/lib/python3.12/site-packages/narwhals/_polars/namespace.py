from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any
from typing import Iterable
from typing import Literal
from typing import Sequence
from typing import cast
from typing import overload

from narwhals._expression_parsing import parse_into_exprs
from narwhals._polars.utils import extract_args_kwargs
from narwhals._polars.utils import narwhals_to_native_dtype
from narwhals.utils import Implementation

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals._polars.dataframe import PolarsDataFrame
    from narwhals._polars.dataframe import PolarsLazyFrame
    from narwhals._polars.expr import PolarsExpr
    from narwhals._polars.typing import IntoPolarsExpr
    from narwhals.dtypes import DType
    from narwhals.utils import Version


class PolarsNamespace:
    def __init__(
        self: Self, *, backend_version: tuple[int, ...], version: Version
    ) -> None:
        self._backend_version = backend_version
        self._implementation = Implementation.POLARS
        self._version = version

    def __getattr__(self: Self, attr: str) -> Any:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        def func(*args: Any, **kwargs: Any) -> Any:
            args, kwargs = extract_args_kwargs(args, kwargs)  # type: ignore[assignment]
            return PolarsExpr(
                getattr(pl, attr)(*args, **kwargs),
                version=self._version,
                backend_version=self._backend_version,
            )

        return func

    def nth(self: Self, *indices: int) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        if self._backend_version < (1, 0, 0):
            msg = "`nth` is only supported for Polars>=1.0.0. Please use `col` for columns selection instead."
            raise AttributeError(msg)
        return PolarsExpr(
            pl.nth(*indices), version=self._version, backend_version=self._backend_version
        )

    def len(self: Self) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        if self._backend_version < (0, 20, 5):
            return PolarsExpr(
                pl.count().alias("len"),
                version=self._version,
                backend_version=self._backend_version,
            )
        return PolarsExpr(
            pl.len(), version=self._version, backend_version=self._backend_version
        )

    @overload
    def concat(
        self: Self,
        items: Sequence[PolarsDataFrame],
        *,
        how: Literal["vertical", "horizontal", "diagonal"],
    ) -> PolarsDataFrame: ...

    @overload
    def concat(
        self: Self,
        items: Sequence[PolarsLazyFrame],
        *,
        how: Literal["vertical", "horizontal", "diagonal"],
    ) -> PolarsLazyFrame: ...

    def concat(
        self: Self,
        items: Sequence[PolarsDataFrame] | Sequence[PolarsLazyFrame],
        *,
        how: Literal["vertical", "horizontal", "diagonal"],
    ) -> PolarsDataFrame | PolarsLazyFrame:
        import polars as pl

        from narwhals._polars.dataframe import PolarsDataFrame
        from narwhals._polars.dataframe import PolarsLazyFrame

        dfs: list[Any] = [item._native_frame for item in items]
        result = pl.concat(dfs, how=how)
        if isinstance(result, pl.DataFrame):
            return PolarsDataFrame(
                result,
                backend_version=items[0]._backend_version,
                version=items[0]._version,
            )
        return PolarsLazyFrame(
            result, backend_version=items[0]._backend_version, version=items[0]._version
        )

    def lit(self: Self, value: Any, dtype: DType | None = None) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        if dtype is not None:
            return PolarsExpr(
                pl.lit(value, dtype=narwhals_to_native_dtype(dtype, self._version)),
                version=self._version,
                backend_version=self._backend_version,
            )
        return PolarsExpr(
            pl.lit(value), version=self._version, backend_version=self._backend_version
        )

    def mean_horizontal(self: Self, *exprs: IntoPolarsExpr) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        polars_exprs = cast("list[PolarsExpr]", parse_into_exprs(*exprs, namespace=self))

        if self._backend_version < (0, 20, 8):
            return PolarsExpr(
                pl.sum_horizontal(e._native_expr for e in polars_exprs)
                / pl.sum_horizontal(1 - e.is_null()._native_expr for e in polars_exprs),
                version=self._version,
                backend_version=self._backend_version,
            )

        return PolarsExpr(
            pl.mean_horizontal(e._native_expr for e in polars_exprs),
            version=self._version,
            backend_version=self._backend_version,
        )

    def concat_str(
        self,
        exprs: Iterable[IntoPolarsExpr],
        *more_exprs: IntoPolarsExpr,
        separator: str,
        ignore_nulls: bool,
    ) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        pl_exprs: list[pl.Expr] = [
            expr._native_expr  # type: ignore[attr-defined]
            for expr in (
                *parse_into_exprs(*exprs, namespace=self),
                *parse_into_exprs(*more_exprs, namespace=self),
            )
        ]

        if self._backend_version < (0, 20, 6):
            null_mask = [expr.is_null() for expr in pl_exprs]
            sep = pl.lit(separator)

            if not ignore_nulls:
                null_mask_result = pl.any_horizontal(*null_mask)
                output_expr = pl.reduce(
                    lambda x, y: x.cast(pl.String()) + sep + y.cast(pl.String()),  # type: ignore[arg-type,return-value]
                    pl_exprs,
                )
                result = pl.when(~null_mask_result).then(output_expr)
            else:
                init_value, *values = [
                    pl.when(nm).then(pl.lit("")).otherwise(expr.cast(pl.String()))
                    for expr, nm in zip(pl_exprs, null_mask)
                ]
                separators = [
                    pl.when(~nm).then(sep).otherwise(pl.lit("")) for nm in null_mask[:-1]
                ]

                result = pl.fold(  # type: ignore[assignment]
                    acc=init_value,
                    function=lambda x, y: x + y,
                    exprs=[s + v for s, v in zip(separators, values)],
                )

            return PolarsExpr(
                result, version=self._version, backend_version=self._backend_version
            )

        return PolarsExpr(
            pl.concat_str(
                pl_exprs,
                separator=separator,
                ignore_nulls=ignore_nulls,
            ),
            version=self._version,
            backend_version=self._backend_version,
        )

    @property
    def selectors(self: Self) -> PolarsSelectors:
        return PolarsSelectors(self._version, backend_version=self._backend_version)


class PolarsSelectors:
    def __init__(self: Self, version: Version, backend_version: tuple[int, ...]) -> None:
        self._version = version
        self._backend_version = backend_version

    def by_dtype(self: Self, dtypes: Iterable[DType]) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        return PolarsExpr(
            pl.selectors.by_dtype(
                [narwhals_to_native_dtype(dtype, self._version) for dtype in dtypes]
            ),
            version=self._version,
            backend_version=self._backend_version,
        )

    def numeric(self: Self) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        return PolarsExpr(
            pl.selectors.numeric(),
            version=self._version,
            backend_version=self._backend_version,
        )

    def boolean(self: Self) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        return PolarsExpr(
            pl.selectors.boolean(),
            version=self._version,
            backend_version=self._backend_version,
        )

    def string(self: Self) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        return PolarsExpr(
            pl.selectors.string(),
            version=self._version,
            backend_version=self._backend_version,
        )

    def categorical(self: Self) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        return PolarsExpr(
            pl.selectors.categorical(),
            version=self._version,
            backend_version=self._backend_version,
        )

    def all(self: Self) -> PolarsExpr:
        import polars as pl

        from narwhals._polars.expr import PolarsExpr

        return PolarsExpr(
            pl.selectors.all(),
            version=self._version,
            backend_version=self._backend_version,
        )
