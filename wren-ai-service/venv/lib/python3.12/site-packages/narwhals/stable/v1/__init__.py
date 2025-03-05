from __future__ import annotations

from functools import wraps
from typing import TYPE_CHECKING
from typing import Any
from typing import Callable
from typing import Iterable
from typing import Literal
from typing import Sequence
from typing import TypeVar
from typing import overload
from warnings import warn

import narwhals as nw
from narwhals import dependencies
from narwhals import exceptions
from narwhals import selectors
from narwhals.dataframe import DataFrame as NwDataFrame
from narwhals.dataframe import LazyFrame as NwLazyFrame
from narwhals.expr import Expr as NwExpr
from narwhals.functions import Then as NwThen
from narwhals.functions import When as NwWhen
from narwhals.functions import _from_dict_impl
from narwhals.functions import _from_numpy_impl
from narwhals.functions import _new_series_impl
from narwhals.functions import _read_csv_impl
from narwhals.functions import _read_parquet_impl
from narwhals.functions import _scan_csv_impl
from narwhals.functions import _scan_parquet_impl
from narwhals.functions import from_arrow as nw_from_arrow
from narwhals.functions import get_level
from narwhals.functions import show_versions
from narwhals.functions import when as nw_when
from narwhals.schema import Schema as NwSchema
from narwhals.series import Series as NwSeries
from narwhals.stable.v1 import dtypes
from narwhals.stable.v1.dtypes import Array
from narwhals.stable.v1.dtypes import Boolean
from narwhals.stable.v1.dtypes import Categorical
from narwhals.stable.v1.dtypes import Date
from narwhals.stable.v1.dtypes import Datetime
from narwhals.stable.v1.dtypes import Decimal
from narwhals.stable.v1.dtypes import Duration
from narwhals.stable.v1.dtypes import Enum
from narwhals.stable.v1.dtypes import Field
from narwhals.stable.v1.dtypes import Float32
from narwhals.stable.v1.dtypes import Float64
from narwhals.stable.v1.dtypes import Int8
from narwhals.stable.v1.dtypes import Int16
from narwhals.stable.v1.dtypes import Int32
from narwhals.stable.v1.dtypes import Int64
from narwhals.stable.v1.dtypes import Int128
from narwhals.stable.v1.dtypes import List
from narwhals.stable.v1.dtypes import Object
from narwhals.stable.v1.dtypes import String
from narwhals.stable.v1.dtypes import Struct
from narwhals.stable.v1.dtypes import UInt8
from narwhals.stable.v1.dtypes import UInt16
from narwhals.stable.v1.dtypes import UInt32
from narwhals.stable.v1.dtypes import UInt64
from narwhals.stable.v1.dtypes import UInt128
from narwhals.stable.v1.dtypes import Unknown
from narwhals.translate import _from_native_impl
from narwhals.translate import get_native_namespace
from narwhals.translate import to_py_scalar
from narwhals.typing import IntoDataFrameT
from narwhals.typing import IntoFrameT
from narwhals.typing import IntoSeriesT
from narwhals.utils import Implementation
from narwhals.utils import Version
from narwhals.utils import generate_temporary_column_name
from narwhals.utils import is_ordered_categorical
from narwhals.utils import maybe_align_index
from narwhals.utils import maybe_convert_dtypes
from narwhals.utils import maybe_get_index
from narwhals.utils import maybe_reset_index
from narwhals.utils import maybe_set_index
from narwhals.utils import validate_strict_and_pass_though

if TYPE_CHECKING:
    from types import ModuleType

    import numpy as np
    from typing_extensions import Self

    from narwhals.dtypes import DType
    from narwhals.functions import ArrowStreamExportable
    from narwhals.typing import IntoExpr
    from narwhals.typing import IntoSeries

T = TypeVar("T")


class DataFrame(NwDataFrame[IntoDataFrameT]):
    """Narwhals DataFrame, backed by a native eager dataframe.

    !!! warning
        This class is not meant to be instantiated directly - instead:

        - If the native object is a eager dataframe from one of the supported
            backend (e.g. pandas.DataFrame, polars.DataFrame, pyarrow.Table),
            you can use [`narwhals.from_native`][]:
            ```py
            narwhals.from_native(native_dataframe)
            narwhals.from_native(native_dataframe, eager_only=True)
            ```

        - If the object is a dictionary of column names and generic sequences mapping
            (e.g. `dict[str, list]`), you can create a DataFrame via
            [`narwhals.from_dict`][]:
            ```py
            narwhals.from_dict(
                data={"a": [1, 2, 3]},
                native_namespace=narwhals.get_native_namespace(another_object),
            )
            ```
    """

    # We need to override any method which don't return Self so that type
    # annotations are correct.

    @property
    def _series(self) -> type[Series]:
        return Series

    @property
    def _lazyframe(self) -> type[LazyFrame[Any]]:
        return LazyFrame

    @overload
    def __getitem__(self, item: tuple[Sequence[int], slice]) -> Self: ...
    @overload
    def __getitem__(self, item: tuple[Sequence[int], Sequence[int]]) -> Self: ...
    @overload
    def __getitem__(self, item: tuple[slice, Sequence[int]]) -> Self: ...
    @overload
    def __getitem__(self, item: tuple[Sequence[int], str]) -> Series: ...  # type: ignore[overload-overlap]
    @overload
    def __getitem__(self, item: tuple[slice, str]) -> Series: ...  # type: ignore[overload-overlap]
    @overload
    def __getitem__(self, item: tuple[Sequence[int], Sequence[str]]) -> Self: ...
    @overload
    def __getitem__(self, item: tuple[slice, Sequence[str]]) -> Self: ...
    @overload
    def __getitem__(self, item: tuple[Sequence[int], int]) -> Series: ...  # type: ignore[overload-overlap]
    @overload
    def __getitem__(self, item: tuple[slice, int]) -> Series: ...  # type: ignore[overload-overlap]

    @overload
    def __getitem__(self, item: Sequence[int]) -> Self: ...

    @overload
    def __getitem__(self, item: str) -> Series: ...  # type: ignore[overload-overlap]

    @overload
    def __getitem__(self, item: Sequence[str]) -> Self: ...

    @overload
    def __getitem__(self, item: slice) -> Self: ...

    @overload
    def __getitem__(self, item: tuple[slice, slice]) -> Self: ...

    def __getitem__(self, item: Any) -> Any:
        return super().__getitem__(item)

    def lazy(self) -> LazyFrame[Any]:
        """Lazify the DataFrame (if possible).

        If a library does not support lazy execution, then this is a no-op.

        Returns:
            A new LazyFrame.
        """
        return super().lazy()  # type: ignore[return-value]

    # Not sure what mypy is complaining about, probably some fancy
    # thing that I need to understand category theory for
    @overload  # type: ignore[override]
    def to_dict(self, *, as_series: Literal[True] = ...) -> dict[str, Series]: ...
    @overload
    def to_dict(self, *, as_series: Literal[False]) -> dict[str, list[Any]]: ...
    @overload
    def to_dict(self, *, as_series: bool) -> dict[str, Series] | dict[str, list[Any]]: ...
    def to_dict(
        self, *, as_series: bool = True
    ) -> dict[str, Series] | dict[str, list[Any]]:
        """Convert DataFrame to a dictionary mapping column name to values.

        Arguments:
            as_series: If set to true ``True``, then the values are Narwhals Series,
                    otherwise the values are Any.

        Returns:
            A mapping from column name to values / Series.
        """
        return super().to_dict(as_series=as_series)  # type: ignore[return-value]

    def is_duplicated(self: Self) -> Series:
        r"""Get a mask of all duplicated rows in this DataFrame.

        Returns:
            A new Series.
        """
        return super().is_duplicated()  # type: ignore[return-value]

    def is_unique(self: Self) -> Series:
        r"""Get a mask of all unique rows in this DataFrame.

        Returns:
            A new Series.
        """
        return super().is_unique()  # type: ignore[return-value]

    def _l1_norm(self: Self) -> Self:
        """Private, just used to test the stable API.

        Returns:
            A new DataFrame.
        """
        return self.select(all()._l1_norm())


class LazyFrame(NwLazyFrame[IntoFrameT]):
    """Narwhals LazyFrame, backed by a native lazyframe.

    !!! warning
        This class is not meant to be instantiated directly - instead use
        [`narwhals.from_native`][] with a native
        object that is a lazy dataframe from one of the supported
        backend (e.g. polars.LazyFrame, dask_expr._collection.DataFrame):
        ```py
        narwhals.from_native(native_lazyframe)
        ```
    """

    @property
    def _dataframe(self) -> type[DataFrame[Any]]:
        return DataFrame

    def collect(self) -> DataFrame[Any]:
        r"""Materialize this LazyFrame into a DataFrame.

        Returns:
            DataFrame
        """
        return super().collect()  # type: ignore[return-value]

    def _l1_norm(self: Self) -> Self:
        """Private, just used to test the stable API.

        Returns:
            A new lazyframe.
        """
        return self.select(all()._l1_norm())


class Series(NwSeries[Any]):
    """Narwhals Series, backed by a native series.

    !!! warning
        This class is not meant to be instantiated directly - instead:

        - If the native object is a series from one of the supported backend (e.g.
            pandas.Series, polars.Series, pyarrow.ChunkedArray), you can use
            [`narwhals.from_native`][]:
            ```py
            narwhals.from_native(native_series, allow_series=True)
            narwhals.from_native(native_series, series_only=True)
            ```

        - If the object is a generic sequence (e.g. a list or a tuple of values), you can
            create a series via [`narwhals.new_series`][]:
            ```py
            narwhals.new_series(
                name=name,
                values=values,
                native_namespace=narwhals.get_native_namespace(another_object),
            )
            ```
    """

    # We need to override any method which don't return Self so that type
    # annotations are correct.

    @property
    def _dataframe(self) -> type[DataFrame[Any]]:
        return DataFrame

    def to_frame(self) -> DataFrame[Any]:
        """Convert to dataframe.

        Returns:
            A DataFrame containing this Series as a single column.
        """
        return super().to_frame()  # type: ignore[return-value]

    def value_counts(
        self: Self,
        *,
        sort: bool = False,
        parallel: bool = False,
        name: str | None = None,
        normalize: bool = False,
    ) -> DataFrame[Any]:
        r"""Count the occurrences of unique values.

        Arguments:
            sort: Sort the output by count in descending order. If set to False (default),
                the order of the output is random.
            parallel: Execute the computation in parallel. Used for Polars only.
            name: Give the resulting count column a specific name; if `normalize` is True
                defaults to "proportion", otherwise defaults to "count".
            normalize: If true gives relative frequencies of the unique values

        Returns:
            A DataFrame with two columns:
            - The original values as first column
            - Either count or proportion as second column, depending on normalize parameter.
        """
        return super().value_counts(  # type: ignore[return-value]
            sort=sort, parallel=parallel, name=name, normalize=normalize
        )

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
            min_periods: Minimum number of observations in window required to have a value (otherwise result is null).
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
            Series
        """
        from narwhals.exceptions import NarwhalsUnstableWarning
        from narwhals.utils import find_stacklevel

        msg = (
            "`Series.ewm_mean` is being called from the stable API although considered "
            "an unstable feature."
        )
        warn(message=msg, category=NarwhalsUnstableWarning, stacklevel=find_stacklevel())
        return super().ewm_mean(
            com=com,
            span=span,
            half_life=half_life,
            alpha=alpha,
            adjust=adjust,
            min_periods=min_periods,
            ignore_nulls=ignore_nulls,
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
            A new series.
        """
        from narwhals.exceptions import NarwhalsUnstableWarning
        from narwhals.utils import find_stacklevel

        msg = (
            "`Series.rolling_sum` is being called from the stable API although considered "
            "an unstable feature."
        )
        warn(message=msg, category=NarwhalsUnstableWarning, stacklevel=find_stacklevel())
        return super().rolling_sum(
            window_size=window_size,
            min_periods=min_periods,
            center=center,
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
            A new series.
        """
        from narwhals.exceptions import NarwhalsUnstableWarning
        from narwhals.utils import find_stacklevel

        msg = (
            "`Series.rolling_mean` is being called from the stable API although considered "
            "an unstable feature."
        )
        warn(message=msg, category=NarwhalsUnstableWarning, stacklevel=find_stacklevel())
        return super().rolling_mean(
            window_size=window_size,
            min_periods=min_periods,
            center=center,
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
            A new series.
        """
        from narwhals.exceptions import NarwhalsUnstableWarning
        from narwhals.utils import find_stacklevel

        msg = (
            "`Series.rolling_var` is being called from the stable API although considered "
            "an unstable feature."
        )
        warn(message=msg, category=NarwhalsUnstableWarning, stacklevel=find_stacklevel())
        return super().rolling_var(
            window_size=window_size,
            min_periods=min_periods,
            center=center,
            ddof=ddof,
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
            A new series.
        """
        from narwhals.exceptions import NarwhalsUnstableWarning
        from narwhals.utils import find_stacklevel

        msg = (
            "`Series.rolling_std` is being called from the stable API although considered "
            "an unstable feature."
        )
        warn(message=msg, category=NarwhalsUnstableWarning, stacklevel=find_stacklevel())
        return super().rolling_std(
            window_size=window_size,
            min_periods=min_periods,
            center=center,
            ddof=ddof,
        )


class Expr(NwExpr):
    def _l1_norm(self) -> Self:
        return super()._taxicab_norm()

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
        """
        from narwhals.exceptions import NarwhalsUnstableWarning
        from narwhals.utils import find_stacklevel

        msg = (
            "`Expr.ewm_mean` is being called from the stable API although considered "
            "an unstable feature."
        )
        warn(message=msg, category=NarwhalsUnstableWarning, stacklevel=find_stacklevel())
        return super().ewm_mean(
            com=com,
            span=span,
            half_life=half_life,
            alpha=alpha,
            adjust=adjust,
            min_periods=min_periods,
            ignore_nulls=ignore_nulls,
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
        """
        from narwhals.exceptions import NarwhalsUnstableWarning
        from narwhals.utils import find_stacklevel

        msg = (
            "`Expr.rolling_sum` is being called from the stable API although considered "
            "an unstable feature."
        )
        warn(message=msg, category=NarwhalsUnstableWarning, stacklevel=find_stacklevel())
        return super().rolling_sum(
            window_size=window_size,
            min_periods=min_periods,
            center=center,
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
        """
        from narwhals.exceptions import NarwhalsUnstableWarning
        from narwhals.utils import find_stacklevel

        msg = (
            "`Expr.rolling_mean` is being called from the stable API although considered "
            "an unstable feature."
        )
        warn(message=msg, category=NarwhalsUnstableWarning, stacklevel=find_stacklevel())
        return super().rolling_mean(
            window_size=window_size,
            min_periods=min_periods,
            center=center,
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
        """
        from narwhals.exceptions import NarwhalsUnstableWarning
        from narwhals.utils import find_stacklevel

        msg = (
            "`Expr.rolling_var` is being called from the stable API although considered "
            "an unstable feature."
        )
        warn(message=msg, category=NarwhalsUnstableWarning, stacklevel=find_stacklevel())
        return super().rolling_var(
            window_size=window_size, min_periods=min_periods, center=center, ddof=ddof
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
                less than or equal to `window_size`
            center: Set the labels at the center of the window.
            ddof: Delta Degrees of Freedom; the divisor for a length N window is N - ddof.

        Returns:
            A new expression.
        """
        from narwhals.exceptions import NarwhalsUnstableWarning
        from narwhals.utils import find_stacklevel

        msg = (
            "`Expr.rolling_std` is being called from the stable API although considered "
            "an unstable feature."
        )
        warn(message=msg, category=NarwhalsUnstableWarning, stacklevel=find_stacklevel())
        return super().rolling_std(
            window_size=window_size,
            min_periods=min_periods,
            center=center,
            ddof=ddof,
        )


class Schema(NwSchema):
    """Ordered mapping of column names to their data type.

    Arguments:
        schema: Mapping[str, DType] | Iterable[tuple[str, DType]] | None
            The schema definition given by column names and their associated.
            *instantiated* Narwhals data type. Accepts a mapping or an iterable of tuples.
    """


@overload
def _stableify(obj: NwDataFrame[IntoFrameT]) -> DataFrame[IntoFrameT]: ...
@overload
def _stableify(obj: NwLazyFrame[IntoFrameT]) -> LazyFrame[IntoFrameT]: ...
@overload
def _stableify(obj: NwSeries[Any]) -> Series: ...
@overload
def _stableify(obj: NwExpr) -> Expr: ...
@overload
def _stableify(obj: Any) -> Any: ...


def _stableify(
    obj: NwDataFrame[IntoFrameT] | NwLazyFrame[IntoFrameT] | NwSeries[Any] | NwExpr | Any,
) -> DataFrame[IntoFrameT] | LazyFrame[IntoFrameT] | Series | Expr | Any:
    if isinstance(obj, NwDataFrame):
        return DataFrame(
            obj._compliant_frame._change_version(Version.V1),
            level=obj._level,
        )
    if isinstance(obj, NwLazyFrame):
        return LazyFrame(
            obj._compliant_frame._change_version(Version.V1),
            level=obj._level,
        )
    if isinstance(obj, NwSeries):
        return Series(
            obj._compliant_series._change_version(Version.V1),
            level=obj._level,
        )
    if isinstance(obj, NwExpr):
        return Expr(obj._to_compliant_expr)
    return obj


@overload
def from_native(
    native_object: IntoDataFrameT | IntoSeriesT,
    *,
    strict: Literal[False],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[True],
    series_only: Literal[False] = ...,
    allow_series: Literal[True],
) -> DataFrame[IntoDataFrameT] | Series: ...


@overload
def from_native(
    native_object: IntoDataFrameT | IntoSeriesT,
    *,
    strict: Literal[False],
    eager_only: Literal[True],
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: Literal[True],
) -> DataFrame[IntoDataFrameT] | Series: ...


@overload
def from_native(
    native_object: IntoDataFrameT,
    *,
    strict: Literal[False],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[True],
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoDataFrameT]: ...


@overload
def from_native(
    native_object: T,
    *,
    strict: Literal[False],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[True],
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> T: ...


@overload
def from_native(
    native_object: IntoDataFrameT,
    *,
    strict: Literal[False],
    eager_only: Literal[True],
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoDataFrameT]: ...


@overload
def from_native(
    native_object: T,
    *,
    strict: Literal[False],
    eager_only: Literal[True],
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> T: ...


@overload
def from_native(
    native_object: IntoFrameT | IntoSeriesT,
    *,
    strict: Literal[False],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: Literal[True],
) -> DataFrame[IntoFrameT] | LazyFrame[IntoFrameT] | Series: ...


@overload
def from_native(
    native_object: IntoSeriesT,
    *,
    strict: Literal[False],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[True],
    allow_series: None = ...,
) -> Series: ...


@overload
def from_native(
    native_object: IntoFrameT,
    *,
    strict: Literal[False],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoFrameT] | LazyFrame[IntoFrameT]: ...


@overload
def from_native(
    native_object: T,
    *,
    strict: Literal[False],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> T: ...


@overload
def from_native(
    native_object: IntoDataFrameT,
    *,
    strict: Literal[True] = ...,
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[True],
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoDataFrameT]: ...


@overload
def from_native(
    native_object: IntoDataFrameT,
    *,
    strict: Literal[True] = ...,
    eager_only: Literal[True],
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoDataFrameT]: ...


@overload
def from_native(
    native_object: IntoFrameT | IntoSeriesT,
    *,
    strict: Literal[True] = ...,
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: Literal[True],
) -> DataFrame[Any] | LazyFrame[Any] | Series: ...


@overload
def from_native(
    native_object: IntoSeriesT | Any,  # remain `Any` for downstream compatibility
    *,
    strict: Literal[True] = ...,
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[True],
    allow_series: None = ...,
) -> Series: ...


@overload
def from_native(
    native_object: IntoFrameT,
    *,
    strict: Literal[True] = ...,
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoFrameT] | LazyFrame[IntoFrameT]: ...


@overload
def from_native(
    native_object: IntoDataFrameT | IntoSeriesT,
    *,
    pass_through: Literal[True],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[True],
    series_only: Literal[False] = ...,
    allow_series: Literal[True],
) -> DataFrame[IntoDataFrameT]: ...


@overload
def from_native(
    native_object: IntoDataFrameT | IntoSeriesT,
    *,
    pass_through: Literal[True],
    eager_only: Literal[True],
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: Literal[True],
) -> DataFrame[IntoDataFrameT] | Series: ...


@overload
def from_native(
    native_object: IntoDataFrameT,
    *,
    pass_through: Literal[True],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[True],
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoDataFrameT]: ...


@overload
def from_native(
    native_object: T,
    *,
    pass_through: Literal[True],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[True],
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> T: ...


@overload
def from_native(
    native_object: IntoDataFrameT,
    *,
    pass_through: Literal[True],
    eager_only: Literal[True],
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoDataFrameT]: ...


@overload
def from_native(
    native_object: T,
    *,
    pass_through: Literal[True],
    eager_only: Literal[True],
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> T: ...


@overload
def from_native(
    native_object: IntoFrameT | IntoSeriesT,
    *,
    pass_through: Literal[True],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: Literal[True],
) -> DataFrame[IntoFrameT] | LazyFrame[IntoFrameT] | Series: ...


@overload
def from_native(
    native_object: IntoSeriesT,
    *,
    pass_through: Literal[True],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[True],
    allow_series: None = ...,
) -> Series: ...


@overload
def from_native(
    native_object: IntoFrameT,
    *,
    pass_through: Literal[True],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoFrameT] | LazyFrame[IntoFrameT]: ...


@overload
def from_native(
    native_object: T,
    *,
    pass_through: Literal[True],
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> T: ...


@overload
def from_native(
    native_object: IntoDataFrameT,
    *,
    pass_through: Literal[False] = ...,
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[True],
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoDataFrameT]: ...


@overload
def from_native(
    native_object: IntoDataFrameT,
    *,
    pass_through: Literal[False] = ...,
    eager_only: Literal[True],
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoDataFrameT]: ...


@overload
def from_native(
    native_object: IntoFrameT | IntoSeriesT,
    *,
    pass_through: Literal[False] = ...,
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: Literal[True],
) -> DataFrame[Any] | LazyFrame[Any] | Series: ...


@overload
def from_native(
    native_object: IntoSeriesT,
    *,
    pass_through: Literal[False] = ...,
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[True],
    allow_series: None = ...,
) -> Series: ...


@overload
def from_native(
    native_object: IntoFrameT,
    *,
    pass_through: Literal[False] = ...,
    eager_only: Literal[False] = ...,
    eager_or_interchange_only: Literal[False] = ...,
    series_only: Literal[False] = ...,
    allow_series: None = ...,
) -> DataFrame[IntoFrameT] | LazyFrame[IntoFrameT]: ...


# All params passed in as variables
@overload
def from_native(
    native_object: Any,
    *,
    pass_through: bool,
    eager_only: bool,
    eager_or_interchange_only: bool = False,
    series_only: bool,
    allow_series: bool | None,
) -> Any: ...


def from_native(
    native_object: IntoFrameT | IntoSeries | T,
    *,
    strict: bool | None = None,
    pass_through: bool | None = None,
    eager_only: bool = False,
    eager_or_interchange_only: bool = False,
    series_only: bool = False,
    allow_series: bool | None = None,
) -> LazyFrame[IntoFrameT] | DataFrame[IntoFrameT] | Series | T:
    """Convert `native_object` to Narwhals Dataframe, Lazyframe, or Series.

    Arguments:
        native_object: Raw object from user.
            Depending on the other arguments, input object can be:

            - a Dataframe / Lazyframe / Series supported by Narwhals (pandas, Polars, PyArrow, ...)
            - an object which implements `__narwhals_dataframe__`, `__narwhals_lazyframe__`,
              or `__narwhals_series__`
        strict: Determine what happens if the object can't be converted to Narwhals:

            - `True` or `None` (default): raise an error
            - `False`: pass object through as-is

            **Deprecated** (v1.13.0):
                Please use `pass_through` instead. Note that `strict` is still available
                (and won't emit a deprecation warning) if you use `narwhals.stable.v1`,
                see [perfect backwards compatibility policy](../backcompat.md/).
        pass_through: Determine what happens if the object can't be converted to Narwhals:

            - `False` or `None` (default): raise an error
            - `True`: pass object through as-is
        eager_only: Whether to only allow eager objects:

            - `False` (default): don't require `native_object` to be eager
            - `True`: only convert to Narwhals if `native_object` is eager
        eager_or_interchange_only: Whether to only allow eager objects or objects which
            have interchange-level support in Narwhals:

            - `False` (default): don't require `native_object` to either be eager or to
              have interchange-level support in Narwhals
            - `True`: only convert to Narwhals if `native_object` is eager or has
              interchange-level support in Narwhals

            See [interchange-only support](../extending.md/#interchange-only-support)
            for more details.
        series_only: Whether to only allow Series:

            - `False` (default): don't require `native_object` to be a Series
            - `True`: only convert to Narwhals if `native_object` is a Series
        allow_series: Whether to allow Series (default is only Dataframe / Lazyframe):

            - `False` or `None` (default): don't convert to Narwhals if `native_object` is a Series
            - `True`: allow `native_object` to be a Series

    Returns:
        DataFrame, LazyFrame, Series, or original object, depending
            on which combination of parameters was passed.
    """
    # Early returns
    if isinstance(native_object, (DataFrame, LazyFrame)) and not series_only:
        return native_object
    if isinstance(native_object, Series) and (series_only or allow_series):
        return native_object

    pass_through = validate_strict_and_pass_though(
        strict, pass_through, pass_through_default=False, emit_deprecation_warning=False
    )

    result = _from_native_impl(
        native_object,
        pass_through=pass_through,
        eager_only=eager_only,
        eager_or_interchange_only=eager_or_interchange_only,
        series_only=series_only,
        allow_series=allow_series,
        version=Version.V1,
    )
    return _stableify(result)  # type: ignore[no-any-return]


@overload
def to_native(
    narwhals_object: DataFrame[IntoDataFrameT], *, strict: Literal[True] = ...
) -> IntoDataFrameT: ...
@overload
def to_native(
    narwhals_object: LazyFrame[IntoFrameT], *, strict: Literal[True] = ...
) -> IntoFrameT: ...
@overload
def to_native(narwhals_object: Series, *, strict: Literal[True] = ...) -> Any: ...
@overload
def to_native(narwhals_object: Any, *, strict: bool) -> Any: ...
@overload
def to_native(
    narwhals_object: DataFrame[IntoDataFrameT], *, pass_through: Literal[False] = ...
) -> IntoDataFrameT: ...
@overload
def to_native(
    narwhals_object: LazyFrame[IntoFrameT], *, pass_through: Literal[False] = ...
) -> IntoFrameT: ...
@overload
def to_native(narwhals_object: Series, *, pass_through: Literal[False] = ...) -> Any: ...
@overload
def to_native(narwhals_object: Any, *, pass_through: bool) -> Any: ...


def to_native(
    narwhals_object: DataFrame[IntoFrameT] | LazyFrame[IntoFrameT] | Series,
    *,
    strict: bool | None = None,
    pass_through: bool | None = None,
) -> IntoFrameT | Any:
    """Convert Narwhals object to native one.

    Arguments:
        narwhals_object: Narwhals object.
        strict: Determine what happens if `narwhals_object` isn't a Narwhals class:

            - `True` (default): raise an error
            - `False`: pass object through as-is

            **Deprecated** (v1.13.0):
                Please use `pass_through` instead. Note that `strict` is still available
                (and won't emit a deprecation warning) if you use `narwhals.stable.v1`,
                see [perfect backwards compatibility policy](../backcompat.md/).
        pass_through: Determine what happens if `narwhals_object` isn't a Narwhals class:

            - `False` (default): raise an error
            - `True`: pass object through as-is

    Returns:
        Object of class that user started with.
    """
    from narwhals.dataframe import BaseFrame
    from narwhals.series import Series
    from narwhals.utils import validate_strict_and_pass_though

    pass_through = validate_strict_and_pass_though(
        strict, pass_through, pass_through_default=False, emit_deprecation_warning=False
    )

    if isinstance(narwhals_object, BaseFrame):
        return narwhals_object._compliant_frame._native_frame
    if isinstance(narwhals_object, Series):
        return narwhals_object._compliant_series._native_series

    if not pass_through:
        msg = f"Expected Narwhals object, got {type(narwhals_object)}."
        raise TypeError(msg)
    return narwhals_object


def narwhalify(
    func: Callable[..., Any] | None = None,
    *,
    strict: bool | None = None,
    pass_through: bool | None = None,
    eager_only: bool = False,
    eager_or_interchange_only: bool = False,
    series_only: bool = False,
    allow_series: bool | None = True,
) -> Callable[..., Any]:
    """Decorate function so it becomes dataframe-agnostic.

    This will try to convert any dataframe/series-like object into the Narwhals
    respective DataFrame/Series, while leaving the other parameters as they are.
    Similarly, if the output of the function is a Narwhals DataFrame or Series, it will be
    converted back to the original dataframe/series type, while if the output is another
    type it will be left as is.
    By setting `pass_through=False`, then every input and every output will be required to be a
    dataframe/series-like object.

    Arguments:
        func: Function to wrap in a `from_native`-`to_native` block.
        strict: **Deprecated** (v1.13.0):
            Please use `pass_through` instead. Note that `strict` is still available
            (and won't emit a deprecation warning) if you use `narwhals.stable.v1`,
            see [perfect backwards compatibility policy](../backcompat.md/).

            Determine what happens if the object can't be converted to Narwhals:

            - `True` or `None` (default): raise an error
            - `False`: pass object through as-is
        pass_through: Determine what happens if the object can't be converted to Narwhals:

            - `False` or `None` (default): raise an error
            - `True`: pass object through as-is
        eager_only: Whether to only allow eager objects:

            - `False` (default): don't require `native_object` to be eager
            - `True`: only convert to Narwhals if `native_object` is eager
        eager_or_interchange_only: Whether to only allow eager objects or objects which
            have interchange-level support in Narwhals:

            - `False` (default): don't require `native_object` to either be eager or to
              have interchange-level support in Narwhals
            - `True`: only convert to Narwhals if `native_object` is eager or has
              interchange-level support in Narwhals

            See [interchange-only support](../extending.md/#interchange-only-support)
            for more details.
        series_only: Whether to only allow Series:

            - `False` (default): don't require `native_object` to be a Series
            - `True`: only convert to Narwhals if `native_object` is a Series
        allow_series: Whether to allow Series (default is only Dataframe / Lazyframe):

            - `False` or `None`: don't convert to Narwhals if `native_object` is a Series
            - `True` (default): allow `native_object` to be a Series

    Returns:
        Decorated function.
    """
    pass_through = validate_strict_and_pass_though(
        strict, pass_through, pass_through_default=True, emit_deprecation_warning=False
    )

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            args = [
                from_native(
                    arg,
                    pass_through=pass_through,
                    eager_only=eager_only,
                    eager_or_interchange_only=eager_or_interchange_only,
                    series_only=series_only,
                    allow_series=allow_series,
                )
                for arg in args
            ]  # type: ignore[assignment]

            kwargs = {
                name: from_native(
                    value,
                    pass_through=pass_through,
                    eager_only=eager_only,
                    eager_or_interchange_only=eager_or_interchange_only,
                    series_only=series_only,
                    allow_series=allow_series,
                )
                for name, value in kwargs.items()
            }

            backends = {
                b()
                for v in (*args, *kwargs.values())
                if (b := getattr(v, "__native_namespace__", None))
            }

            if backends.__len__() > 1:
                msg = "Found multiple backends. Make sure that all dataframe/series inputs come from the same backend."
                raise ValueError(msg)

            result = func(*args, **kwargs)

            return to_native(result, pass_through=pass_through)

        return wrapper

    if func is None:
        return decorator
    else:
        # If func is not None, it means the decorator is used without arguments
        return decorator(func)


def all() -> Expr:
    """Instantiate an expression representing all columns.

    Returns:
        A new expression.
    """
    return _stableify(nw.all())


def col(*names: str | Iterable[str]) -> Expr:
    """Creates an expression that references one or more columns by their name(s).

    Arguments:
        names: Name(s) of the columns to use.

    Returns:
        A new expression.
    """
    return _stableify(nw.col(*names))


def nth(*indices: int | Sequence[int]) -> Expr:
    """Creates an expression that references one or more columns by their index(es).

    Notes:
        `nth` is not supported for Polars version<1.0.0. Please use
        [`narwhals.col`][] instead.

    Arguments:
        indices: One or more indices representing the columns to retrieve.

    Returns:
        A new expression.
    """
    return _stableify(nw.nth(*indices))


def len() -> Expr:
    """Return the number of rows.

    Returns:
        A new expression.
    """
    return _stableify(nw.len())


def lit(value: Any, dtype: DType | type[DType] | None = None) -> Expr:
    """Return an expression representing a literal value.

    Arguments:
        value: The value to use as literal.
        dtype: The data type of the literal value. If not provided, the data type will
            be inferred.

    Returns:
        A new expression.
    """
    return _stableify(nw.lit(value, dtype))


def min(*columns: str) -> Expr:
    """Return the minimum value.

    Note:
       Syntactic sugar for ``nw.col(columns).min()``.

    Arguments:
        columns: Name(s) of the columns to use in the aggregation function.

    Returns:
        A new expression.
    """
    return _stableify(nw.min(*columns))


def max(*columns: str) -> Expr:
    """Return the maximum value.

    Note:
       Syntactic sugar for ``nw.col(columns).max()``.

    Arguments:
        columns: Name(s) of the columns to use in the aggregation function.

    Returns:
        A new expression.
    """
    return _stableify(nw.max(*columns))


def mean(*columns: str) -> Expr:
    """Get the mean value.

    Note:
        Syntactic sugar for ``nw.col(columns).mean()``

    Arguments:
        columns: Name(s) of the columns to use in the aggregation function

    Returns:
        A new expression.
    """
    return _stableify(nw.mean(*columns))


def median(*columns: str) -> Expr:
    """Get the median value.

    Notes:
        - Syntactic sugar for ``nw.col(columns).median()``
        - Results might slightly differ across backends due to differences in the
            underlying algorithms used to compute the median.

    Arguments:
        columns: Name(s) of the columns to use in the aggregation function

    Returns:
        A new expression.
    """
    return _stableify(nw.median(*columns))


def sum(*columns: str) -> Expr:
    """Sum all values.

    Note:
        Syntactic sugar for ``nw.col(columns).sum()``

    Arguments:
        columns: Name(s) of the columns to use in the aggregation function

    Returns:
        A new expression.
    """
    return _stableify(nw.sum(*columns))


def sum_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    """Sum all values horizontally across columns.

    Warning:
        Unlike Polars, we support horizontal sum over numeric columns only.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

    Returns:
        A new expression.
    """
    return _stableify(nw.sum_horizontal(*exprs))


def all_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    r"""Compute the bitwise AND horizontally across columns.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

    Returns:
        A new expression.
    """
    return _stableify(nw.all_horizontal(*exprs))


def any_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    r"""Compute the bitwise OR horizontally across columns.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

    Returns:
        A new expression.
    """
    return _stableify(nw.any_horizontal(*exprs))


def mean_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    """Compute the mean of all values horizontally across columns.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

    Returns:
        A new expression.
    """
    return _stableify(nw.mean_horizontal(*exprs))


def min_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    """Get the minimum value horizontally across columns.

    Notes:
        We support `min_horizontal` over numeric columns only.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

    Returns:
        A new expression.
    """
    return _stableify(nw.min_horizontal(*exprs))


def max_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    """Get the maximum value horizontally across columns.

    Notes:
        We support `max_horizontal` over numeric columns only.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

    Returns:
        A new expression.
    """
    return _stableify(nw.max_horizontal(*exprs))


@overload
def concat(
    items: Iterable[DataFrame[IntoDataFrameT]],
    *,
    how: Literal["horizontal", "vertical", "diagonal"] = "vertical",
) -> DataFrame[IntoDataFrameT]: ...


@overload
def concat(
    items: Iterable[LazyFrame[IntoFrameT]],
    *,
    how: Literal["horizontal", "vertical", "diagonal"] = "vertical",
) -> LazyFrame[IntoFrameT]: ...


@overload
def concat(
    items: Iterable[DataFrame[IntoDataFrameT] | LazyFrame[IntoFrameT]],
    *,
    how: Literal["horizontal", "vertical", "diagonal"] = "vertical",
) -> DataFrame[IntoDataFrameT] | LazyFrame[IntoFrameT]: ...


def concat(
    items: Iterable[DataFrame[IntoDataFrameT] | LazyFrame[IntoFrameT]],
    *,
    how: Literal["horizontal", "vertical", "diagonal"] = "vertical",
) -> DataFrame[IntoDataFrameT] | LazyFrame[IntoFrameT]:
    """Concatenate multiple DataFrames, LazyFrames into a single entity.

    Arguments:
        items: DataFrames, LazyFrames to concatenate.
        how: concatenating strategy:

            - vertical: Concatenate vertically. Column names must match.
            - horizontal: Concatenate horizontally. If lengths don't match, then
                missing rows are filled with null values.
            - diagonal: Finds a union between the column schemas and fills missing column
                values with null.

    Returns:
        A new DataFrame, Lazyframe resulting from the concatenation.

    Raises:
        TypeError: The items to concatenate should either all be eager, or all lazy
    """
    return _stableify(nw.concat(items, how=how))


def concat_str(
    exprs: IntoExpr | Iterable[IntoExpr],
    *more_exprs: IntoExpr,
    separator: str = "",
    ignore_nulls: bool = False,
) -> Expr:
    r"""Horizontally concatenate columns into a single string column.

    Arguments:
        exprs: Columns to concatenate into a single string column. Accepts expression
            input. Strings are parsed as column names, other non-expression inputs are
            parsed as literals. Non-`String` columns are cast to `String`.
        *more_exprs: Additional columns to concatenate into a single string column,
            specified as positional arguments.
        separator: String that will be used to separate the values of each column.
        ignore_nulls: Ignore null values (default is `False`).
            If set to `False`, null values will be propagated and if the row contains any
            null values, the output is null.

    Returns:
        A new expression.
    """
    return _stableify(
        nw.concat_str(exprs, *more_exprs, separator=separator, ignore_nulls=ignore_nulls)
    )


class When(NwWhen):
    @classmethod
    def from_when(cls, when: NwWhen) -> Self:
        return cls(*when._predicates)

    def then(self, value: Any) -> Then:
        return Then.from_then(super().then(value))


class Then(NwThen, Expr):
    @classmethod
    def from_then(cls, then: NwThen) -> Self:
        return cls(then._to_compliant_expr)

    def otherwise(self, value: Any) -> Expr:
        return _stableify(super().otherwise(value))


def when(*predicates: IntoExpr | Iterable[IntoExpr]) -> When:
    """Start a `when-then-otherwise` expression.

    Expression similar to an `if-else` statement in Python. Always initiated by a
    `pl.when(<condition>).then(<value if condition>)`, and optionally followed by
    chaining one or more `.when(<condition>).then(<value>)` statements.
    Chained when-then operations should be read as Python `if, elif, ... elif`
    blocks, not as `if, if, ... if`, i.e. the first condition that evaluates to
    `True` will be picked.
    If none of the conditions are `True`, an optional
    `.otherwise(<value if all statements are false>)` can be appended at the end.
    If not appended, and none of the conditions are `True`, `None` will be returned.

    Arguments:
        predicates: Condition(s) that must be met in order to apply the subsequent
            statement. Accepts one or more boolean expressions, which are implicitly
            combined with `&`. String input is parsed as a column name.

    Returns:
        A "when" object, which `.then` can be called on.
    """
    return When.from_when(nw_when(*predicates))


def new_series(
    name: str,
    values: Any,
    dtype: DType | type[DType] | None = None,
    *,
    native_namespace: ModuleType,
) -> Series:
    """Instantiate Narwhals Series from iterable (e.g. list or array).

    Arguments:
        name: Name of resulting Series.
        values: Values of make Series from.
        dtype: (Narwhals) dtype. If not provided, the native library
            may auto-infer it from `values`.
        native_namespace: The native library to use for DataFrame creation.

    Returns:
        A new Series
    """
    return _stableify(  # type: ignore[no-any-return]
        _new_series_impl(
            name,
            values,
            dtype,
            native_namespace=native_namespace,
            version=Version.V1,
        )
    )


def from_arrow(
    native_frame: ArrowStreamExportable, *, native_namespace: ModuleType
) -> DataFrame[Any]:
    """Construct a DataFrame from an object which supports the PyCapsule Interface.

    Arguments:
        native_frame: Object which implements `__arrow_c_stream__`.
        native_namespace: The native library to use for DataFrame creation.

    Returns:
        A new DataFrame.
    """
    return _stableify(  # type: ignore[no-any-return]
        nw_from_arrow(native_frame, native_namespace=native_namespace)
    )


def from_dict(
    data: dict[str, Any],
    schema: dict[str, DType] | Schema | None = None,
    *,
    native_namespace: ModuleType | None = None,
) -> DataFrame[Any]:
    """Instantiate DataFrame from dictionary.

    Indexes (if present, for pandas-like backends) are aligned following
    the [left-hand-rule](../pandas_like_concepts/pandas_index.md/).

    Notes:
        For pandas-like dataframes, conversion to schema is applied after dataframe
        creation.

    Arguments:
        data: Dictionary to create DataFrame from.
        schema: The DataFrame schema as Schema or dict of {name: type}.
        native_namespace: The native library to use for DataFrame creation. Only
            necessary if inputs are not Narwhals Series.

    Returns:
        A new DataFrame.
    """
    return _stableify(  # type: ignore[no-any-return]
        _from_dict_impl(
            data,
            schema,
            native_namespace=native_namespace,
            version=Version.V1,
        )
    )


def from_numpy(
    data: np.ndarray,
    schema: dict[str, DType] | Schema | list[str] | None = None,
    *,
    native_namespace: ModuleType,
) -> DataFrame[Any]:
    """Construct a DataFrame from a NumPy ndarray.

    Notes:
        Only row orientation is currently supported.

        For pandas-like dataframes, conversion to schema is applied after dataframe
        creation.

    Arguments:
        data: Two-dimensional data represented as a NumPy ndarray.
        schema: The DataFrame schema as Schema, dict of {name: type}, or a list of str.
        native_namespace: The native library to use for DataFrame creation.

    Returns:
        A new DataFrame.
    """
    return _stableify(  # type: ignore[no-any-return]
        _from_numpy_impl(
            data,
            schema,
            native_namespace=native_namespace,
            version=Version.V1,
        )
    )


def read_csv(
    source: str, *, native_namespace: ModuleType, **kwargs: Any
) -> DataFrame[Any]:
    """Read a CSV file into a DataFrame.

    Arguments:
        source: Path to a file.
        native_namespace: The native library to use for DataFrame creation.
        kwargs: Extra keyword arguments which are passed to the native CSV reader.
            For example, you could use
            `nw.read_csv('file.csv', native_namespace=pd, engine='pyarrow')`.

    Returns:
        DataFrame.
    """
    return _stableify(  # type: ignore[no-any-return]
        _read_csv_impl(source, native_namespace=native_namespace, **kwargs)
    )


def scan_csv(
    source: str, *, native_namespace: ModuleType, **kwargs: Any
) -> LazyFrame[Any]:
    """Lazily read from a CSV file.

    For the libraries that do not support lazy dataframes, the function reads
    a csv file eagerly and then converts the resulting dataframe to a lazyframe.

    Arguments:
        source: Path to a file.
        native_namespace: The native library to use for DataFrame creation.
        kwargs: Extra keyword arguments which are passed to the native CSV reader.
            For example, you could use
            `nw.scan_csv('file.csv', native_namespace=pd, engine='pyarrow')`.

    Returns:
        LazyFrame.
    """
    return _stableify(  # type: ignore[no-any-return]
        _scan_csv_impl(source, native_namespace=native_namespace, **kwargs)
    )


def read_parquet(
    source: str, *, native_namespace: ModuleType, **kwargs: Any
) -> DataFrame[Any]:
    """Read into a DataFrame from a parquet file.

    Arguments:
        source: Path to a file.
        native_namespace: The native library to use for DataFrame creation.
        kwargs: Extra keyword arguments which are passed to the native parquet reader.
            For example, you could use
            `nw.read_parquet('file.parquet', native_namespace=pd, engine='pyarrow')`.

    Returns:
        DataFrame.
    """
    return _stableify(  # type: ignore[no-any-return]
        _read_parquet_impl(source, native_namespace=native_namespace, **kwargs)
    )


def scan_parquet(
    source: str, *, native_namespace: ModuleType, **kwargs: Any
) -> LazyFrame[Any]:
    """Lazily read from a parquet file.

    For the libraries that do not support lazy dataframes, the function reads
    a parquet file eagerly and then converts the resulting dataframe to a lazyframe.

    Arguments:
        source: Path to a file.
        native_namespace: The native library to use for DataFrame creation.
        kwargs: Extra keyword arguments which are passed to the native parquet reader.
            For example, you could use
            `nw.scan_parquet('file.parquet', native_namespace=pd, engine='pyarrow')`.

    Returns:
        LazyFrame.
    """
    return _stableify(  # type: ignore[no-any-return]
        _scan_parquet_impl(source, native_namespace=native_namespace, **kwargs)
    )


__all__ = [
    "Array",
    "Boolean",
    "Categorical",
    "DataFrame",
    "Date",
    "Datetime",
    "Decimal",
    "Duration",
    "Enum",
    "Expr",
    "Field",
    "Float32",
    "Float64",
    "Implementation",
    "Int8",
    "Int16",
    "Int32",
    "Int64",
    "Int128",
    "LazyFrame",
    "List",
    "Object",
    "Schema",
    "Series",
    "String",
    "Struct",
    "UInt8",
    "UInt16",
    "UInt32",
    "UInt64",
    "UInt128",
    "Unknown",
    "all",
    "all_horizontal",
    "any_horizontal",
    "col",
    "concat",
    "concat_str",
    "dependencies",
    "dtypes",
    "exceptions",
    "from_arrow",
    "from_dict",
    "from_native",
    "from_numpy",
    "generate_temporary_column_name",
    "get_level",
    "get_native_namespace",
    "is_ordered_categorical",
    "len",
    "lit",
    "max",
    "max_horizontal",
    "maybe_align_index",
    "maybe_convert_dtypes",
    "maybe_get_index",
    "maybe_reset_index",
    "maybe_set_index",
    "mean",
    "mean_horizontal",
    "median",
    "min",
    "min_horizontal",
    "narwhalify",
    "new_series",
    "nth",
    "read_csv",
    "read_parquet",
    "scan_csv",
    "scan_parquet",
    "selectors",
    "show_versions",
    "sum",
    "sum_horizontal",
    "to_native",
    "to_py_scalar",
    "when",
]
