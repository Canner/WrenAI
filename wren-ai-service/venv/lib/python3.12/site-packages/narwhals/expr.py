from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any
from typing import Callable
from typing import Iterable
from typing import Literal
from typing import Mapping
from typing import Sequence

from narwhals._expression_parsing import extract_compliant
from narwhals.dtypes import _validate_dtype
from narwhals.expr_cat import ExprCatNamespace
from narwhals.expr_dt import ExprDateTimeNamespace
from narwhals.expr_list import ExprListNamespace
from narwhals.expr_name import ExprNameNamespace
from narwhals.expr_str import ExprStringNamespace
from narwhals.utils import _validate_rolling_arguments
from narwhals.utils import flatten

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals.dtypes import DType
    from narwhals.typing import CompliantExpr
    from narwhals.typing import CompliantNamespace
    from narwhals.typing import IntoExpr


class Expr:
    def __init__(self, to_compliant_expr: Callable[[Any], Any]) -> None:
        # callable from CompliantNamespace to CompliantExpr
        self._to_compliant_expr = to_compliant_expr

    def _taxicab_norm(self) -> Self:
        # This is just used to test out the stable api feature in a realistic-ish way.
        # It's not intended to be used.
        return self.__class__(lambda plx: self._to_compliant_expr(plx).abs().sum())

    # --- convert ---
    def alias(self, name: str) -> Self:
        """Rename the expression.

        Arguments:
            name: The new name.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2], "b": [4, 5]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_alias(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select((nw.col("b") + 10).alias("c")).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_alias`:

            >>> agnostic_alias(df_pd)
                c
            0  14
            1  15

            >>> agnostic_alias(df_pl)
            shape: (2, 1)
            ┌─────┐
            │ c   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 14  │
            │ 15  │
            └─────┘

            >>> agnostic_alias(df_pa)
            pyarrow.Table
            c: int64
            ----
            c: [[14,15]]

        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).alias(name))

    def pipe(self, function: Callable[[Any], Self], *args: Any, **kwargs: Any) -> Self:
        """Pipe function call.

        Arguments:
            function: Function to apply.
            args: Positional arguments to pass to function.
            kwargs: Keyword arguments to pass to function.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3, 4]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Lets define a library-agnostic function:

            >>> def agnostic_pipe(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").pipe(lambda x: x + 1)).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_pipe`:

            >>> agnostic_pipe(df_pd)
               a
            0  2
            1  3
            2  4
            3  5

            >>> agnostic_pipe(df_pl)
            shape: (4, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 2   │
            │ 3   │
            │ 4   │
            │ 5   │
            └─────┘

            >>> agnostic_pipe(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[2,3,4,5]]
        """
        return function(self, *args, **kwargs)

    def cast(self: Self, dtype: DType | type[DType]) -> Self:
        """Redefine an object's data type.

        Arguments:
            dtype: Data type that the object will be cast into.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_cast(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(
            ...         nw.col("foo").cast(nw.Float32), nw.col("bar").cast(nw.UInt8)
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_cast`:

            >>> agnostic_cast(df_pd)
               foo  bar
            0  1.0    6
            1  2.0    7
            2  3.0    8
            >>> agnostic_cast(df_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ foo ┆ bar │
            │ --- ┆ --- │
            │ f32 ┆ u8  │
            ╞═════╪═════╡
            │ 1.0 ┆ 6   │
            │ 2.0 ┆ 7   │
            │ 3.0 ┆ 8   │
            └─────┴─────┘
            >>> agnostic_cast(df_pa)
            pyarrow.Table
            foo: float
            bar: uint8
            ----
            foo: [[1,2,3]]
            bar: [[6,7,8]]
        """
        _validate_dtype(dtype)
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).cast(dtype),
        )

    # --- binary ---
    def __eq__(self, other: object) -> Self:  # type: ignore[override]
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__eq__(extract_compliant(plx, other))
        )

    def __ne__(self, other: object) -> Self:  # type: ignore[override]
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__ne__(extract_compliant(plx, other))
        )

    def __and__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__and__(
                extract_compliant(plx, other)
            )
        )

    def __rand__(self, other: Any) -> Self:
        def func(plx: CompliantNamespace[Any]) -> CompliantExpr[Any]:
            return plx.lit(extract_compliant(plx, other), dtype=None).__and__(
                extract_compliant(plx, self)
            )

        return self.__class__(func)

    def __or__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__or__(extract_compliant(plx, other))
        )

    def __ror__(self, other: Any) -> Self:
        def func(plx: CompliantNamespace[Any]) -> CompliantExpr[Any]:
            return plx.lit(extract_compliant(plx, other), dtype=None).__or__(
                extract_compliant(plx, self)
            )

        return self.__class__(func)

    def __add__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__add__(
                extract_compliant(plx, other)
            )
        )

    def __radd__(self, other: Any) -> Self:
        def func(plx: CompliantNamespace[Any]) -> CompliantExpr[Any]:
            return plx.lit(extract_compliant(plx, other), dtype=None).__add__(
                extract_compliant(plx, self)
            )

        return self.__class__(func)

    def __sub__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__sub__(
                extract_compliant(plx, other)
            )
        )

    def __rsub__(self, other: Any) -> Self:
        def func(plx: CompliantNamespace[Any]) -> CompliantExpr[Any]:
            return plx.lit(extract_compliant(plx, other), dtype=None).__sub__(
                extract_compliant(plx, self)
            )

        return self.__class__(func)

    def __truediv__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__truediv__(
                extract_compliant(plx, other)
            )
        )

    def __rtruediv__(self, other: Any) -> Self:
        def func(plx: CompliantNamespace[Any]) -> CompliantExpr[Any]:
            return plx.lit(extract_compliant(plx, other), dtype=None).__truediv__(
                extract_compliant(plx, self)
            )

        return self.__class__(func)

    def __mul__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__mul__(
                extract_compliant(plx, other)
            )
        )

    def __rmul__(self, other: Any) -> Self:
        def func(plx: CompliantNamespace[Any]) -> CompliantExpr[Any]:
            return plx.lit(extract_compliant(plx, other), dtype=None).__mul__(
                extract_compliant(plx, self)
            )

        return self.__class__(func)

    def __le__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__le__(extract_compliant(plx, other))
        )

    def __lt__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__lt__(extract_compliant(plx, other))
        )

    def __gt__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__gt__(extract_compliant(plx, other))
        )

    def __ge__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__ge__(extract_compliant(plx, other))
        )

    def __pow__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__pow__(
                extract_compliant(plx, other)
            )
        )

    def __rpow__(self, other: Any) -> Self:
        def func(plx: CompliantNamespace[Any]) -> CompliantExpr[Any]:
            return plx.lit(extract_compliant(plx, other), dtype=None).__pow__(
                extract_compliant(plx, self)
            )

        return self.__class__(func)

    def __floordiv__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__floordiv__(
                extract_compliant(plx, other)
            )
        )

    def __rfloordiv__(self, other: Any) -> Self:
        def func(plx: CompliantNamespace[Any]) -> CompliantExpr[Any]:
            return plx.lit(extract_compliant(plx, other), dtype=None).__floordiv__(
                extract_compliant(plx, self)
            )

        return self.__class__(func)

    def __mod__(self, other: Any) -> Self:
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).__mod__(
                extract_compliant(plx, other)
            )
        )

    def __rmod__(self, other: Any) -> Self:
        def func(plx: CompliantNamespace[Any]) -> CompliantExpr[Any]:
            return plx.lit(extract_compliant(plx, other), dtype=None).__mod__(
                extract_compliant(plx, self)
            )

        return self.__class__(func)

    # --- unary ---
    def __invert__(self) -> Self:
        return self.__class__(lambda plx: self._to_compliant_expr(plx).__invert__())

    def any(self) -> Self:
        """Return whether any of the values in the column are `True`.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [True, False], "b": [True, True]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a dataframe-agnostic function:

            >>> def agnostic_any(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").any()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_any`:

            >>> agnostic_any(df_pd)
                  a     b
            0  True  True

            >>> agnostic_any(df_pl)
            shape: (1, 2)
            ┌──────┬──────┐
            │ a    ┆ b    │
            │ ---  ┆ ---  │
            │ bool ┆ bool │
            ╞══════╪══════╡
            │ true ┆ true │
            └──────┴──────┘

            >>> agnostic_any(df_pa)
            pyarrow.Table
            a: bool
            b: bool
            ----
            a: [[true]]
            b: [[true]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).any())

    def all(self) -> Self:
        """Return whether all values in the column are `True`.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [True, False], "b": [True, True]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_all(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").all()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_all`:

            >>> agnostic_all(df_pd)
                   a     b
            0  False  True

            >>> agnostic_all(df_pl)
            shape: (1, 2)
            ┌───────┬──────┐
            │ a     ┆ b    │
            │ ---   ┆ ---  │
            │ bool  ┆ bool │
            ╞═══════╪══════╡
            │ false ┆ true │
            └───────┴──────┘

            >>> agnostic_all(df_pa)
            pyarrow.Table
            a: bool
            b: bool
            ----
            a: [[false]]
            b: [[true]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).all())

    def ewm_mean(
        self: Self,
        *,
        com: float | None = None,
        span: float | None = None,
        half_life: float | None = None,
        alpha: float | None = None,
        adjust: bool = True,
        min_periods: int = 1,
        ignore_nulls: bool = False,
    ) -> Self:
        r"""Compute exponentially-weighted moving average.

        !!! warning
            This functionality is considered **unstable**. It may be changed at any point
            without it being considered a breaking change.

        Arguments:
            com: Specify decay in terms of center of mass, $\gamma$, with <br> $\alpha = \frac{1}{1+\gamma}\forall\gamma\geq0$
            span: Specify decay in terms of span, $\theta$, with <br> $\alpha = \frac{2}{\theta + 1} \forall \theta \geq 1$
            half_life: Specify decay in terms of half-life, $\tau$, with <br> $\alpha = 1 - \exp \left\{ \frac{ -\ln(2) }{ \tau } \right\} \forall \tau > 0$
            alpha: Specify smoothing factor alpha directly, $0 < \alpha \leq 1$.
            adjust: Divide by decaying adjustment factor in beginning periods to account for imbalance in relative weightings

                - When `adjust=True` (the default) the EW function is calculated
                  using weights $w_i = (1 - \alpha)^i$
                - When `adjust=False` the EW function is calculated recursively by
                  $$
                  y_0=x_0
                  $$
                  $$
                  y_t = (1 - \alpha)y_{t - 1} + \alpha x_t
                  $$
            min_periods: Minimum number of observations in window required to have a value, (otherwise result is null).
            ignore_nulls: Ignore missing values when calculating weights.

                - When `ignore_nulls=False` (default), weights are based on absolute
                  positions.
                  For example, the weights of $x_0$ and $x_2$ used in
                  calculating the final weighted average of $[x_0, None, x_2]$ are
                  $(1-\alpha)^2$ and $1$ if `adjust=True`, and
                  $(1-\alpha)^2$ and $\alpha$ if `adjust=False`.
                - When `ignore_nulls=True`, weights are based
                  on relative positions. For example, the weights of
                  $x_0$ and $x_2$ used in calculating the final weighted
                  average of $[x_0, None, x_2]$ are
                  $1-\alpha$ and $1$ if `adjust=True`,
                  and $1-\alpha$ and $\alpha$ if `adjust=False`.

        Returns:
            Expr

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)

            We define a library agnostic function:

            >>> def agnostic_ewm_mean(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(
            ...         nw.col("a").ewm_mean(com=1, ignore_nulls=False)
            ...     ).to_native()

            We can then pass either pandas or Polars to `agnostic_ewm_mean`:

            >>> agnostic_ewm_mean(df_pd)
                      a
            0  1.000000
            1  1.666667
            2  2.428571

            >>> agnostic_ewm_mean(df_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (3, 1)
            ┌──────────┐
            │ a        │
            │ ---      │
            │ f64      │
            ╞══════════╡
            │ 1.0      │
            │ 1.666667 │
            │ 2.428571 │
            └──────────┘
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).ewm_mean(
                com=com,
                span=span,
                half_life=half_life,
                alpha=alpha,
                adjust=adjust,
                min_periods=min_periods,
                ignore_nulls=ignore_nulls,
            )
        )

    def mean(self) -> Self:
        """Get mean value.

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [-1, 0, 1], "b": [2, 4, 6]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_mean(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").mean()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_mean`:

            >>> agnostic_mean(df_pd)
                 a    b
            0  0.0  4.0

            >>> agnostic_mean(df_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ f64 ┆ f64 │
            ╞═════╪═════╡
            │ 0.0 ┆ 4.0 │
            └─────┴─────┘

            >>> agnostic_mean(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[0]]
            b: [[4]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).mean())

    def median(self) -> Self:
        """Get median value.

        Returns:
            A new expression.

        Notes:
            Results might slightly differ across backends due to differences in the underlying algorithms used to compute the median.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 8, 3], "b": [4, 5, 2]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_median(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").median()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_median`:

            >>> agnostic_median(df_pd)
                 a    b
            0  3.0  4.0

            >>> agnostic_median(df_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ f64 ┆ f64 │
            ╞═════╪═════╡
            │ 3.0 ┆ 4.0 │
            └─────┴─────┘

            >>> agnostic_median(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[3]]
            b: [[4]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).median())

    def std(self, *, ddof: int = 1) -> Self:
        """Get standard deviation.

        Arguments:
            ddof: "Delta Degrees of Freedom": the divisor used in the calculation is N - ddof,
                where N represents the number of elements. By default ddof is 1.

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [20, 25, 60], "b": [1.5, 1, -1.4]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_std(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").std(ddof=0)).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_std`:

            >>> agnostic_std(df_pd)
                      a         b
            0  17.79513  1.265789
            >>> agnostic_std(df_pl)
            shape: (1, 2)
            ┌──────────┬──────────┐
            │ a        ┆ b        │
            │ ---      ┆ ---      │
            │ f64      ┆ f64      │
            ╞══════════╪══════════╡
            │ 17.79513 ┆ 1.265789 │
            └──────────┴──────────┘
            >>> agnostic_std(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[17.795130420052185]]
            b: [[1.2657891697365016]]

        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).std(ddof=ddof))

    def var(self, *, ddof: int = 1) -> Self:
        """Get variance.

        Arguments:
            ddof: "Delta Degrees of Freedom": the divisor used in the calculation is N - ddof,
                     where N represents the number of elements. By default ddof is 1.

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [20, 25, 60], "b": [1.5, 1, -1.4]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_var(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").var(ddof=0)).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_var`:

            >>> agnostic_var(df_pd)
                        a         b
            0  316.666667  1.602222

            >>> agnostic_var(df_pl)
            shape: (1, 2)
            ┌────────────┬──────────┐
            │ a          ┆ b        │
            │ ---        ┆ ---      │
            │ f64        ┆ f64      │
            ╞════════════╪══════════╡
            │ 316.666667 ┆ 1.602222 │
            └────────────┴──────────┘

            >>> agnostic_var(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[316.6666666666667]]
            b: [[1.6022222222222222]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).var(ddof=ddof))

    def map_batches(
        self,
        function: Callable[[Any], Self],
        return_dtype: DType | None = None,
    ) -> Self:
        """Apply a custom python function to a whole Series or sequence of Series.

        The output of this custom function is presumed to be either a Series,
        or a NumPy array (in which case it will be automatically converted into
        a Series).

        Arguments:
            function: Function to apply to Series.
            return_dtype: Dtype of the output Series.
                If not set, the dtype will be inferred based on the first non-null value
                that is returned by the function.

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3], "b": [4, 5, 6]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_map_batches(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(
            ...         nw.col("a", "b").map_batches(
            ...             lambda s: s.to_numpy() + 1, return_dtype=nw.Float64
            ...         )
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_map_batches`:

            >>> agnostic_map_batches(df_pd)
                 a    b
            0  2.0  5.0
            1  3.0  6.0
            2  4.0  7.0
            >>> agnostic_map_batches(df_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ f64 ┆ f64 │
            ╞═════╪═════╡
            │ 2.0 ┆ 5.0 │
            │ 3.0 ┆ 6.0 │
            │ 4.0 ┆ 7.0 │
            └─────┴─────┘
            >>> agnostic_map_batches(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[2,3,4]]
            b: [[5,6,7]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).map_batches(
                function=function, return_dtype=return_dtype
            )
        )

    def skew(self: Self) -> Self:
        """Calculate the sample skewness of a column.

        Returns:
            An expression representing the sample skewness of the column.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3, 4, 5], "b": [1, 1, 2, 10, 100]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_skew(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").skew()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_skew`:

            >>> agnostic_skew(df_pd)
                 a         b
            0  0.0  1.472427

            >>> agnostic_skew(df_pl)
            shape: (1, 2)
            ┌─────┬──────────┐
            │ a   ┆ b        │
            │ --- ┆ ---      │
            │ f64 ┆ f64      │
            ╞═════╪══════════╡
            │ 0.0 ┆ 1.472427 │
            └─────┴──────────┘

            >>> agnostic_skew(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[0]]
            b: [[1.4724267269058975]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).skew())

    def sum(self) -> Expr:
        """Return the sum value.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [5, 10], "b": [50, 100]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_sum(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").sum()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_sum`:

            >>> agnostic_sum(df_pd)
                a    b
            0  15  150
            >>> agnostic_sum(df_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 15  ┆ 150 │
            └─────┴─────┘
            >>> agnostic_sum(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[15]]
            b: [[150]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).sum())

    def min(self) -> Self:
        """Returns the minimum value(s) from a column(s).

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2], "b": [4, 3]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_min(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.min("a", "b")).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_min`:

            >>> agnostic_min(df_pd)
               a  b
            0  1  3

            >>> agnostic_min(df_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 3   │
            └─────┴─────┘

            >>> agnostic_min(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[1]]
            b: [[3]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).min())

    def max(self) -> Self:
        """Returns the maximum value(s) from a column(s).

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [10, 20], "b": [50, 100]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_max(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.max("a", "b")).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_max`:

            >>> agnostic_max(df_pd)
                a    b
            0  20  100

            >>> agnostic_max(df_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 20  ┆ 100 │
            └─────┴─────┘

            >>> agnostic_max(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[20]]
            b: [[100]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).max())

    def arg_min(self) -> Self:
        """Returns the index of the minimum value.

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [10, 20], "b": [150, 100]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_arg_min(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(
            ...         nw.col("a", "b").arg_min().name.suffix("_arg_min")
            ...     ).to_native()

            We can then pass any supported library such as Pandas, Polars, or
            PyArrow to `agnostic_arg_min`:

            >>> agnostic_arg_min(df_pd)
               a_arg_min  b_arg_min
            0          0          1

            >>> agnostic_arg_min(df_pl)
            shape: (1, 2)
            ┌───────────┬───────────┐
            │ a_arg_min ┆ b_arg_min │
            │ ---       ┆ ---       │
            │ u32       ┆ u32       │
            ╞═══════════╪═══════════╡
            │ 0         ┆ 1         │
            └───────────┴───────────┘

            >>> agnostic_arg_min(df_pa)
            pyarrow.Table
            a_arg_min: int64
            b_arg_min: int64
            ----
            a_arg_min: [[0]]
            b_arg_min: [[1]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).arg_min())

    def arg_max(self) -> Self:
        """Returns the index of the maximum value.

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [10, 20], "b": [150, 100]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_arg_max(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(
            ...         nw.col("a", "b").arg_max().name.suffix("_arg_max")
            ...     ).to_native()

            We can then pass any supported library such as Pandas, Polars, or
            PyArrow to `agnostic_arg_max`:

            >>> agnostic_arg_max(df_pd)
               a_arg_max  b_arg_max
            0          1          0

            >>> agnostic_arg_max(df_pl)
            shape: (1, 2)
            ┌───────────┬───────────┐
            │ a_arg_max ┆ b_arg_max │
            │ ---       ┆ ---       │
            │ u32       ┆ u32       │
            ╞═══════════╪═══════════╡
            │ 1         ┆ 0         │
            └───────────┴───────────┘

            >>> agnostic_arg_max(df_pa)
            pyarrow.Table
            a_arg_max: int64
            b_arg_max: int64
            ----
            a_arg_max: [[1]]
            b_arg_max: [[0]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).arg_max())

    def count(self) -> Self:
        """Returns the number of non-null elements in the column.

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3], "b": [None, 4, 4]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_count(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.all().count()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_count`:

            >>> agnostic_count(df_pd)
               a  b
            0  3  2

            >>> agnostic_count(df_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ u32 ┆ u32 │
            ╞═════╪═════╡
            │ 3   ┆ 2   │
            └─────┴─────┘

            >>> agnostic_count(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[3]]
            b: [[2]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).count())

    def n_unique(self) -> Self:
        """Returns count of unique values.

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3, 4, 5], "b": [1, 1, 3, 3, 5]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_n_unique(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").n_unique()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_n_unique`:

            >>> agnostic_n_unique(df_pd)
               a  b
            0  5  3
            >>> agnostic_n_unique(df_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ u32 ┆ u32 │
            ╞═════╪═════╡
            │ 5   ┆ 3   │
            └─────┴─────┘
            >>> agnostic_n_unique(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[5]]
            b: [[3]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).n_unique())

    def unique(self, *, maintain_order: bool = False) -> Self:
        """Return unique values of this expression.

        Arguments:
            maintain_order: Keep the same order as the original expression. This may be more
                expensive to compute. Settings this to `True` blocks the possibility
                to run on the streaming engine for Polars.

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 1, 3, 5, 5], "b": [2, 4, 4, 6, 6]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_unique(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").unique(maintain_order=True)).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_unique`:

            >>> agnostic_unique(df_pd)
               a  b
            0  1  2
            1  3  4
            2  5  6

            >>> agnostic_unique(df_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 2   │
            │ 3   ┆ 4   │
            │ 5   ┆ 6   │
            └─────┴─────┘

            >>> agnostic_unique(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[1,3,5]]
            b: [[2,4,6]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).unique(maintain_order=maintain_order)
        )

    def abs(self) -> Self:
        """Return absolute value of each element.

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, -2], "b": [-3, 4]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_abs(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").abs()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_abs`:

            >>> agnostic_abs(df_pd)
               a  b
            0  1  3
            1  2  4

            >>> agnostic_abs(df_pl)
            shape: (2, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 3   │
            │ 2   ┆ 4   │
            └─────┴─────┘

            >>> agnostic_abs(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[1,2]]
            b: [[3,4]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).abs())

    def cum_sum(self: Self, *, reverse: bool = False) -> Self:
        """Return cumulative sum.

        Arguments:
            reverse: reverse the operation

        Returns:
            A new expression.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 1, 3, 5, 5], "b": [2, 4, 4, 6, 6]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_cum_sum(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a", "b").cum_sum()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_cum_sum`:

            >>> agnostic_cum_sum(df_pd)
                a   b
            0   1   2
            1   2   6
            2   5  10
            3  10  16
            4  15  22
            >>> agnostic_cum_sum(df_pl)
            shape: (5, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 2   │
            │ 2   ┆ 6   │
            │ 5   ┆ 10  │
            │ 10  ┆ 16  │
            │ 15  ┆ 22  │
            └─────┴─────┘
            >>> agnostic_cum_sum(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[1,2,5,10,15]]
            b: [[2,6,10,16,22]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).cum_sum(reverse=reverse)
        )

    def diff(self) -> Self:
        """Returns the difference between each element and the previous one.

        Returns:
            A new expression.

        Notes:
            pandas may change the dtype here, for example when introducing missing
            values in an integer column. To ensure, that the dtype doesn't change,
            you may want to use `fill_null` and `cast`. For example, to calculate
            the diff and fill missing values with `0` in a Int64 column, you could
            do:

                nw.col("a").diff().fill_null(0).cast(nw.Int64)

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 1, 3, 5, 5]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_diff(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(a_diff=nw.col("a").diff()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_diff`:

            >>> agnostic_diff(df_pd)
               a_diff
            0     NaN
            1     0.0
            2     2.0
            3     2.0
            4     0.0

            >>> agnostic_diff(df_pl)
            shape: (5, 1)
            ┌────────┐
            │ a_diff │
            │ ---    │
            │ i64    │
            ╞════════╡
            │ null   │
            │ 0      │
            │ 2      │
            │ 2      │
            │ 0      │
            └────────┘

            >>> agnostic_diff(df_pa)
            pyarrow.Table
            a_diff: int64
            ----
            a_diff: [[null,0,2,2,0]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).diff())

    def shift(self, n: int) -> Self:
        """Shift values by `n` positions.

        Arguments:
            n: Number of positions to shift values by.

        Returns:
            A new expression.

        Notes:
            pandas may change the dtype here, for example when introducing missing
            values in an integer column. To ensure, that the dtype doesn't change,
            you may want to use `fill_null` and `cast`. For example, to shift
            and fill missing values with `0` in a Int64 column, you could
            do:

                nw.col("a").shift(1).fill_null(0).cast(nw.Int64)

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 1, 3, 5, 5]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_shift(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(a_shift=nw.col("a").shift(n=1)).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_shift`:

            >>> agnostic_shift(df_pd)
               a_shift
            0      NaN
            1      1.0
            2      1.0
            3      3.0
            4      5.0

            >>> agnostic_shift(df_pl)
            shape: (5, 1)
            ┌─────────┐
            │ a_shift │
            │ ---     │
            │ i64     │
            ╞═════════╡
            │ null    │
            │ 1       │
            │ 1       │
            │ 3       │
            │ 5       │
            └─────────┘

            >>> agnostic_shift(df_pa)
            pyarrow.Table
            a_shift: int64
            ----
            a_shift: [[null,1,1,3,5]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).shift(n))

    def replace_strict(
        self,
        old: Sequence[Any] | Mapping[Any, Any],
        new: Sequence[Any] | None = None,
        *,
        return_dtype: DType | type[DType] | None = None,
    ) -> Self:
        """Replace all values by different values.

        This function must replace all non-null input values (else it raises an error).

        Arguments:
            old: Sequence of values to replace. It also accepts a mapping of values to
                their replacement as syntactic sugar for
                `replace_all(old=list(mapping.keys()), new=list(mapping.values()))`.
            new: Sequence of values to replace by. Length must match the length of `old`.
            return_dtype: The data type of the resulting expression. If set to `None`
                (default), the data type is determined automatically based on the other
                inputs.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [3, 0, 1, 2]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define dataframe-agnostic functions:

            >>> def agnostic_replace_strict(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         b=nw.col("a").replace_strict(
            ...             [0, 1, 2, 3],
            ...             ["zero", "one", "two", "three"],
            ...             return_dtype=nw.String,
            ...         )
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_replace_strict`:

            >>> agnostic_replace_strict(df_pd)
               a      b
            0  3  three
            1  0   zero
            2  1    one
            3  2    two

            >>> agnostic_replace_strict(df_pl)
            shape: (4, 2)
            ┌─────┬───────┐
            │ a   ┆ b     │
            │ --- ┆ ---   │
            │ i64 ┆ str   │
            ╞═════╪═══════╡
            │ 3   ┆ three │
            │ 0   ┆ zero  │
            │ 1   ┆ one   │
            │ 2   ┆ two   │
            └─────┴───────┘

            >>> agnostic_replace_strict(df_pa)
            pyarrow.Table
            a: int64
            b: string
            ----
            a: [[3,0,1,2]]
            b: [["three","zero","one","two"]]
        """
        if new is None:
            if not isinstance(old, Mapping):
                msg = "`new` argument is required if `old` argument is not a Mapping type"
                raise TypeError(msg)

            new = list(old.values())
            old = list(old.keys())

        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).replace_strict(
                old, new, return_dtype=return_dtype
            )
        )

    def sort(self, *, descending: bool = False, nulls_last: bool = False) -> Self:
        """Sort this column. Place null values first.

        Arguments:
            descending: Sort in descending order.
            nulls_last: Place null values last instead of first.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [5, None, 1, 2]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define dataframe-agnostic functions:

            >>> def agnostic_sort(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").sort()).to_native()

            >>> def agnostic_sort_descending(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").sort(descending=True)).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_sort` and `agnostic_sort_descending`:

            >>> agnostic_sort(df_pd)
                 a
            1  NaN
            2  1.0
            3  2.0
            0  5.0

            >>> agnostic_sort(df_pl)
            shape: (4, 1)
            ┌──────┐
            │ a    │
            │ ---  │
            │ i64  │
            ╞══════╡
            │ null │
            │ 1    │
            │ 2    │
            │ 5    │
            └──────┘

            >>> agnostic_sort(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[null,1,2,5]]

            >>> agnostic_sort_descending(df_pd)
                 a
            1  NaN
            0  5.0
            3  2.0
            2  1.0

            >>> agnostic_sort_descending(df_pl)
            shape: (4, 1)
            ┌──────┐
            │ a    │
            │ ---  │
            │ i64  │
            ╞══════╡
            │ null │
            │ 5    │
            │ 2    │
            │ 1    │
            └──────┘

            >>> agnostic_sort_descending(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[null,5,2,1]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).sort(
                descending=descending, nulls_last=nulls_last
            )
        )

    # --- transform ---
    def is_between(
        self: Self,
        lower_bound: Any | IntoExpr,
        upper_bound: Any | IntoExpr,
        closed: Literal["left", "right", "none", "both"] = "both",
    ) -> Self:
        """Check if this expression is between the given lower and upper bounds.

        Arguments:
            lower_bound: Lower bound value.
            upper_bound: Upper bound value.
            closed: Define which sides of the interval are closed (inclusive).

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3, 4, 5]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_is_between(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").is_between(2, 4, "right")).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_is_between`:

            >>> agnostic_is_between(df_pd)
                   a
            0  False
            1  False
            2   True
            3   True
            4  False

            >>> agnostic_is_between(df_pl)
            shape: (5, 1)
            ┌───────┐
            │ a     │
            │ ---   │
            │ bool  │
            ╞═══════╡
            │ false │
            │ false │
            │ true  │
            │ true  │
            │ false │
            └───────┘

            >>> agnostic_is_between(df_pa)
            pyarrow.Table
            a: bool
            ----
            a: [[false,false,true,true,false]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).is_between(
                extract_compliant(plx, lower_bound),
                extract_compliant(plx, upper_bound),
                closed,
            )
        )

    def is_in(self, other: Any) -> Self:
        """Check if elements of this expression are present in the other iterable.

        Arguments:
            other: iterable

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 9, 10]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_is_in(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(b=nw.col("a").is_in([1, 2])).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_is_in`:

            >>> agnostic_is_in(df_pd)
                a      b
            0   1   True
            1   2   True
            2   9  False
            3  10  False

            >>> agnostic_is_in(df_pl)
            shape: (4, 2)
            ┌─────┬───────┐
            │ a   ┆ b     │
            │ --- ┆ ---   │
            │ i64 ┆ bool  │
            ╞═════╪═══════╡
            │ 1   ┆ true  │
            │ 2   ┆ true  │
            │ 9   ┆ false │
            │ 10  ┆ false │
            └─────┴───────┘

            >>> agnostic_is_in(df_pa)
            pyarrow.Table
            a: int64
            b: bool
            ----
            a: [[1,2,9,10]]
            b: [[true,true,false,false]]
        """
        if isinstance(other, Iterable) and not isinstance(other, (str, bytes)):
            return self.__class__(
                lambda plx: self._to_compliant_expr(plx).is_in(
                    extract_compliant(plx, other)
                )
            )
        else:
            msg = "Narwhals `is_in` doesn't accept expressions as an argument, as opposed to Polars. You should provide an iterable instead."
            raise NotImplementedError(msg)

    def filter(self, *predicates: Any) -> Self:
        """Filters elements based on a condition, returning a new expression.

        Arguments:
            predicates: Conditions to filter by (which get ANDed together).

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [2, 3, 4, 5, 6, 7], "b": [10, 11, 12, 13, 14, 15]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(
            ...         nw.col("a").filter(nw.col("a") > 4),
            ...         nw.col("b").filter(nw.col("b") < 13),
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_filter`:

            >>> agnostic_filter(df_pd)
               a   b
            3  5  10
            4  6  11
            5  7  12

            >>> agnostic_filter(df_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 5   ┆ 10  │
            │ 6   ┆ 11  │
            │ 7   ┆ 12  │
            └─────┴─────┘

            >>> agnostic_filter(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[5,6,7]]
            b: [[10,11,12]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).filter(
                *[extract_compliant(plx, pred) for pred in flatten(predicates)],
            )
        )

    def is_null(self) -> Self:
        """Returns a boolean Series indicating which values are null.

        Returns:
            A new expression.

        Notes:
            pandas handles null values differently from Polars and PyArrow.
            See [null_handling](../pandas_like_concepts/null_handling.md/)
            for reference.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> df_pd = pd.DataFrame(
            ...     {
            ...         "a": [2, 4, None, 3, 5],
            ...         "b": [2.0, 4.0, float("nan"), 3.0, 5.0],
            ...     }
            ... )
            >>> data = {
            ...     "a": [2, 4, None, 3, 5],
            ...     "b": [2.0, 4.0, None, 3.0, 5.0],
            ... }
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_is_null(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         a_is_null=nw.col("a").is_null(), b_is_null=nw.col("b").is_null()
            ...     ).to_native()

            We can then pass any supported library such as Pandas, Polars, or
            PyArrow to `agnostic_is_null`:

            >>> agnostic_is_null(df_pd)
                 a    b  a_is_null  b_is_null
            0  2.0  2.0      False      False
            1  4.0  4.0      False      False
            2  NaN  NaN       True       True
            3  3.0  3.0      False      False
            4  5.0  5.0      False      False

            >>> agnostic_is_null(df_pl)
            shape: (5, 4)
            ┌──────┬──────┬───────────┬───────────┐
            │ a    ┆ b    ┆ a_is_null ┆ b_is_null │
            │ ---  ┆ ---  ┆ ---       ┆ ---       │
            │ i64  ┆ f64  ┆ bool      ┆ bool      │
            ╞══════╪══════╪═══════════╪═══════════╡
            │ 2    ┆ 2.0  ┆ false     ┆ false     │
            │ 4    ┆ 4.0  ┆ false     ┆ false     │
            │ null ┆ null ┆ true      ┆ true      │
            │ 3    ┆ 3.0  ┆ false     ┆ false     │
            │ 5    ┆ 5.0  ┆ false     ┆ false     │
            └──────┴──────┴───────────┴───────────┘

            >>> agnostic_is_null(df_pa)
            pyarrow.Table
            a: int64
            b: double
            a_is_null: bool
            b_is_null: bool
            ----
            a: [[2,4,null,3,5]]
            b: [[2,4,null,3,5]]
            a_is_null: [[false,false,true,false,false]]
            b_is_null: [[false,false,true,false,false]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).is_null())

    def is_nan(self) -> Self:
        """Indicate which values are NaN.

        Returns:
            A new expression.

        Notes:
            pandas handles null values differently from Polars and PyArrow.
            See [null_handling](../pandas_like_concepts/null_handling.md/)
            for reference.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"orig": [0.0, None, 2.0]}
            >>> df_pd = pd.DataFrame(data).astype({"orig": "Float64"})
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_self_div_is_nan(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         divided=nw.col("orig") / nw.col("orig"),
            ...         divided_is_nan=(nw.col("orig") / nw.col("orig")).is_nan(),
            ...     ).to_native()

            We can then pass any supported library such as Pandas, Polars, or
            PyArrow to `agnostic_self_div_is_nan`:

            >>> print(agnostic_self_div_is_nan(df_pd))
               orig  divided  divided_is_nan
            0   0.0      NaN            True
            1  <NA>     <NA>            <NA>
            2   2.0      1.0           False

            >>> print(agnostic_self_div_is_nan(df_pl))
            shape: (3, 3)
            ┌──────┬─────────┬────────────────┐
            │ orig ┆ divided ┆ divided_is_nan │
            │ ---  ┆ ---     ┆ ---            │
            │ f64  ┆ f64     ┆ bool           │
            ╞══════╪═════════╪════════════════╡
            │ 0.0  ┆ NaN     ┆ true           │
            │ null ┆ null    ┆ null           │
            │ 2.0  ┆ 1.0     ┆ false          │
            └──────┴─────────┴────────────────┘

            >>> print(agnostic_self_div_is_nan(df_pa))
            pyarrow.Table
            orig: double
            divided: double
            divided_is_nan: bool
            ----
            orig: [[0,null,2]]
            divided: [[nan,null,1]]
            divided_is_nan: [[true,null,false]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).is_nan())

    def arg_true(self) -> Self:
        """Find elements where boolean expression is True.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, None, None, 2]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_arg_true(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").is_null().arg_true()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_arg_true`:

            >>> agnostic_arg_true(df_pd)
               a
            1  1
            2  2

            >>> agnostic_arg_true(df_pl)
            shape: (2, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ u32 │
            ╞═════╡
            │ 1   │
            │ 2   │
            └─────┘

            >>> agnostic_arg_true(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[1,2]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).arg_true())

    def fill_null(
        self,
        value: Any | None = None,
        strategy: Literal["forward", "backward"] | None = None,
        limit: int | None = None,
    ) -> Self:
        """Fill null values with given value.

        Arguments:
            value: Value used to fill null values.
            strategy: Strategy used to fill null values.
            limit: Number of consecutive null values to fill when using the 'forward' or 'backward' strategy.

        Returns:
            A new expression.

        Notes:
            pandas handles null values differently from Polars and PyArrow.
            See [null_handling](../pandas_like_concepts/null_handling.md/)
            for reference.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> df_pd = pd.DataFrame(
            ...     {
            ...         "a": [2, 4, None, None, 3, 5],
            ...         "b": [2.0, 4.0, float("nan"), float("nan"), 3.0, 5.0],
            ...     }
            ... )
            >>> data = {
            ...     "a": [2, 4, None, None, 3, 5],
            ...     "b": [2.0, 4.0, None, None, 3.0, 5.0],
            ... }
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_fill_null(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(nw.col("a", "b").fill_null(0)).to_native()

            We can then pass any supported library such as Pandas, Polars, or
            PyArrow to `agnostic_fill_null`:

            >>> agnostic_fill_null(df_pd)
                 a    b
            0  2.0  2.0
            1  4.0  4.0
            2  0.0  0.0
            3  0.0  0.0
            4  3.0  3.0
            5  5.0  5.0

            >>> agnostic_fill_null(df_pl)
            shape: (6, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ f64 │
            ╞═════╪═════╡
            │ 2   ┆ 2.0 │
            │ 4   ┆ 4.0 │
            │ 0   ┆ 0.0 │
            │ 0   ┆ 0.0 │
            │ 3   ┆ 3.0 │
            │ 5   ┆ 5.0 │
            └─────┴─────┘

            >>> agnostic_fill_null(df_pa)
            pyarrow.Table
            a: int64
            b: double
            ----
            a: [[2,4,0,0,3,5]]
            b: [[2,4,0,0,3,5]]

            Using a strategy:

            >>> def agnostic_fill_null_with_strategy(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         nw.col("a", "b")
            ...         .fill_null(strategy="forward", limit=1)
            ...         .name.suffix("_filled")
            ...     ).to_native()

            >>> agnostic_fill_null_with_strategy(df_pd)
                 a    b  a_filled  b_filled
            0  2.0  2.0       2.0       2.0
            1  4.0  4.0       4.0       4.0
            2  NaN  NaN       4.0       4.0
            3  NaN  NaN       NaN       NaN
            4  3.0  3.0       3.0       3.0
            5  5.0  5.0       5.0       5.0

            >>> agnostic_fill_null_with_strategy(df_pl)
            shape: (6, 4)
            ┌──────┬──────┬──────────┬──────────┐
            │ a    ┆ b    ┆ a_filled ┆ b_filled │
            │ ---  ┆ ---  ┆ ---      ┆ ---      │
            │ i64  ┆ f64  ┆ i64      ┆ f64      │
            ╞══════╪══════╪══════════╪══════════╡
            │ 2    ┆ 2.0  ┆ 2        ┆ 2.0      │
            │ 4    ┆ 4.0  ┆ 4        ┆ 4.0      │
            │ null ┆ null ┆ 4        ┆ 4.0      │
            │ null ┆ null ┆ null     ┆ null     │
            │ 3    ┆ 3.0  ┆ 3        ┆ 3.0      │
            │ 5    ┆ 5.0  ┆ 5        ┆ 5.0      │
            └──────┴──────┴──────────┴──────────┘

            >>> agnostic_fill_null_with_strategy(df_pa)
            pyarrow.Table
            a: int64
            b: double
            a_filled: int64
            b_filled: double
            ----
            a: [[2,4,null,null,3,5]]
            b: [[2,4,null,null,3,5]]
            a_filled: [[2,4,4,null,3,5]]
            b_filled: [[2,4,4,null,3,5]]
        """
        if value is not None and strategy is not None:
            msg = "cannot specify both `value` and `strategy`"
            raise ValueError(msg)
        if value is None and strategy is None:
            msg = "must specify either a fill `value` or `strategy`"
            raise ValueError(msg)
        if strategy is not None and strategy not in {"forward", "backward"}:
            msg = f"strategy not supported: {strategy}"
            raise ValueError(msg)
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).fill_null(
                value=value, strategy=strategy, limit=limit
            )
        )

    # --- partial reduction ---
    def drop_nulls(self) -> Self:
        """Drop null values.

        Returns:
            A new expression.

        Notes:
            pandas handles null values differently from Polars and PyArrow.
            See [null_handling](../pandas_like_concepts/null_handling.md/)
            for reference.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> df_pd = pd.DataFrame({"a": [2.0, 4.0, float("nan"), 3.0, None, 5.0]})
            >>> df_pl = pl.DataFrame({"a": [2.0, 4.0, None, 3.0, None, 5.0]})
            >>> df_pa = pa.table({"a": [2.0, 4.0, None, 3.0, None, 5.0]})

            Let's define a dataframe-agnostic function:

            >>> def agnostic_drop_nulls(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").drop_nulls()).to_native()

            We can then pass any supported library such as Pandas, Polars, or
            PyArrow to `agnostic_drop_nulls`:

            >>> agnostic_drop_nulls(df_pd)
                 a
            0  2.0
            1  4.0
            3  3.0
            5  5.0

            >>> agnostic_drop_nulls(df_pl)
            shape: (4, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ f64 │
            ╞═════╡
            │ 2.0 │
            │ 4.0 │
            │ 3.0 │
            │ 5.0 │
            └─────┘

            >>> agnostic_drop_nulls(df_pa)
            pyarrow.Table
            a: double
            ----
            a: [[2,4,3,5]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).drop_nulls())

    def sample(
        self: Self,
        n: int | None = None,
        *,
        fraction: float | None = None,
        with_replacement: bool = False,
        seed: int | None = None,
    ) -> Self:
        """Sample randomly from this expression.

        Arguments:
            n: Number of items to return. Cannot be used with fraction.
            fraction: Fraction of items to return. Cannot be used with n.
            with_replacement: Allow values to be sampled more than once.
            seed: Seed for the random number generator. If set to None (default), a random
                seed is generated for each sample operation.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_sample(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(
            ...         nw.col("a").sample(fraction=1.0, with_replacement=True)
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_sample`:

            >>> agnostic_sample(df_pd)  # doctest: +SKIP
               a
            2  3
            0  1
            2  3

            >>> agnostic_sample(df_pl)  # doctest: +SKIP
            shape: (3, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ f64 │
            ╞═════╡
            │ 2   │
            │ 3   │
            │ 3   │
            └─────┘

            >>> agnostic_sample(df_pa)  # doctest: +SKIP
            pyarrow.Table
            a: int64
            ----
            a: [[1,3,3]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).sample(
                n, fraction=fraction, with_replacement=with_replacement, seed=seed
            )
        )

    def over(self, *keys: str | Iterable[str]) -> Self:
        """Compute expressions over the given groups.

        Arguments:
            keys: Names of columns to compute window expression over.
                  Must be names of columns, as opposed to expressions -
                  so, this is a bit less flexible than Polars' `Expr.over`.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3], "b": [1, 1, 2]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_min_over_b(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         a_min_per_group=nw.col("a").min().over("b")
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_min_over_b`:

            >>> agnostic_min_over_b(df_pd)
               a  b  a_min_per_group
            0  1  1                1
            1  2  1                1
            2  3  2                3

            >>> agnostic_min_over_b(df_pl)
            shape: (3, 3)
            ┌─────┬─────┬─────────────────┐
            │ a   ┆ b   ┆ a_min_per_group │
            │ --- ┆ --- ┆ ---             │
            │ i64 ┆ i64 ┆ i64             │
            ╞═════╪═════╪═════════════════╡
            │ 1   ┆ 1   ┆ 1               │
            │ 2   ┆ 1   ┆ 1               │
            │ 3   ┆ 2   ┆ 3               │
            └─────┴─────┴─────────────────┘

            >>> agnostic_min_over_b(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            a_min_per_group: int64
            ----
            a: [[1,2,3]]
            b: [[1,1,2]]
            a_min_per_group: [[1,1,3]]

            Cumulative operations are also supported, but (currently) only for
            pandas and Polars:

            >>> def agnostic_cum_sum(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(c=nw.col("a").cum_sum().over("b")).to_native()

            >>> agnostic_cum_sum(df_pd)
               a  b  c
            0  1  1  1
            1  2  1  3
            2  3  2  3

            >>> agnostic_cum_sum(df_pl)
            shape: (3, 3)
            ┌─────┬─────┬─────┐
            │ a   ┆ b   ┆ c   │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ i64 │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 1   ┆ 1   │
            │ 2   ┆ 1   ┆ 3   │
            │ 3   ┆ 2   ┆ 3   │
            └─────┴─────┴─────┘
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).over(flatten(keys))
        )

    def is_duplicated(self) -> Self:
        r"""Return a boolean mask indicating duplicated values.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3, 1], "b": ["a", "a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_is_duplicated(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.all().is_duplicated()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_is_duplicated`:

            >>> agnostic_is_duplicated(df_pd)
                   a      b
            0   True   True
            1  False   True
            2  False  False
            3   True  False

            >>> agnostic_is_duplicated(df_pl)
            shape: (4, 2)
            ┌───────┬───────┐
            │ a     ┆ b     │
            │ ---   ┆ ---   │
            │ bool  ┆ bool  │
            ╞═══════╪═══════╡
            │ true  ┆ true  │
            │ false ┆ true  │
            │ false ┆ false │
            │ true  ┆ false │
            └───────┴───────┘

            >>> agnostic_is_duplicated(df_pa)
            pyarrow.Table
            a: bool
            b: bool
            ----
            a: [[true,false,false,true]]
            b: [[true,true,false,false]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).is_duplicated())

    def is_unique(self) -> Self:
        r"""Return a boolean mask indicating unique values.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3, 1], "b": ["a", "a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_is_unique(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.all().is_unique()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_is_unique`:

            >>> agnostic_is_unique(df_pd)
                   a      b
            0  False  False
            1   True  False
            2   True   True
            3  False   True

            >>> agnostic_is_unique(df_pl)
            shape: (4, 2)
            ┌───────┬───────┐
            │ a     ┆ b     │
            │ ---   ┆ ---   │
            │ bool  ┆ bool  │
            ╞═══════╪═══════╡
            │ false ┆ false │
            │ true  ┆ false │
            │ true  ┆ true  │
            │ false ┆ true  │
            └───────┴───────┘

            >>> agnostic_is_unique(df_pa)
            pyarrow.Table
            a: bool
            b: bool
            ----
            a: [[false,true,true,false]]
            b: [[false,false,true,true]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).is_unique())

    def null_count(self) -> Self:
        r"""Count null values.

        Returns:
            A new expression.

        Notes:
            pandas handles null values differently from Polars and PyArrow.
            See [null_handling](../pandas_like_concepts/null_handling.md/)
            for reference.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, None, 1], "b": ["a", None, "b", None]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_null_count(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.all().null_count()).to_native()

            We can then pass any supported library such as Pandas, Polars, or
            PyArrow to `agnostic_null_count`:

            >>> agnostic_null_count(df_pd)
               a  b
            0  1  2

            >>> agnostic_null_count(df_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ u32 ┆ u32 │
            ╞═════╪═════╡
            │ 1   ┆ 2   │
            └─────┴─────┘

            >>> agnostic_null_count(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[1]]
            b: [[2]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).null_count())

    def is_first_distinct(self) -> Self:
        r"""Return a boolean mask indicating the first occurrence of each distinct value.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3, 1], "b": ["a", "a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_is_first_distinct(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.all().is_first_distinct()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_is_first_distinct`:

            >>> agnostic_is_first_distinct(df_pd)
                   a      b
            0   True   True
            1   True  False
            2   True   True
            3  False   True

            >>> agnostic_is_first_distinct(df_pl)
            shape: (4, 2)
            ┌───────┬───────┐
            │ a     ┆ b     │
            │ ---   ┆ ---   │
            │ bool  ┆ bool  │
            ╞═══════╪═══════╡
            │ true  ┆ true  │
            │ true  ┆ false │
            │ true  ┆ true  │
            │ false ┆ true  │
            └───────┴───────┘

            >>> agnostic_is_first_distinct(df_pa)
            pyarrow.Table
            a: bool
            b: bool
            ----
            a: [[true,true,true,false]]
            b: [[true,false,true,true]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).is_first_distinct()
        )

    def is_last_distinct(self) -> Self:
        r"""Return a boolean mask indicating the last occurrence of each distinct value.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3, 1], "b": ["a", "a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_is_last_distinct(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.all().is_last_distinct()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_is_last_distinct`:

            >>> agnostic_is_last_distinct(df_pd)
                   a      b
            0  False  False
            1   True   True
            2   True   True
            3   True   True

            >>> agnostic_is_last_distinct(df_pl)
            shape: (4, 2)
            ┌───────┬───────┐
            │ a     ┆ b     │
            │ ---   ┆ ---   │
            │ bool  ┆ bool  │
            ╞═══════╪═══════╡
            │ false ┆ false │
            │ true  ┆ true  │
            │ true  ┆ true  │
            │ true  ┆ true  │
            └───────┴───────┘

            >>> agnostic_is_last_distinct(df_pa)
            pyarrow.Table
            a: bool
            b: bool
            ----
            a: [[false,true,true,true]]
            b: [[false,true,true,true]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).is_last_distinct())

    def quantile(
        self,
        quantile: float,
        interpolation: Literal["nearest", "higher", "lower", "midpoint", "linear"],
    ) -> Self:
        r"""Get quantile value.

        Arguments:
            quantile: Quantile between 0.0 and 1.0.
            interpolation: Interpolation method.

        Returns:
            A new expression.

        Note:
            - pandas and Polars may have implementation differences for a given interpolation method.
            - [dask](https://docs.dask.org/en/stable/generated/dask.dataframe.Series.quantile.html) has
                its own method to approximate quantile and it doesn't implement 'nearest', 'higher',
                'lower', 'midpoint' as interpolation method - use 'linear' which is closest to the
                native 'dask' - method.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": list(range(50)), "b": list(range(50, 100))}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_quantile(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(
            ...         nw.col("a", "b").quantile(0.5, interpolation="linear")
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_quantile`:

            >>> agnostic_quantile(df_pd)
                  a     b
            0  24.5  74.5

            >>> agnostic_quantile(df_pl)
            shape: (1, 2)
            ┌──────┬──────┐
            │ a    ┆ b    │
            │ ---  ┆ ---  │
            │ f64  ┆ f64  │
            ╞══════╪══════╡
            │ 24.5 ┆ 74.5 │
            └──────┴──────┘

            >>> agnostic_quantile(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[24.5]]
            b: [[74.5]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).quantile(quantile, interpolation)
        )

    def head(self, n: int = 10) -> Self:
        r"""Get the first `n` rows.

        Arguments:
            n: Number of rows to return.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": list(range(10))}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function that returns the first 3 rows:

            >>> def agnostic_head(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").head(3)).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_head`:

            >>> agnostic_head(df_pd)
               a
            0  0
            1  1
            2  2

            >>> agnostic_head(df_pl)
            shape: (3, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 0   │
            │ 1   │
            │ 2   │
            └─────┘

            >>> agnostic_head(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[0,1,2]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).head(n))

    def tail(self, n: int = 10) -> Self:
        r"""Get the last `n` rows.

        Arguments:
            n: Number of rows to return.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": list(range(10))}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function that returns the last 3 rows:

            >>> def agnostic_tail(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").tail(3)).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_tail`:

            >>> agnostic_tail(df_pd)
               a
            7  7
            8  8
            9  9

            >>> agnostic_tail(df_pl)
            shape: (3, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 7   │
            │ 8   │
            │ 9   │
            └─────┘

            >>> agnostic_tail(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[7,8,9]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).tail(n))

    def round(self, decimals: int = 0) -> Self:
        r"""Round underlying floating point data by `decimals` digits.

        Arguments:
            decimals: Number of decimals to round by.

        Returns:
            A new expression.


        Notes:
            For values exactly halfway between rounded decimal values pandas behaves differently than Polars and Arrow.

            pandas rounds to the nearest even value (e.g. -0.5 and 0.5 round to 0.0, 1.5 and 2.5 round to 2.0, 3.5 and
            4.5 to 4.0, etc..).

            Polars and Arrow round away from 0 (e.g. -0.5 to -1.0, 0.5 to 1.0, 1.5 to 2.0, 2.5 to 3.0, etc..).

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1.12345, 2.56789, 3.901234]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function that rounds to the first decimal:

            >>> def agnostic_round(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").round(1)).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_round`:

            >>> agnostic_round(df_pd)
                 a
            0  1.1
            1  2.6
            2  3.9

            >>> agnostic_round(df_pl)
            shape: (3, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ f64 │
            ╞═════╡
            │ 1.1 │
            │ 2.6 │
            │ 3.9 │
            └─────┘

            >>> agnostic_round(df_pa)
            pyarrow.Table
            a: double
            ----
            a: [[1.1,2.6,3.9]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).round(decimals))

    def len(self) -> Self:
        r"""Return the number of elements in the column.

        Null values count towards the total.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": ["x", "y", "z"], "b": [1, 2, 1]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function that computes the len over
            different values of "b" column:

            >>> def agnostic_len(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(
            ...         nw.col("a").filter(nw.col("b") == 1).len().alias("a1"),
            ...         nw.col("a").filter(nw.col("b") == 2).len().alias("a2"),
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_len`:

            >>> agnostic_len(df_pd)
               a1  a2
            0   2   1

            >>> agnostic_len(df_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a1  ┆ a2  │
            │ --- ┆ --- │
            │ u32 ┆ u32 │
            ╞═════╪═════╡
            │ 2   ┆ 1   │
            └─────┴─────┘

            >>> agnostic_len(df_pa)
            pyarrow.Table
            a1: int64
            a2: int64
            ----
            a1: [[2]]
            a2: [[1]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).len())

    def gather_every(self: Self, n: int, offset: int = 0) -> Self:
        r"""Take every nth value in the Series and return as new Series.

        Arguments:
            n: Gather every *n*-th row.
            offset: Starting index.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3, 4], "b": [5, 6, 7, 8]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function in which gather every 2 rows,
            starting from a offset of 1:

            >>> def agnostic_gather_every(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").gather_every(n=2, offset=1)).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_gather_every`:

            >>> agnostic_gather_every(df_pd)
               a
            1  2
            3  4

            >>> agnostic_gather_every(df_pl)
            shape: (2, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 2   │
            │ 4   │
            └─────┘

            >>> agnostic_gather_every(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[2,4]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).gather_every(n=n, offset=offset)
        )

    # need to allow numeric typing
    # TODO @aivanoved: make type alias for numeric type
    def clip(
        self,
        lower_bound: IntoExpr | Any | None = None,
        upper_bound: IntoExpr | Any | None = None,
    ) -> Self:
        r"""Clip values in the Series.

        Arguments:
            lower_bound: Lower bound value.
            upper_bound: Upper bound value.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_clip_lower(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").clip(2)).to_native()

            We can then pass any supported library such as Pandas, Polars, or
            PyArrow to `agnostic_clip_lower`:

            >>> agnostic_clip_lower(df_pd)
               a
            0  2
            1  2
            2  3

            >>> agnostic_clip_lower(df_pl)
            shape: (3, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 2   │
            │ 2   │
            │ 3   │
            └─────┘

            >>> agnostic_clip_lower(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[2,2,3]]

            We define another library agnostic function:

            >>> def agnostic_clip_upper(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").clip(upper_bound=2)).to_native()

            We can then pass any supported library such as Pandas, Polars, or
            PyArrow to `agnostic_clip_upper`:

            >>> agnostic_clip_upper(df_pd)
               a
            0  1
            1  2
            2  2

            >>> agnostic_clip_upper(df_pl)
            shape: (3, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 1   │
            │ 2   │
            │ 2   │
            └─────┘

            >>> agnostic_clip_upper(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[1,2,2]]

            We can have both at the same time

            >>> data = {"a": [-1, 1, -3, 3, -5, 5]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_clip(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").clip(-1, 3)).to_native()

            We can pass any supported library such as Pandas, Polars, or
            PyArrow to `agnostic_clip`:

            >>> agnostic_clip(df_pd)
               a
            0 -1
            1  1
            2 -1
            3  3
            4 -1
            5  3

            >>> agnostic_clip(df_pl)
            shape: (6, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ -1  │
            │ 1   │
            │ -1  │
            │ 3   │
            │ -1  │
            │ 3   │
            └─────┘

            >>> agnostic_clip(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[-1,1,-1,3,-1,3]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).clip(
                extract_compliant(plx, lower_bound),
                extract_compliant(plx, upper_bound),
            )
        )

    def mode(self: Self) -> Self:
        r"""Compute the most occurring value(s).

        Can return multiple values.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "a": [1, 1, 2, 3],
            ...     "b": [1, 1, 2, 2],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_mode(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").mode()).sort("a").to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_mode`:

            >>> agnostic_mode(df_pd)
               a
            0  1

            >>> agnostic_mode(df_pl)
            shape: (1, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 1   │
            └─────┘

            >>> agnostic_mode(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[1]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).mode())

    def is_finite(self: Self) -> Self:
        """Returns boolean values indicating which original values are finite.

        Warning:
            Different backend handle null values differently. `is_finite` will return
            False for NaN and Null's in the Dask and pandas non-nullable backend, while
            for Polars, PyArrow and pandas nullable backends null values are kept as such.

        Returns:
            Expression of `Boolean` data type.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [float("nan"), float("inf"), 2.0, None]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_is_finite(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("a").is_finite()).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_is_finite`:

            >>> agnostic_is_finite(df_pd)
                   a
            0  False
            1  False
            2   True
            3  False

            >>> agnostic_is_finite(df_pl)
            shape: (4, 1)
            ┌───────┐
            │ a     │
            │ ---   │
            │ bool  │
            ╞═══════╡
            │ false │
            │ false │
            │ true  │
            │ null  │
            └───────┘

            >>> agnostic_is_finite(df_pa)
            pyarrow.Table
            a: bool
            ----
            a: [[false,false,true,null]]
        """
        return self.__class__(lambda plx: self._to_compliant_expr(plx).is_finite())

    def cum_count(self: Self, *, reverse: bool = False) -> Self:
        r"""Return the cumulative count of the non-null values in the column.

        Arguments:
            reverse: reverse the operation

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": ["x", "k", None, "d"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_cum_count(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         nw.col("a").cum_count().alias("cum_count"),
            ...         nw.col("a").cum_count(reverse=True).alias("cum_count_reverse"),
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_cum_count`:

            >>> agnostic_cum_count(df_pd)
                  a  cum_count  cum_count_reverse
            0     x          1                  3
            1     k          2                  2
            2  None          2                  1
            3     d          3                  1

            >>> agnostic_cum_count(df_pl)
            shape: (4, 3)
            ┌──────┬───────────┬───────────────────┐
            │ a    ┆ cum_count ┆ cum_count_reverse │
            │ ---  ┆ ---       ┆ ---               │
            │ str  ┆ u32       ┆ u32               │
            ╞══════╪═══════════╪═══════════════════╡
            │ x    ┆ 1         ┆ 3                 │
            │ k    ┆ 2         ┆ 2                 │
            │ null ┆ 2         ┆ 1                 │
            │ d    ┆ 3         ┆ 1                 │
            └──────┴───────────┴───────────────────┘

            >>> agnostic_cum_count(df_pa)
            pyarrow.Table
            a: string
            cum_count: uint32
            cum_count_reverse: uint32
            ----
            a: [["x","k",null,"d"]]
            cum_count: [[1,2,2,3]]
            cum_count_reverse: [[3,2,1,1]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).cum_count(reverse=reverse)
        )

    def cum_min(self: Self, *, reverse: bool = False) -> Self:
        r"""Return the cumulative min of the non-null values in the column.

        Arguments:
            reverse: reverse the operation

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [3, 1, None, 2]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_cum_min(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         nw.col("a").cum_min().alias("cum_min"),
            ...         nw.col("a").cum_min(reverse=True).alias("cum_min_reverse"),
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_cum_min`:

            >>> agnostic_cum_min(df_pd)
                 a  cum_min  cum_min_reverse
            0  3.0      3.0              1.0
            1  1.0      1.0              1.0
            2  NaN      NaN              NaN
            3  2.0      1.0              2.0

            >>> agnostic_cum_min(df_pl)
            shape: (4, 3)
            ┌──────┬─────────┬─────────────────┐
            │ a    ┆ cum_min ┆ cum_min_reverse │
            │ ---  ┆ ---     ┆ ---             │
            │ i64  ┆ i64     ┆ i64             │
            ╞══════╪═════════╪═════════════════╡
            │ 3    ┆ 3       ┆ 1               │
            │ 1    ┆ 1       ┆ 1               │
            │ null ┆ null    ┆ null            │
            │ 2    ┆ 1       ┆ 2               │
            └──────┴─────────┴─────────────────┘

            >>> agnostic_cum_min(df_pa)
            pyarrow.Table
            a: int64
            cum_min: int64
            cum_min_reverse: int64
            ----
            a: [[3,1,null,2]]
            cum_min: [[3,1,null,1]]
            cum_min_reverse: [[1,1,null,2]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).cum_min(reverse=reverse)
        )

    def cum_max(self: Self, *, reverse: bool = False) -> Self:
        r"""Return the cumulative max of the non-null values in the column.

        Arguments:
            reverse: reverse the operation

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 3, None, 2]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_cum_max(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         nw.col("a").cum_max().alias("cum_max"),
            ...         nw.col("a").cum_max(reverse=True).alias("cum_max_reverse"),
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_`:

            >>> agnostic_cum_max(df_pd)
                 a  cum_max  cum_max_reverse
            0  1.0      1.0              3.0
            1  3.0      3.0              3.0
            2  NaN      NaN              NaN
            3  2.0      3.0              2.0

            >>> agnostic_cum_max(df_pl)
            shape: (4, 3)
            ┌──────┬─────────┬─────────────────┐
            │ a    ┆ cum_max ┆ cum_max_reverse │
            │ ---  ┆ ---     ┆ ---             │
            │ i64  ┆ i64     ┆ i64             │
            ╞══════╪═════════╪═════════════════╡
            │ 1    ┆ 1       ┆ 3               │
            │ 3    ┆ 3       ┆ 3               │
            │ null ┆ null    ┆ null            │
            │ 2    ┆ 3       ┆ 2               │
            └──────┴─────────┴─────────────────┘

            >>> agnostic_cum_max(df_pa)
            pyarrow.Table
            a: int64
            cum_max: int64
            cum_max_reverse: int64
            ----
            a: [[1,3,null,2]]
            cum_max: [[1,3,null,3]]
            cum_max_reverse: [[3,3,null,2]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).cum_max(reverse=reverse)
        )

    def cum_prod(self: Self, *, reverse: bool = False) -> Self:
        r"""Return the cumulative product of the non-null values in the column.

        Arguments:
            reverse: reverse the operation

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 3, None, 2]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_cum_prod(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         nw.col("a").cum_prod().alias("cum_prod"),
            ...         nw.col("a").cum_prod(reverse=True).alias("cum_prod_reverse"),
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_cum_prod`:

            >>> agnostic_cum_prod(df_pd)
                 a  cum_prod  cum_prod_reverse
            0  1.0       1.0               6.0
            1  3.0       3.0               6.0
            2  NaN       NaN               NaN
            3  2.0       6.0               2.0

            >>> agnostic_cum_prod(df_pl)
            shape: (4, 3)
            ┌──────┬──────────┬──────────────────┐
            │ a    ┆ cum_prod ┆ cum_prod_reverse │
            │ ---  ┆ ---      ┆ ---              │
            │ i64  ┆ i64      ┆ i64              │
            ╞══════╪══════════╪══════════════════╡
            │ 1    ┆ 1        ┆ 6                │
            │ 3    ┆ 3        ┆ 6                │
            │ null ┆ null     ┆ null             │
            │ 2    ┆ 6        ┆ 2                │
            └──────┴──────────┴──────────────────┘

            >>> agnostic_cum_prod(df_pa)
            pyarrow.Table
            a: int64
            cum_prod: int64
            cum_prod_reverse: int64
            ----
            a: [[1,3,null,2]]
            cum_prod: [[1,3,null,6]]
            cum_prod_reverse: [[6,6,null,2]]
        """
        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).cum_prod(reverse=reverse)
        )

    def rolling_sum(
        self: Self,
        window_size: int,
        *,
        min_periods: int | None = None,
        center: bool = False,
    ) -> Self:
        """Apply a rolling sum (moving sum) over the values.

        !!! warning
            This functionality is considered **unstable**. It may be changed at any point
            without it being considered a breaking change.

        A window of length `window_size` will traverse the values. The resulting values
        will be aggregated to their sum.

        The window at a given row will include the row itself and the `window_size - 1`
        elements before it.

        Arguments:
            window_size: The length of the window in number of elements. It must be a
                strictly positive integer.
            min_periods: The number of values in the window that should be non-null before
                computing a result. If set to `None` (default), it will be set equal to
                `window_size`. If provided, it must be a strictly positive integer, and
                less than or equal to `window_size`
            center: Set the labels at the center of the window.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1.0, 2.0, None, 4.0]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_rolling_sum(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         b=nw.col("a").rolling_sum(window_size=3, min_periods=1)
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_rolling_sum`:

            >>> agnostic_rolling_sum(df_pd)
                 a    b
            0  1.0  1.0
            1  2.0  3.0
            2  NaN  3.0
            3  4.0  6.0

            >>> agnostic_rolling_sum(df_pl)
            shape: (4, 2)
            ┌──────┬─────┐
            │ a    ┆ b   │
            │ ---  ┆ --- │
            │ f64  ┆ f64 │
            ╞══════╪═════╡
            │ 1.0  ┆ 1.0 │
            │ 2.0  ┆ 3.0 │
            │ null ┆ 3.0 │
            │ 4.0  ┆ 6.0 │
            └──────┴─────┘

            >>> agnostic_rolling_sum(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[1,2,null,4]]
            b: [[1,3,3,6]]
        """
        window_size, min_periods = _validate_rolling_arguments(
            window_size=window_size, min_periods=min_periods
        )

        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).rolling_sum(
                window_size=window_size,
                min_periods=min_periods,
                center=center,
            )
        )

    def rolling_mean(
        self: Self,
        window_size: int,
        *,
        min_periods: int | None = None,
        center: bool = False,
    ) -> Self:
        """Apply a rolling mean (moving mean) over the values.

        !!! warning
            This functionality is considered **unstable**. It may be changed at any point
            without it being considered a breaking change.

        A window of length `window_size` will traverse the values. The resulting values
        will be aggregated to their mean.

        The window at a given row will include the row itself and the `window_size - 1`
        elements before it.

        Arguments:
            window_size: The length of the window in number of elements. It must be a
                strictly positive integer.
            min_periods: The number of values in the window that should be non-null before
                computing a result. If set to `None` (default), it will be set equal to
                `window_size`. If provided, it must be a strictly positive integer, and
                less than or equal to `window_size`
            center: Set the labels at the center of the window.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1.0, 2.0, None, 4.0]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_rolling_mean(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         b=nw.col("a").rolling_mean(window_size=3, min_periods=1)
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_rolling_mean`:

            >>> agnostic_rolling_mean(df_pd)
                 a    b
            0  1.0  1.0
            1  2.0  1.5
            2  NaN  1.5
            3  4.0  3.0

            >>> agnostic_rolling_mean(df_pl)
            shape: (4, 2)
            ┌──────┬─────┐
            │ a    ┆ b   │
            │ ---  ┆ --- │
            │ f64  ┆ f64 │
            ╞══════╪═════╡
            │ 1.0  ┆ 1.0 │
            │ 2.0  ┆ 1.5 │
            │ null ┆ 1.5 │
            │ 4.0  ┆ 3.0 │
            └──────┴─────┘

            >>> agnostic_rolling_mean(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[1,2,null,4]]
            b: [[1,1.5,1.5,3]]
        """
        window_size, min_periods = _validate_rolling_arguments(
            window_size=window_size, min_periods=min_periods
        )

        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).rolling_mean(
                window_size=window_size,
                min_periods=min_periods,
                center=center,
            )
        )

    def rolling_var(
        self: Self,
        window_size: int,
        *,
        min_periods: int | None = None,
        center: bool = False,
        ddof: int = 1,
    ) -> Self:
        """Apply a rolling variance (moving variance) over the values.

        !!! warning
            This functionality is considered **unstable**. It may be changed at any point
            without it being considered a breaking change.

        A window of length `window_size` will traverse the values. The resulting values
        will be aggregated to their variance.

        The window at a given row will include the row itself and the `window_size - 1`
        elements before it.

        Arguments:
            window_size: The length of the window in number of elements. It must be a
                strictly positive integer.
            min_periods: The number of values in the window that should be non-null before
                computing a result. If set to `None` (default), it will be set equal to
                `window_size`. If provided, it must be a strictly positive integer, and
                less than or equal to `window_size`.
            center: Set the labels at the center of the window.
            ddof: Delta Degrees of Freedom; the divisor for a length N window is N - ddof.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1.0, 2.0, None, 4.0]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_rolling_var(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         b=nw.col("a").rolling_var(window_size=3, min_periods=1)
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_rolling_var`:

            >>> agnostic_rolling_var(df_pd)
                 a    b
            0  1.0  NaN
            1  2.0  0.5
            2  NaN  0.5
            3  4.0  2.0

            >>> agnostic_rolling_var(df_pl)  #  doctest:+SKIP
            shape: (4, 2)
            ┌──────┬──────┐
            │ a    ┆ b    │
            │ ---  ┆ ---  │
            │ f64  ┆ f64  │
            ╞══════╪══════╡
            │ 1.0  ┆ null │
            │ 2.0  ┆ 0.5  │
            │ null ┆ 0.5  │
            │ 4.0  ┆ 2.0  │
            └──────┴──────┘

            >>> agnostic_rolling_var(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[1,2,null,4]]
            b: [[nan,0.5,0.5,2]]
        """
        window_size, min_periods = _validate_rolling_arguments(
            window_size=window_size, min_periods=min_periods
        )

        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).rolling_var(
                window_size=window_size, min_periods=min_periods, center=center, ddof=ddof
            )
        )

    def rolling_std(
        self: Self,
        window_size: int,
        *,
        min_periods: int | None = None,
        center: bool = False,
        ddof: int = 1,
    ) -> Self:
        """Apply a rolling standard deviation (moving standard deviation) over the values.

        !!! warning
            This functionality is considered **unstable**. It may be changed at any point
            without it being considered a breaking change.

        A window of length `window_size` will traverse the values. The resulting values
        will be aggregated to their standard deviation.

        The window at a given row will include the row itself and the `window_size - 1`
        elements before it.

        Arguments:
            window_size: The length of the window in number of elements. It must be a
                strictly positive integer.
            min_periods: The number of values in the window that should be non-null before
                computing a result. If set to `None` (default), it will be set equal to
                `window_size`. If provided, it must be a strictly positive integer, and
                less than or equal to `window_size`.
            center: Set the labels at the center of the window.
            ddof: Delta Degrees of Freedom; the divisor for a length N window is N - ddof.

        Returns:
            A new expression.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1.0, 2.0, None, 4.0]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_rolling_std(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_columns(
            ...         b=nw.col("a").rolling_std(window_size=3, min_periods=1)
            ...     ).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_rolling_std`:

            >>> agnostic_rolling_std(df_pd)
                 a         b
            0  1.0       NaN
            1  2.0  0.707107
            2  NaN  0.707107
            3  4.0  1.414214

            >>> agnostic_rolling_std(df_pl)  #  doctest:+SKIP
            shape: (4, 2)
            ┌──────┬──────────┐
            │ a    ┆ b        │
            │ ---  ┆ ---      │
            │ f64  ┆ f64      │
            ╞══════╪══════════╡
            │ 1.0  ┆ null     │
            │ 2.0  ┆ 0.707107 │
            │ null ┆ 0.707107 │
            │ 4.0  ┆ 1.414214 │
            └──────┴──────────┘

            >>> agnostic_rolling_std(df_pa)
            pyarrow.Table
            a: double
            b: double
            ----
            a: [[1,2,null,4]]
            b: [[nan,0.7071067811865476,0.7071067811865476,1.4142135623730951]]
        """
        window_size, min_periods = _validate_rolling_arguments(
            window_size=window_size, min_periods=min_periods
        )

        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).rolling_std(
                window_size=window_size,
                min_periods=min_periods,
                center=center,
                ddof=ddof,
            )
        )

    def rank(
        self: Self,
        method: Literal["average", "min", "max", "dense", "ordinal"] = "average",
        *,
        descending: bool = False,
    ) -> Self:
        """Assign ranks to data, dealing with ties appropriately.

        Notes:
            The resulting dtype may differ between backends.

        Arguments:
            method: The method used to assign ranks to tied elements.
                The following methods are available (default is 'average'):

                - 'average' : The average of the ranks that would have been assigned to
                  all the tied values is assigned to each value.
                - 'min' : The minimum of the ranks that would have been assigned to all
                    the tied values is assigned to each value. (This is also referred to
                    as "competition" ranking.)
                - 'max' : The maximum of the ranks that would have been assigned to all
                    the tied values is assigned to each value.
                - 'dense' : Like 'min', but the rank of the next highest element is
                   assigned the rank immediately after those assigned to the tied
                   elements.
                - 'ordinal' : All values are given a distinct rank, corresponding to the
                    order that the values occur in the Series.

            descending: Rank in descending order.

        Returns:
            A new expression with rank data.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [3, 6, 1, 1, 6]}

            We define a dataframe-agnostic function that computes the dense rank for
            the data:

            >>> def agnostic_dense_rank(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     result = df.with_columns(rnk=nw.col("a").rank(method="dense"))
            ...     return result.to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_dense_rank`:

            >>> agnostic_dense_rank(pd.DataFrame(data))
               a  rnk
            0  3  2.0
            1  6  3.0
            2  1  1.0
            3  1  1.0
            4  6  3.0

            >>> agnostic_dense_rank(pl.DataFrame(data))
            shape: (5, 2)
            ┌─────┬─────┐
            │ a   ┆ rnk │
            │ --- ┆ --- │
            │ i64 ┆ u32 │
            ╞═════╪═════╡
            │ 3   ┆ 2   │
            │ 6   ┆ 3   │
            │ 1   ┆ 1   │
            │ 1   ┆ 1   │
            │ 6   ┆ 3   │
            └─────┴─────┘

            >>> agnostic_dense_rank(pa.table(data))
            pyarrow.Table
            a: int64
            rnk: uint64
            ----
            a: [[3,6,1,1,6]]
            rnk: [[2,3,1,1,3]]
        """
        supported_rank_methods = {"average", "min", "max", "dense", "ordinal"}
        if method not in supported_rank_methods:
            msg = (
                "Ranking method must be one of {'average', 'min', 'max', 'dense', 'ordinal'}. "
                f"Found '{method}'"
            )
            raise ValueError(msg)

        return self.__class__(
            lambda plx: self._to_compliant_expr(plx).rank(
                method=method, descending=descending
            )
        )

    @property
    def str(self: Self) -> ExprStringNamespace[Self]:
        return ExprStringNamespace(self)

    @property
    def dt(self: Self) -> ExprDateTimeNamespace[Self]:
        return ExprDateTimeNamespace(self)

    @property
    def cat(self: Self) -> ExprCatNamespace[Self]:
        return ExprCatNamespace(self)

    @property
    def name(self: Self) -> ExprNameNamespace[Self]:
        return ExprNameNamespace(self)

    @property
    def list(self: Self) -> ExprListNamespace[Self]:
        return ExprListNamespace(self)


__all__ = [
    "Expr",
]
