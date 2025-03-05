from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any
from typing import Callable
from typing import Generic
from typing import Iterable
from typing import Iterator
from typing import Literal
from typing import NoReturn
from typing import Sequence
from typing import TypeVar
from typing import overload
from warnings import warn

from narwhals.dependencies import get_polars
from narwhals.dependencies import is_numpy_array
from narwhals.schema import Schema
from narwhals.translate import to_native
from narwhals.utils import find_stacklevel
from narwhals.utils import flatten
from narwhals.utils import generate_repr
from narwhals.utils import is_sequence_but_not_str
from narwhals.utils import parse_version

if TYPE_CHECKING:
    from io import BytesIO
    from pathlib import Path
    from types import ModuleType

    import numpy as np
    import pandas as pd
    import pyarrow as pa
    from typing_extensions import Self

    from narwhals.group_by import GroupBy
    from narwhals.group_by import LazyGroupBy
    from narwhals.series import Series
    from narwhals.typing import IntoDataFrame
    from narwhals.typing import IntoExpr
    from narwhals.typing import IntoFrame
    from narwhals.typing import SizeUnit
    from narwhals.utils import Implementation

FrameT = TypeVar("FrameT", bound="IntoFrame")
DataFrameT = TypeVar("DataFrameT", bound="IntoDataFrame")


class BaseFrame(Generic[FrameT]):
    _compliant_frame: Any
    _level: Literal["full", "lazy", "interchange"]

    def __native_namespace__(self: Self) -> ModuleType:
        return self._compliant_frame.__native_namespace__()  # type: ignore[no-any-return]

    def __narwhals_namespace__(self) -> Any:
        return self._compliant_frame.__narwhals_namespace__()

    def _from_compliant_dataframe(self, df: Any) -> Self:
        # construct, preserving properties
        return self.__class__(  # type: ignore[call-arg]
            df,
            level=self._level,
        )

    def _flatten_and_extract(self, *args: Any, **kwargs: Any) -> Any:
        """Process `args` and `kwargs`, extracting underlying objects as we go."""
        args = [self._extract_compliant(v) for v in flatten(args)]  # type: ignore[assignment]
        kwargs = {k: self._extract_compliant(v) for k, v in kwargs.items()}
        return args, kwargs

    def _extract_compliant(self, arg: Any) -> Any:
        from narwhals.expr import Expr
        from narwhals.series import Series

        if isinstance(arg, BaseFrame):
            return arg._compliant_frame
        if isinstance(arg, Series):
            return arg._compliant_series
        if isinstance(arg, Expr):
            return arg._to_compliant_expr(self.__narwhals_namespace__())
        if get_polars() is not None and "polars" in str(type(arg)):
            msg = (
                f"Expected Narwhals object, got: {type(arg)}.\n\n"
                "Perhaps you:\n"
                "- Forgot a `nw.from_native` somewhere?\n"
                "- Used `pl.col` instead of `nw.col`?"
            )
            raise TypeError(msg)
        return arg

    @property
    def schema(self) -> Schema:
        return Schema(self._compliant_frame.schema.items())

    def collect_schema(self) -> Schema:
        native_schema = dict(self._compliant_frame.collect_schema())

        return Schema(native_schema)

    def pipe(self, function: Callable[[Any], Self], *args: Any, **kwargs: Any) -> Self:
        return function(self, *args, **kwargs)

    def with_row_index(self, name: str = "index") -> Self:
        return self._from_compliant_dataframe(
            self._compliant_frame.with_row_index(name),
        )

    def drop_nulls(self: Self, subset: str | list[str] | None = None) -> Self:
        return self._from_compliant_dataframe(
            self._compliant_frame.drop_nulls(subset=subset),
        )

    @property
    def columns(self) -> list[str]:
        return self._compliant_frame.columns  # type: ignore[no-any-return]

    def with_columns(
        self, *exprs: IntoExpr | Iterable[IntoExpr], **named_exprs: IntoExpr
    ) -> Self:
        exprs, named_exprs = self._flatten_and_extract(*exprs, **named_exprs)
        return self._from_compliant_dataframe(
            self._compliant_frame.with_columns(*exprs, **named_exprs),
        )

    def select(
        self,
        *exprs: IntoExpr | Iterable[IntoExpr],
        **named_exprs: IntoExpr,
    ) -> Self:
        exprs, named_exprs = self._flatten_and_extract(*exprs, **named_exprs)
        return self._from_compliant_dataframe(
            self._compliant_frame.select(*exprs, **named_exprs),
        )

    def rename(self, mapping: dict[str, str]) -> Self:
        return self._from_compliant_dataframe(self._compliant_frame.rename(mapping))

    def head(self, n: int) -> Self:
        return self._from_compliant_dataframe(self._compliant_frame.head(n))

    def tail(self, n: int) -> Self:
        return self._from_compliant_dataframe(self._compliant_frame.tail(n))

    def drop(self, *columns: Iterable[str], strict: bool) -> Self:
        return self._from_compliant_dataframe(
            self._compliant_frame.drop(columns, strict=strict)
        )

    def filter(
        self, *predicates: IntoExpr | Iterable[IntoExpr] | list[bool], **constraints: Any
    ) -> Self:
        if not (
            len(predicates) == 1
            and isinstance(predicates[0], list)
            and all(isinstance(x, bool) for x in predicates[0])
        ):
            predicates, constraints = self._flatten_and_extract(
                *predicates, **constraints
            )
        return self._from_compliant_dataframe(
            self._compliant_frame.filter(*predicates, **constraints),
        )

    def sort(
        self,
        by: str | Iterable[str],
        *more_by: str,
        descending: bool | Sequence[bool] = False,
        nulls_last: bool = False,
    ) -> Self:
        return self._from_compliant_dataframe(
            self._compliant_frame.sort(
                by, *more_by, descending=descending, nulls_last=nulls_last
            )
        )

    def join(
        self,
        other: Self,
        on: str | list[str] | None = None,
        how: Literal["inner", "left", "cross", "semi", "anti"] = "inner",
        *,
        left_on: str | list[str] | None = None,
        right_on: str | list[str] | None = None,
        suffix: str = "_right",
    ) -> Self:
        _supported_joins = ("inner", "left", "cross", "anti", "semi")

        if how not in _supported_joins:
            msg = f"Only the following join strategies are supported: {_supported_joins}; found '{how}'."
            raise NotImplementedError(msg)

        if how == "cross" and (
            left_on is not None or right_on is not None or on is not None
        ):
            msg = "Can not pass `left_on`, `right_on` or `on` keys for cross join"
            raise ValueError(msg)

        if how != "cross" and (on is None and (left_on is None or right_on is None)):
            msg = f"Either (`left_on` and `right_on`) or `on` keys should be specified for {how}."
            raise ValueError(msg)

        if how != "cross" and (
            on is not None and (left_on is not None or right_on is not None)
        ):
            msg = f"If `on` is specified, `left_on` and `right_on` should be None for {how}."
            raise ValueError(msg)

        if on is not None:
            left_on = right_on = on

        return self._from_compliant_dataframe(
            self._compliant_frame.join(
                self._extract_compliant(other),
                how=how,
                left_on=left_on,
                right_on=right_on,
                suffix=suffix,
            )
        )

    def clone(self) -> Self:
        return self._from_compliant_dataframe(self._compliant_frame.clone())

    def gather_every(self: Self, n: int, offset: int = 0) -> Self:
        return self._from_compliant_dataframe(
            self._compliant_frame.gather_every(n=n, offset=offset)
        )

    def join_asof(
        self,
        other: Self,
        *,
        left_on: str | None = None,
        right_on: str | None = None,
        on: str | None = None,
        by_left: str | list[str] | None = None,
        by_right: str | list[str] | None = None,
        by: str | list[str] | None = None,
        strategy: Literal["backward", "forward", "nearest"] = "backward",
    ) -> Self:
        _supported_strategies = ("backward", "forward", "nearest")

        if strategy not in _supported_strategies:
            msg = f"Only the following strategies are supported: {_supported_strategies}; found '{strategy}'."
            raise NotImplementedError(msg)

        if (on is None) and (left_on is None or right_on is None):
            msg = "Either (`left_on` and `right_on`) or `on` keys should be specified."
            raise ValueError(msg)
        if (on is not None) and (left_on is not None or right_on is not None):
            msg = "If `on` is specified, `left_on` and `right_on` should be None."
            raise ValueError(msg)
        if (by is None) and (
            (by_left is None and by_right is not None)
            or (by_left is not None and by_right is None)
        ):
            msg = (
                "Can not specify only `by_left` or `by_right`, you need to specify both."
            )
            raise ValueError(msg)
        if (by is not None) and (by_left is not None or by_right is not None):
            msg = "If `by` is specified, `by_left` and `by_right` should be None."
            raise ValueError(msg)
        if on is not None:
            return self._from_compliant_dataframe(
                self._compliant_frame.join_asof(
                    self._extract_compliant(other),
                    on=on,
                    by_left=by_left,
                    by_right=by_right,
                    by=by,
                    strategy=strategy,
                )
            )
        return self._from_compliant_dataframe(
            self._compliant_frame.join_asof(
                self._extract_compliant(other),
                left_on=left_on,
                right_on=right_on,
                by_left=by_left,
                by_right=by_right,
                by=by,
                strategy=strategy,
            )
        )

    def unpivot(
        self: Self,
        on: str | list[str] | None,
        *,
        index: str | list[str] | None,
        variable_name: str | None,
        value_name: str | None,
    ) -> Self:
        return self._from_compliant_dataframe(
            self._compliant_frame.unpivot(
                on=on,
                index=index,
                variable_name=variable_name,
                value_name=value_name,
            )
        )

    def __neq__(self, other: Any) -> NoReturn:
        msg = (
            "DataFrame.__neq__ and LazyFrame.__neq__ are not implemented, please "
            "use expressions instead.\n\n"
            "Hint: instead of\n"
            "    df != 0\n"
            "you may want to use\n"
            "    df.select(nw.all() != 0)"
        )
        raise NotImplementedError(msg)

    def __eq__(self, other: object) -> NoReturn:
        msg = (
            "DataFrame.__eq__ and LazyFrame.__eq__ are not implemented, please "
            "use expressions instead.\n\n"
            "Hint: instead of\n"
            "    df == 0\n"
            "you may want to use\n"
            "    df.select(nw.all() == 0)"
        )
        raise NotImplementedError(msg)

    def explode(self: Self, columns: str | Sequence[str], *more_columns: str) -> Self:
        return self._from_compliant_dataframe(
            self._compliant_frame.explode(
                columns,
                *more_columns,
            )
        )


class DataFrame(BaseFrame[DataFrameT]):
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

    @property
    def _series(self) -> type[Series[Any]]:
        from narwhals.series import Series

        return Series

    @property
    def _lazyframe(self) -> type[LazyFrame[Any]]:
        return LazyFrame

    def __init__(
        self,
        df: Any,
        *,
        level: Literal["full", "lazy", "interchange"],
    ) -> None:
        self._level: Literal["full", "lazy", "interchange"] = level
        if hasattr(df, "__narwhals_dataframe__"):
            self._compliant_frame: Any = df.__narwhals_dataframe__()
        else:  # pragma: no cover
            msg = f"Expected an object which implements `__narwhals_dataframe__`, got: {type(df)}"
            raise AssertionError(msg)

    @property
    def implementation(self) -> Implementation:
        """Return implementation of native frame.

        This can be useful when you need to use special-casing for features outside of
        Narwhals' scope - for example, when dealing with pandas' Period Dtype.

        Returns:
            Implementation.

        Examples:
            >>> import narwhals as nw
            >>> import pandas as pd
            >>> df_native = pd.DataFrame({"a": [1, 2, 3]})
            >>> df = nw.from_native(df_native)
            >>> df.implementation
            <Implementation.PANDAS: 1>
            >>> df.implementation.is_pandas()
            True
            >>> df.implementation.is_pandas_like()
            True
            >>> df.implementation.is_polars()
            False
        """
        return self._compliant_frame._implementation  # type: ignore[no-any-return]

    def __len__(self) -> int:
        return self._compliant_frame.__len__()  # type: ignore[no-any-return]

    def __array__(self, dtype: Any = None, copy: bool | None = None) -> np.ndarray:
        return self._compliant_frame.__array__(dtype, copy=copy)

    def __repr__(self) -> str:  # pragma: no cover
        return generate_repr("Narwhals DataFrame", self.to_native().__repr__())

    def __arrow_c_stream__(self, requested_schema: object | None = None) -> object:
        """Export a DataFrame via the Arrow PyCapsule Interface.

        - if the underlying dataframe implements the interface, it'll return that
        - else, it'll call `to_arrow` and then defer to PyArrow's implementation

        See [PyCapsule Interface](https://arrow.apache.org/docs/dev/format/CDataInterface/PyCapsuleInterface.html)
        for more.
        """
        native_frame = self._compliant_frame._native_frame
        if hasattr(native_frame, "__arrow_c_stream__"):
            return native_frame.__arrow_c_stream__(requested_schema=requested_schema)
        try:
            import pyarrow as pa  # ignore-banned-import
        except ModuleNotFoundError as exc:  # pragma: no cover
            msg = f"PyArrow>=14.0.0 is required for `DataFrame.__arrow_c_stream__` for object of type {type(native_frame)}"
            raise ModuleNotFoundError(msg) from exc
        if parse_version(pa.__version__) < (14, 0):  # pragma: no cover
            msg = f"PyArrow>=14.0.0 is required for `DataFrame.__arrow_c_stream__` for object of type {type(native_frame)}"
            raise ModuleNotFoundError(msg) from None
        pa_table = self.to_arrow()
        return pa_table.__arrow_c_stream__(requested_schema=requested_schema)

    def lazy(self) -> LazyFrame[Any]:
        """Lazify the DataFrame (if possible).

        If a library does not support lazy execution, then this is a no-op.

        Returns:
            A new LazyFrame.

        Examples:
            Construct pandas, Polars and PyArrow DataFrames:

            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrame
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_lazy(df_native: IntoFrame) -> IntoFrame:
            ...     df = nw.from_native(df_native)
            ...     return df.lazy().to_native()

            Note that then, pandas and pyarrow dataframe stay eager, but Polars DataFrame
            becomes a Polars LazyFrame:

            >>> agnostic_lazy(df_pd)
               foo  bar ham
            0    1  6.0   a
            1    2  7.0   b
            2    3  8.0   c
            >>> agnostic_lazy(df_pl)
            <LazyFrame ...>
            >>> agnostic_lazy(df_pa)
            pyarrow.Table
            foo: int64
            bar: double
            ham: string
            ----
            foo: [[1,2,3]]
            bar: [[6,7,8]]
            ham: [["a","b","c"]]
        """
        return self._lazyframe(self._compliant_frame.lazy(), level="lazy")

    def to_native(self) -> DataFrameT:
        """Convert Narwhals DataFrame to native one.

        Returns:
            Object of class that user started with.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Calling `to_native` on a Narwhals DataFrame returns the native object:

            >>> nw.from_native(df_pd).to_native()
               foo  bar ham
            0    1  6.0   a
            1    2  7.0   b
            2    3  8.0   c
            >>> nw.from_native(df_pl).to_native()
            shape: (3, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ f64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 6.0 ┆ a   │
            │ 2   ┆ 7.0 ┆ b   │
            │ 3   ┆ 8.0 ┆ c   │
            └─────┴─────┴─────┘
            >>> nw.from_native(df_pa).to_native()
            pyarrow.Table
            foo: int64
            bar: double
            ham: string
            ----
            foo: [[1,2,3]]
            bar: [[6,7,8]]
            ham: [["a","b","c"]]
        """
        return self._compliant_frame._native_frame  # type: ignore[no-any-return]

    def to_pandas(self) -> pd.DataFrame:
        """Convert this DataFrame to a pandas DataFrame.

        Returns:
            A pandas DataFrame.

        Examples:
            Construct pandas, Polars (eager) and PyArrow DataFrames:

            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_to_pandas(df_native: IntoDataFrame) -> pd.DataFrame:
            ...     df = nw.from_native(df_native)
            ...     return df.to_pandas()

            We can then pass any supported library such as pandas, Polars (eager), or
            PyArrow to `agnostic_to_pandas`:

            >>> agnostic_to_pandas(df_pd)
               foo  bar ham
            0    1  6.0   a
            1    2  7.0   b
            2    3  8.0   c
            >>> agnostic_to_pandas(df_pl)
               foo  bar ham
            0    1  6.0   a
            1    2  7.0   b
            2    3  8.0   c
            >>> agnostic_to_pandas(df_pa)
               foo  bar ham
            0    1  6.0   a
            1    2  7.0   b
            2    3  8.0   c
        """
        return self._compliant_frame.to_pandas()

    @overload
    def write_csv(self, file: None = None) -> str: ...

    @overload
    def write_csv(self, file: str | Path | BytesIO) -> None: ...

    def write_csv(self, file: str | Path | BytesIO | None = None) -> str | None:
        r"""Write dataframe to comma-separated values (CSV) file.

        Arguments:
            file: String, path object or file-like object to which the dataframe will be
                written. If None, the resulting csv format is returned as a string.

        Returns:
            String or None.

        Examples:
            Construct pandas, Polars (eager) and PyArrow DataFrames:

            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_write_csv(df_native: IntoDataFrame) -> str:
            ...     df = nw.from_native(df_native)
            ...     return df.write_csv()

            We can pass any supported library such as pandas, Polars or PyArrow to `agnostic_write_csv`:

            >>> agnostic_write_csv(df_pd)
            'foo,bar,ham\n1,6.0,a\n2,7.0,b\n3,8.0,c\n'
            >>> agnostic_write_csv(df_pl)
            'foo,bar,ham\n1,6.0,a\n2,7.0,b\n3,8.0,c\n'
            >>> agnostic_write_csv(df_pa)
            '"foo","bar","ham"\n1,6,"a"\n2,7,"b"\n3,8,"c"\n'

            If we had passed a file name to `write_csv`, it would have been
            written to that file.
        """
        return self._compliant_frame.write_csv(file)  # type: ignore[no-any-return]

    def write_parquet(self, file: str | Path | BytesIO) -> None:
        """Write dataframe to parquet file.

        Arguments:
            file: String, path object or file-like object to which the dataframe will be
                written.

        Returns:
            None.

        Examples:
            Construct pandas, Polars and PyArrow DataFrames:

            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_write_parquet(df_native: IntoDataFrame):
            ...     df = nw.from_native(df_native)
            ...     df.write_parquet("foo.parquet")

            We can then pass either pandas, Polars or PyArrow to `agnostic_write_parquet`:

            >>> agnostic_write_parquet(df_pd)  # doctest:+SKIP
            >>> agnostic_write_parquet(df_pl)  # doctest:+SKIP
            >>> agnostic_write_parquet(df_pa)  # doctest:+SKIP
        """
        self._compliant_frame.write_parquet(file)

    def to_numpy(self) -> np.ndarray:
        """Convert this DataFrame to a NumPy ndarray.

        Returns:
            A NumPy ndarray array.

        Examples:
            Construct pandas and polars DataFrames:

            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> import numpy as np
            >>> from narwhals.typing import IntoDataFrame
            >>> data = {"foo": [1, 2, 3], "bar": [6.5, 7.0, 8.5], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_to_numpy(df_native: IntoDataFrame) -> np.ndarray:
            ...     df = nw.from_native(df_native)
            ...     return df.to_numpy()

            We can then pass either pandas, Polars or PyArrow to `agnostic_to_numpy`:

            >>> agnostic_to_numpy(df_pd)
            array([[1, 6.5, 'a'],
                   [2, 7.0, 'b'],
                   [3, 8.5, 'c']], dtype=object)
            >>> agnostic_to_numpy(df_pl)
            array([[1, 6.5, 'a'],
                   [2, 7.0, 'b'],
                   [3, 8.5, 'c']], dtype=object)
            >>> agnostic_to_numpy(df_pa)
            array([[1, 6.5, 'a'],
                   [2, 7.0, 'b'],
                   [3, 8.5, 'c']], dtype=object)
        """
        return self._compliant_frame.to_numpy()

    @property
    def shape(self) -> tuple[int, int]:
        """Get the shape of the DataFrame.

        Returns:
            The shape of the dataframe as a tuple.

        Examples:
            Construct pandas and polars DataFrames:

            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> data = {"foo": [1, 2, 3, 4, 5]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_shape(df_native: IntoDataFrame) -> tuple[int, int]:
            ...     df = nw.from_native(df_native)
            ...     return df.shape

            We can then pass either pandas, Polars or PyArrow to `agnostic_shape`:

            >>> agnostic_shape(df_pd)
            (5, 1)
            >>> agnostic_shape(df_pl)
            (5, 1)
            >>> agnostic_shape(df_pa)
            (5, 1)
        """
        return self._compliant_frame.shape  # type: ignore[no-any-return]

    def get_column(self, name: str) -> Series[Any]:
        """Get a single column by name.

        Arguments:
            name: The column name as a string.

        Returns:
            A Narwhals Series, backed by a native series.

        Notes:
            Although `name` is typed as `str`, pandas does allow non-string column
            names, and they will work when passed to this function if the
            `narwhals.DataFrame` is backed by a pandas dataframe with non-string
            columns. This function can only be used to extract a column by name, so
            there is no risk of ambiguity.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> from narwhals.typing import IntoSeries
            >>> data = {"a": [1, 2], "b": [3, 4]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_get_column(df_native: IntoDataFrame) -> IntoSeries:
            ...     df = nw.from_native(df_native)
            ...     name = df.columns[0]
            ...     return df.get_column(name).to_native()

            We can then pass either pandas, Polars or PyArrow to `agnostic_get_column`:

            >>> agnostic_get_column(df_pd)
            0    1
            1    2
            Name: a, dtype: int64
            >>> agnostic_get_column(df_pl)  # doctest:+NORMALIZE_WHITESPACE
            shape: (2,)
            Series: 'a' [i64]
            [
                1
                2
            ]
            >>> agnostic_get_column(df_pa)  # doctest:+ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                1,
                2
              ]
            ]
        """
        return self._series(
            self._compliant_frame.get_column(name),
            level=self._level,
        )

    def estimated_size(self, unit: SizeUnit = "b") -> int | float:
        """Return an estimation of the total (heap) allocated size of the `DataFrame`.

        Estimated size is given in the specified unit (bytes by default).

        Arguments:
            unit: 'b', 'kb', 'mb', 'gb', 'tb', 'bytes', 'kilobytes', 'megabytes',
                'gigabytes', or 'terabytes'.

        Returns:
            Integer or Float.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrameT
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6.0, 7.0, 8.0],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_estimated_size(df_native: IntoDataFrameT) -> int | float:
            ...     df = nw.from_native(df_native)
            ...     return df.estimated_size()

            We can then pass either pandas, Polars or PyArrow to `agnostic_estimated_size`:

            >>> agnostic_estimated_size(df_pd)
            np.int64(330)
            >>> agnostic_estimated_size(df_pl)
            51
            >>> agnostic_estimated_size(df_pa)
            63
        """
        return self._compliant_frame.estimated_size(unit=unit)  # type: ignore[no-any-return]

    @overload
    def __getitem__(self, item: tuple[Sequence[int], slice]) -> Self: ...
    @overload
    def __getitem__(self, item: tuple[Sequence[int], Sequence[int]]) -> Self: ...
    @overload
    def __getitem__(self, item: tuple[slice, Sequence[int]]) -> Self: ...
    @overload
    def __getitem__(self, item: tuple[Sequence[int], str]) -> Series[Any]: ...  # type: ignore[overload-overlap]
    @overload
    def __getitem__(self, item: tuple[slice, str]) -> Series[Any]: ...  # type: ignore[overload-overlap]
    @overload
    def __getitem__(self, item: tuple[Sequence[int], Sequence[str]]) -> Self: ...
    @overload
    def __getitem__(self, item: tuple[slice, Sequence[str]]) -> Self: ...
    @overload
    def __getitem__(self, item: tuple[Sequence[int], int]) -> Series[Any]: ...  # type: ignore[overload-overlap]
    @overload
    def __getitem__(self, item: tuple[slice, int]) -> Series[Any]: ...  # type: ignore[overload-overlap]

    @overload
    def __getitem__(self, item: Sequence[int]) -> Self: ...

    @overload
    def __getitem__(self, item: str) -> Series[Any]: ...  # type: ignore[overload-overlap]

    @overload
    def __getitem__(self, item: Sequence[str]) -> Self: ...

    @overload
    def __getitem__(self, item: slice) -> Self: ...

    @overload
    def __getitem__(self, item: tuple[slice, slice]) -> Self: ...

    def __getitem__(
        self,
        item: (
            str
            | slice
            | Sequence[int]
            | Sequence[str]
            | tuple[Sequence[int], str | int]
            | tuple[slice, str | int]
            | tuple[slice | Sequence[int], Sequence[int] | Sequence[str] | slice]
            | tuple[slice, slice]
        ),
    ) -> Series[Any] | Self:
        """Extract column or slice of DataFrame.

        Arguments:
            item: How to slice dataframe. What happens depends on what is passed. It's easiest
                to explain by example. Suppose we have a Dataframe `df`:

                - `df['a']` extracts column `'a'` and returns a `Series`.
                - `df[0:2]` extracts the first two rows and returns a `DataFrame`.
                - `df[0:2, 'a']` extracts the first two rows from column `'a'` and returns
                    a `Series`.
                - `df[0:2, 0]` extracts the first two rows from the first column and returns
                    a `Series`.
                - `df[[0, 1], [0, 1, 2]]` extracts the first two rows and the first three columns
                    and returns a `DataFrame`
                - `df[:, [0, 1, 2]]` extracts all rows from the first three columns and returns a
                  `DataFrame`.
                - `df[:, ['a', 'c']]` extracts all rows and columns `'a'` and `'c'` and returns a
                  `DataFrame`.
                - `df[['a', 'c']]` extracts all rows and columns `'a'` and `'c'` and returns a
                  `DataFrame`.
                - `df[0: 2, ['a', 'c']]` extracts the first two rows and columns `'a'` and `'c'` and
                    returns a `DataFrame`
                - `df[:, 0: 2]` extracts all rows from the first two columns and returns a `DataFrame`
                - `df[:, 'a': 'c']` extracts all rows and all columns positioned between `'a'` and `'c'`
                    _inclusive_ and returns a `DataFrame`. For example, if the columns are
                    `'a', 'd', 'c', 'b'`, then that would extract columns `'a'`, `'d'`, and `'c'`.

        Returns:
            A Narwhals Series, backed by a native series.

        Notes:
            - Integers are always interpreted as positions
            - Strings are always interpreted as column names.

            In contrast with Polars, pandas allows non-string column names.
            If you don't know whether the column name you're trying to extract
            is definitely a string (e.g. `df[df.columns[0]]`) then you should
            use `DataFrame.get_column` instead.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> from narwhals.typing import IntoSeries
            >>> data = {"a": [1, 2], "b": [3, 4]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_slice(df_native: IntoDataFrame) -> IntoSeries:
            ...     df = nw.from_native(df_native)
            ...     return df["a"].to_native()

            We can then pass either pandas, Polars or PyArrow to `agnostic_slice`:

            >>> agnostic_slice(df_pd)
            0    1
            1    2
            Name: a, dtype: int64
            >>> agnostic_slice(df_pl)  # doctest:+NORMALIZE_WHITESPACE
            shape: (2,)
            Series: 'a' [i64]
            [
                1
                2
            ]
            >>> agnostic_slice(df_pa)  # doctest:+ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                1,
                2
              ]
            ]

        """
        if isinstance(item, int):
            item = [item]
        if (
            isinstance(item, tuple)
            and len(item) == 2
            and (isinstance(item[0], (str, int)))
        ):
            msg = (
                f"Expected str or slice, got: {type(item)}.\n\n"
                "Hint: if you were trying to get a single element out of a "
                "dataframe, use `DataFrame.item`."
            )
            raise TypeError(msg)
        if (
            isinstance(item, tuple)
            and len(item) == 2
            and (is_sequence_but_not_str(item[1]) or isinstance(item[1], slice))
        ):
            if item[1] == slice(None) and item[0] == slice(None):
                return self
            return self._from_compliant_dataframe(self._compliant_frame[item])
        if isinstance(item, str) or (isinstance(item, tuple) and len(item) == 2):
            return self._series(
                self._compliant_frame[item],
                level=self._level,
            )

        elif (
            is_sequence_but_not_str(item)
            or isinstance(item, slice)
            or (is_numpy_array(item) and item.ndim == 1)
        ):
            return self._from_compliant_dataframe(self._compliant_frame[item])

        else:
            msg = f"Expected str or slice, got: {type(item)}"
            raise TypeError(msg)

    def __contains__(self, key: str) -> bool:
        return key in self.columns

    @overload
    def to_dict(self, *, as_series: Literal[True] = ...) -> dict[str, Series[Any]]: ...
    @overload
    def to_dict(self, *, as_series: Literal[False]) -> dict[str, list[Any]]: ...
    @overload
    def to_dict(
        self, *, as_series: bool
    ) -> dict[str, Series[Any]] | dict[str, list[Any]]: ...
    def to_dict(
        self, *, as_series: bool = True
    ) -> dict[str, Series[Any]] | dict[str, list[Any]]:
        """Convert DataFrame to a dictionary mapping column name to values.

        Arguments:
            as_series: If set to true ``True``, then the values are Narwhals Series,
                    otherwise the values are Any.

        Returns:
            A mapping from column name to values / Series.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> data = {
            ...     "A": [1, 2, 3, 4, 5],
            ...     "fruits": ["banana", "banana", "apple", "apple", "banana"],
            ...     "B": [5, 4, 3, 2, 1],
            ...     "animals": ["beetle", "fly", "beetle", "beetle", "beetle"],
            ...     "optional": [28, 300, None, 2, -30],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_to_dict(
            ...     df_native: IntoDataFrame,
            ... ) -> dict[str, list[int | str | float | None]]:
            ...     df = nw.from_native(df_native)
            ...     return df.to_dict(as_series=False)

            We can then pass either pandas, Polars or PyArrow to `agnostic_to_dict`:

            >>> agnostic_to_dict(df_pd)
            {'A': [1, 2, 3, 4, 5], 'fruits': ['banana', 'banana', 'apple', 'apple', 'banana'], 'B': [5, 4, 3, 2, 1], 'animals': ['beetle', 'fly', 'beetle', 'beetle', 'beetle'], 'optional': [28.0, 300.0, nan, 2.0, -30.0]}
            >>> agnostic_to_dict(df_pl)
            {'A': [1, 2, 3, 4, 5], 'fruits': ['banana', 'banana', 'apple', 'apple', 'banana'], 'B': [5, 4, 3, 2, 1], 'animals': ['beetle', 'fly', 'beetle', 'beetle', 'beetle'], 'optional': [28, 300, None, 2, -30]}
            >>> agnostic_to_dict(df_pa)
            {'A': [1, 2, 3, 4, 5], 'fruits': ['banana', 'banana', 'apple', 'apple', 'banana'], 'B': [5, 4, 3, 2, 1], 'animals': ['beetle', 'fly', 'beetle', 'beetle', 'beetle'], 'optional': [28, 300, None, 2, -30]}
        """
        if as_series:
            return {
                key: self._series(
                    value,
                    level=self._level,
                )
                for key, value in self._compliant_frame.to_dict(
                    as_series=as_series
                ).items()
            }
        return self._compliant_frame.to_dict(as_series=as_series)  # type: ignore[no-any-return]

    def row(self, index: int) -> tuple[Any, ...]:
        """Get values at given row.

        !!! warning
            You should NEVER use this method to iterate over a DataFrame;
            if you require row-iteration you should strongly prefer use of iter_rows()
            instead.

        Arguments:
            index: Row number.

        Returns:
            A tuple of the values in the selected row.

        Notes:
            cuDF doesn't support this method.

        Examples:
            >>> import narwhals as nw
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> from narwhals.typing import IntoDataFrame
            >>> from typing import Any
            >>> data = {"a": [1, 2, 3], "b": [4, 5, 6]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a library-agnostic function to get the second row.

            >>> def agnostic_row(df_native: IntoDataFrame) -> tuple[Any, ...]:
            ...     return nw.from_native(df_native).row(1)

            We can then pass either pandas, Polars or PyArrow to `agnostic_row`:

            >>> agnostic_row(df_pd)
            (2, 5)
            >>> agnostic_row(df_pl)
            (2, 5)
            >>> agnostic_row(df_pa)
            (<pyarrow.Int64Scalar: 2>, <pyarrow.Int64Scalar: 5>)
        """
        return self._compliant_frame.row(index)  # type: ignore[no-any-return]

    # inherited
    def pipe(self, function: Callable[[Any], Self], *args: Any, **kwargs: Any) -> Self:
        """Pipe function call.

        Arguments:
            function: Function to apply.
            args: Positional arguments to pass to function.
            kwargs: Keyword arguments to pass to function.

        Returns:
            The original object with the function applied.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {"a": [1, 2, 3], "ba": [4, 5, 6]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_pipe(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.pipe(
            ...         lambda _df: _df.select(
            ...             [x for x in _df.columns if len(x) == 1]
            ...         ).to_native()
            ...     )

            We can then pass either pandas, Polars or PyArrow to `agnostic_pipe`:

            >>> agnostic_pipe(df_pd)
               a
            0  1
            1  2
            2  3
            >>> agnostic_pipe(df_pl)
            shape: (3, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 1   │
            │ 2   │
            │ 3   │
            └─────┘
            >>> agnostic_pipe(df_pa)
            pyarrow.Table
            a: int64
            ----
            a: [[1,2,3]]
        """
        return super().pipe(function, *args, **kwargs)

    def drop_nulls(self: Self, subset: str | list[str] | None = None) -> Self:
        """Drop rows that contain null values.

        Arguments:
            subset: Column name(s) for which null values are considered. If set to None
                (default), use all columns.

        Returns:
            The original object with the rows removed that contained the null values.

        Notes:
            pandas handles null values differently from Polars and PyArrow.
            See [null_handling](../pandas_like_concepts/null_handling.md)
            for reference.

        Examples:
            >>> import polars as pl
            >>> import pandas as pd
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {"a": [1.0, 2.0, None], "ba": [1.0, None, 2.0]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_drop_nulls(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.drop_nulls().to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_drop_nulls`:

            >>> agnostic_drop_nulls(df_pd)
                 a   ba
            0  1.0  1.0
            >>> agnostic_drop_nulls(df_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a   ┆ ba  │
            │ --- ┆ --- │
            │ f64 ┆ f64 │
            ╞═════╪═════╡
            │ 1.0 ┆ 1.0 │
            └─────┴─────┘
            >>> agnostic_drop_nulls(df_pa)
            pyarrow.Table
            a: double
            ba: double
            ----
            a: [[1]]
            ba: [[1]]
        """
        return super().drop_nulls(subset=subset)

    def with_row_index(self, name: str = "index") -> Self:
        """Insert column which enumerates rows.

        Arguments:
            name: The name of the column as a string. The default is "index".

        Returns:
            The original object with the column added.

        Examples:
            Construct pandas as polars DataFrames:

            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {"a": [1, 2, 3], "b": [4, 5, 6]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_with_row_index(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_row_index().to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_with_row_index`:

            >>> agnostic_with_row_index(df_pd)
               index  a  b
            0      0  1  4
            1      1  2  5
            2      2  3  6
            >>> agnostic_with_row_index(df_pl)
            shape: (3, 3)
            ┌───────┬─────┬─────┐
            │ index ┆ a   ┆ b   │
            │ ---   ┆ --- ┆ --- │
            │ u32   ┆ i64 ┆ i64 │
            ╞═══════╪═════╪═════╡
            │ 0     ┆ 1   ┆ 4   │
            │ 1     ┆ 2   ┆ 5   │
            │ 2     ┆ 3   ┆ 6   │
            └───────┴─────┴─────┘
            >>> agnostic_with_row_index(df_pa)
            pyarrow.Table
            index: int64
            a: int64
            b: int64
            ----
            index: [[0,1,2]]
            a: [[1,2,3]]
            b: [[4,5,6]]
        """
        return super().with_row_index(name)

    @property
    def schema(self) -> Schema:
        r"""Get an ordered mapping of column names to their data type.

        Returns:
            A Narwhals Schema object that displays the mapping of column names.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.schema import Schema
            >>> from narwhals.typing import IntoFrame
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6.0, 7.0, 8.0],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_schema(df_native: IntoFrame) -> Schema:
            ...     df = nw.from_native(df_native)
            ...     return df.schema

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_schema`:

            >>> agnostic_schema(df_pd)
            Schema({'foo': Int64, 'bar': Float64, 'ham': String})
            >>> agnostic_schema(df_pl)
            Schema({'foo': Int64, 'bar': Float64, 'ham': String})
            >>> agnostic_schema(df_pa)
            Schema({'foo': Int64, 'bar': Float64, 'ham': String})
        """
        return super().schema

    def collect_schema(self: Self) -> Schema:
        r"""Get an ordered mapping of column names to their data type.

        Returns:
            A Narwhals Schema object that displays the mapping of column names.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.schema import Schema
            >>> from narwhals.typing import IntoFrame
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6.0, 7.0, 8.0],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_collect_schema(df_native: IntoFrame) -> Schema:
            ...     df = nw.from_native(df_native)
            ...     return df.collect_schema()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_collect_schema`:

            >>> agnostic_collect_schema(df_pd)
            Schema({'foo': Int64, 'bar': Float64, 'ham': String})
            >>> agnostic_collect_schema(df_pl)
            Schema({'foo': Int64, 'bar': Float64, 'ham': String})
            >>> agnostic_collect_schema(df_pa)
            Schema({'foo': Int64, 'bar': Float64, 'ham': String})
        """
        return super().collect_schema()

    @property
    def columns(self) -> list[str]:
        """Get column names.

        Returns:
            The column names stored in a list.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrame
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_columns(df_native: IntoFrame) -> list[str]:
            ...     df = nw.from_native(df_native)
            ...     return df.columns

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_columns`:

            >>> agnostic_columns(df_pd)
            ['foo', 'bar', 'ham']
            >>> agnostic_columns(df_pl)
            ['foo', 'bar', 'ham']
            >>> agnostic_columns(df_pa)
            ['foo', 'bar', 'ham']
        """
        return super().columns

    @overload
    def rows(self, *, named: Literal[False] = False) -> list[tuple[Any, ...]]: ...

    @overload
    def rows(self, *, named: Literal[True]) -> list[dict[str, Any]]: ...

    @overload
    def rows(self, *, named: bool) -> list[tuple[Any, ...]] | list[dict[str, Any]]: ...

    def rows(
        self, *, named: bool = False
    ) -> list[tuple[Any, ...]] | list[dict[str, Any]]:
        """Returns all data in the DataFrame as a list of rows of python-native values.

        Arguments:
            named: By default, each row is returned as a tuple of values given
                in the same order as the frame columns. Setting named=True will
                return rows of dictionaries instead.

        Returns:
            The data as a list of rows.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_rows(df_native: IntoDataFrame, *, named: bool):
            ...     return nw.from_native(df_native, eager_only=True).rows(named=named)

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_rows`:

            >>> agnostic_rows(df_pd, named=False)
            [(1, 6.0, 'a'), (2, 7.0, 'b'), (3, 8.0, 'c')]
            >>> agnostic_rows(df_pd, named=True)
            [{'foo': 1, 'bar': 6.0, 'ham': 'a'}, {'foo': 2, 'bar': 7.0, 'ham': 'b'}, {'foo': 3, 'bar': 8.0, 'ham': 'c'}]
            >>> agnostic_rows(df_pl, named=False)
            [(1, 6.0, 'a'), (2, 7.0, 'b'), (3, 8.0, 'c')]
            >>> agnostic_rows(df_pl, named=True)
            [{'foo': 1, 'bar': 6.0, 'ham': 'a'}, {'foo': 2, 'bar': 7.0, 'ham': 'b'}, {'foo': 3, 'bar': 8.0, 'ham': 'c'}]
            >>> agnostic_rows(df_pa, named=False)
            [(1, 6.0, 'a'), (2, 7.0, 'b'), (3, 8.0, 'c')]
            >>> agnostic_rows(df_pa, named=True)
            [{'foo': 1, 'bar': 6.0, 'ham': 'a'}, {'foo': 2, 'bar': 7.0, 'ham': 'b'}, {'foo': 3, 'bar': 8.0, 'ham': 'c'}]
        """
        return self._compliant_frame.rows(named=named)  # type: ignore[no-any-return]

    @overload
    def iter_rows(
        self, *, named: Literal[False], buffer_size: int = ...
    ) -> Iterator[tuple[Any, ...]]: ...

    @overload
    def iter_rows(
        self, *, named: Literal[True], buffer_size: int = ...
    ) -> Iterator[dict[str, Any]]: ...

    @overload
    def iter_rows(
        self, *, named: bool, buffer_size: int = ...
    ) -> Iterator[tuple[Any, ...]] | Iterator[dict[str, Any]]: ...

    def iter_rows(
        self, *, named: bool = False, buffer_size: int = 512
    ) -> Iterator[tuple[Any, ...]] | Iterator[dict[str, Any]]:
        """Returns an iterator over the DataFrame of rows of python-native values.

        Arguments:
            named: By default, each row is returned as a tuple of values given
                in the same order as the frame columns. Setting named=True will
                return rows of dictionaries instead.
            buffer_size: Determines the number of rows that are buffered
                internally while iterating over the data.
                See https://docs.pola.rs/api/python/stable/reference/dataframe/api/polars.DataFrame.iter_rows.html

        Returns:
            An iterator over the DataFrame of rows.

        Notes:
            cuDF doesn't support this method.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_iter_rows(df_native: IntoDataFrame, *, named: bool):
            ...     return nw.from_native(df_native, eager_only=True).iter_rows(named=named)

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_iter_rows`:

            >>> [row for row in agnostic_iter_rows(df_pd, named=False)]
            [(1, 6.0, 'a'), (2, 7.0, 'b'), (3, 8.0, 'c')]
            >>> [row for row in agnostic_iter_rows(df_pd, named=True)]
            [{'foo': 1, 'bar': 6.0, 'ham': 'a'}, {'foo': 2, 'bar': 7.0, 'ham': 'b'}, {'foo': 3, 'bar': 8.0, 'ham': 'c'}]
            >>> [row for row in agnostic_iter_rows(df_pl, named=False)]
            [(1, 6.0, 'a'), (2, 7.0, 'b'), (3, 8.0, 'c')]
            >>> [row for row in agnostic_iter_rows(df_pl, named=True)]
            [{'foo': 1, 'bar': 6.0, 'ham': 'a'}, {'foo': 2, 'bar': 7.0, 'ham': 'b'}, {'foo': 3, 'bar': 8.0, 'ham': 'c'}]
            >>> [row for row in agnostic_iter_rows(df_pa, named=False)]
            [(1, 6.0, 'a'), (2, 7.0, 'b'), (3, 8.0, 'c')]
            >>> [row for row in agnostic_iter_rows(df_pa, named=True)]
            [{'foo': 1, 'bar': 6.0, 'ham': 'a'}, {'foo': 2, 'bar': 7.0, 'ham': 'b'}, {'foo': 3, 'bar': 8.0, 'ham': 'c'}]
        """
        return self._compliant_frame.iter_rows(named=named, buffer_size=buffer_size)  # type: ignore[no-any-return]

    def with_columns(
        self, *exprs: IntoExpr | Iterable[IntoExpr], **named_exprs: IntoExpr
    ) -> Self:
        r"""Add columns to this DataFrame.

        Added columns will replace existing columns with the same name.

        Arguments:
            *exprs: Column(s) to add, specified as positional arguments.
                     Accepts expression input. Strings are parsed as column names, other
                     non-expression inputs are parsed as literals.

            **named_exprs: Additional columns to add, specified as keyword arguments.
                            The columns will be renamed to the keyword used.

        Returns:
            DataFrame: A new DataFrame with the columns added.

        Note:
            Creating a new DataFrame using this method does not create a new copy of
            existing data.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {
            ...     "a": [1, 2, 3, 4],
            ...     "b": [0.5, 4, 10, 13],
            ...     "c": [True, True, False, True],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function in which we pass an expression
            to add it as a new column:

            >>> def agnostic_with_columns(df_native: IntoFrameT) -> IntoFrameT:
            ...     return (
            ...         nw.from_native(df_native)
            ...         .with_columns((nw.col("a") * 2).alias("a*2"))
            ...         .to_native()
            ...     )

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_with_columns`:

            >>> agnostic_with_columns(df_pd)
               a     b      c  a*2
            0  1   0.5   True    2
            1  2   4.0   True    4
            2  3  10.0  False    6
            3  4  13.0   True    8
            >>> agnostic_with_columns(df_pl)
            shape: (4, 4)
            ┌─────┬──────┬───────┬─────┐
            │ a   ┆ b    ┆ c     ┆ a*2 │
            │ --- ┆ ---  ┆ ---   ┆ --- │
            │ i64 ┆ f64  ┆ bool  ┆ i64 │
            ╞═════╪══════╪═══════╪═════╡
            │ 1   ┆ 0.5  ┆ true  ┆ 2   │
            │ 2   ┆ 4.0  ┆ true  ┆ 4   │
            │ 3   ┆ 10.0 ┆ false ┆ 6   │
            │ 4   ┆ 13.0 ┆ true  ┆ 8   │
            └─────┴──────┴───────┴─────┘
            >>> agnostic_with_columns(df_pa)
            pyarrow.Table
            a: int64
            b: double
            c: bool
            a*2: int64
            ----
            a: [[1,2,3,4]]
            b: [[0.5,4,10,13]]
            c: [[true,true,false,true]]
            a*2: [[2,4,6,8]]
        """
        return super().with_columns(*exprs, **named_exprs)

    def select(
        self,
        *exprs: IntoExpr | Iterable[IntoExpr],
        **named_exprs: IntoExpr,
    ) -> Self:
        r"""Select columns from this DataFrame.

        Arguments:
            *exprs: Column(s) to select, specified as positional arguments.
                     Accepts expression input. Strings are parsed as column names,
                     other non-expression inputs are parsed as literals.

            **named_exprs: Additional columns to select, specified as keyword arguments.
                            The columns will be renamed to the keyword used.

        Returns:
            The dataframe containing only the selected columns.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6, 7, 8],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function in which we pass the name of a
            column to select that column.

            >>> def agnostic_single_select(df_native: IntoFrameT) -> IntoFrameT:
            ...     return nw.from_native(df_native).select("foo").to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_single_select`:

            >>> agnostic_single_select(df_pd)
               foo
            0    1
            1    2
            2    3
            >>> agnostic_single_select(df_pl)
            shape: (3, 1)
            ┌─────┐
            │ foo │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 1   │
            │ 2   │
            │ 3   │
            └─────┘
            >>> agnostic_single_select(df_pa)
            pyarrow.Table
            foo: int64
            ----
            foo: [[1,2,3]]

            Multiple columns can be selected by passing a list of column names.

            >>> def agnostic_multi_select(df_native: IntoFrameT) -> IntoFrameT:
            ...     return nw.from_native(df_native).select(["foo", "bar"]).to_native()

            >>> agnostic_multi_select(df_pd)
               foo  bar
            0    1    6
            1    2    7
            2    3    8
            >>> agnostic_multi_select(df_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ foo ┆ bar │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 6   │
            │ 2   ┆ 7   │
            │ 3   ┆ 8   │
            └─────┴─────┘
            >>> agnostic_multi_select(df_pa)
            pyarrow.Table
            foo: int64
            bar: int64
            ----
            foo: [[1,2,3]]
            bar: [[6,7,8]]

            Multiple columns can also be selected using positional arguments instead of a
            list. Expressions are also accepted.

            >>> def agnostic_select(df_native: IntoFrameT) -> IntoFrameT:
            ...     return (
            ...         nw.from_native(df_native)
            ...         .select(nw.col("foo"), nw.col("bar") + 1)
            ...         .to_native()
            ...     )

            >>> agnostic_select(df_pd)
               foo  bar
            0    1    7
            1    2    8
            2    3    9
            >>> agnostic_select(df_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ foo ┆ bar │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 7   │
            │ 2   ┆ 8   │
            │ 3   ┆ 9   │
            └─────┴─────┘
            >>> agnostic_select(df_pa)
            pyarrow.Table
            foo: int64
            bar: int64
            ----
            foo: [[1,2,3]]
            bar: [[7,8,9]]

            Use keyword arguments to easily name your expression inputs.

            >>> def agnostic_select_w_kwargs(df_native: IntoFrameT) -> IntoFrameT:
            ...     return (
            ...         nw.from_native(df_native)
            ...         .select(threshold=nw.col("foo") * 2)
            ...         .to_native()
            ...     )

            >>> agnostic_select_w_kwargs(df_pd)
               threshold
            0          2
            1          4
            2          6
            >>> agnostic_select_w_kwargs(df_pl)
            shape: (3, 1)
            ┌───────────┐
            │ threshold │
            │ ---       │
            │ i64       │
            ╞═══════════╡
            │ 2         │
            │ 4         │
            │ 6         │
            └───────────┘
            >>> agnostic_select_w_kwargs(df_pa)
            pyarrow.Table
            threshold: int64
            ----
            threshold: [[2,4,6]]
        """
        return super().select(*exprs, **named_exprs)

    def rename(self, mapping: dict[str, str]) -> Self:
        """Rename column names.

        Arguments:
            mapping: Key value pairs that map from old name to new name.

        Returns:
            The dataframe with the specified columns renamed.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {"foo": [1, 2, 3], "bar": [6, 7, 8], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_rename(df_native: IntoFrameT) -> IntoFrameT:
            ...     return nw.from_native(df_native).rename({"foo": "apple"}).to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_rename`:

            >>> agnostic_rename(df_pd)
               apple  bar ham
            0      1    6   a
            1      2    7   b
            2      3    8   c
            >>> agnostic_rename(df_pl)
            shape: (3, 3)
            ┌───────┬─────┬─────┐
            │ apple ┆ bar ┆ ham │
            │ ---   ┆ --- ┆ --- │
            │ i64   ┆ i64 ┆ str │
            ╞═══════╪═════╪═════╡
            │ 1     ┆ 6   ┆ a   │
            │ 2     ┆ 7   ┆ b   │
            │ 3     ┆ 8   ┆ c   │
            └───────┴─────┴─────┘
            >>> agnostic_rename(df_pa)
            pyarrow.Table
            apple: int64
            bar: int64
            ham: string
            ----
            apple: [[1,2,3]]
            bar: [[6,7,8]]
            ham: [["a","b","c"]]
        """
        return super().rename(mapping)

    def head(self, n: int = 5) -> Self:
        """Get the first `n` rows.

        Arguments:
            n: Number of rows to return. If a negative value is passed, return all rows
                except the last `abs(n)`.

        Returns:
            A subset of the dataframe of shape (n, n_columns).

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {
            ...     "foo": [1, 2, 3, 4, 5],
            ...     "bar": [6, 7, 8, 9, 10],
            ...     "ham": ["a", "b", "c", "d", "e"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function that gets the first 3 rows.

            >>> def agnostic_head(df_native: IntoFrameT) -> IntoFrameT:
            ...     return nw.from_native(df_native).head(3).to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_head`:

            >>> agnostic_head(df_pd)
               foo  bar ham
            0    1    6   a
            1    2    7   b
            2    3    8   c
            >>> agnostic_head(df_pl)
            shape: (3, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 6   ┆ a   │
            │ 2   ┆ 7   ┆ b   │
            │ 3   ┆ 8   ┆ c   │
            └─────┴─────┴─────┘
            >>> agnostic_head(df_pa)
            pyarrow.Table
            foo: int64
            bar: int64
            ham: string
            ----
            foo: [[1,2,3]]
            bar: [[6,7,8]]
            ham: [["a","b","c"]]
        """
        return super().head(n)

    def tail(self, n: int = 5) -> Self:
        """Get the last `n` rows.

        Arguments:
            n: Number of rows to return. If a negative value is passed, return all rows
                except the first `abs(n)`.

        Returns:
            A subset of the dataframe of shape (n, n_columns).

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {
            ...     "foo": [1, 2, 3, 4, 5],
            ...     "bar": [6, 7, 8, 9, 10],
            ...     "ham": ["a", "b", "c", "d", "e"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function that gets the last 3 rows.

            >>> def agnostic_tail(df_native: IntoFrameT) -> IntoFrameT:
            ...     return nw.from_native(df_native).tail(3).to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_tail`:

            >>> agnostic_tail(df_pd)
               foo  bar ham
            2    3    8   c
            3    4    9   d
            4    5   10   e
            >>> agnostic_tail(df_pl)
            shape: (3, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 3   ┆ 8   ┆ c   │
            │ 4   ┆ 9   ┆ d   │
            │ 5   ┆ 10  ┆ e   │
            └─────┴─────┴─────┘
            >>> agnostic_tail(df_pa)
            pyarrow.Table
            foo: int64
            bar: int64
            ham: string
            ----
            foo: [[3,4,5]]
            bar: [[8,9,10]]
            ham: [["c","d","e"]]
        """
        return super().tail(n)

    def drop(self, *columns: str | Iterable[str], strict: bool = True) -> Self:
        """Remove columns from the dataframe.

        Returns:
            The dataframe with the specified columns removed.

        Arguments:
            *columns: Names of the columns that should be removed from the dataframe.
            strict: Validate that all column names exist in the schema and throw an
                exception if a column name does not exist in the schema.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_drop(df_native: IntoFrameT) -> IntoFrameT:
            ...     return nw.from_native(df_native).drop("ham").to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_drop`:

            >>> agnostic_drop(df_pd)
               foo  bar
            0    1  6.0
            1    2  7.0
            2    3  8.0
            >>> agnostic_drop(df_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ foo ┆ bar │
            │ --- ┆ --- │
            │ i64 ┆ f64 │
            ╞═════╪═════╡
            │ 1   ┆ 6.0 │
            │ 2   ┆ 7.0 │
            │ 3   ┆ 8.0 │
            └─────┴─────┘
            >>> agnostic_drop(df_pa)
            pyarrow.Table
            foo: int64
            bar: double
            ----
            foo: [[1,2,3]]
            bar: [[6,7,8]]

            Use positional arguments to drop multiple columns.

            >>> def agnostic_drop_multi(df_native: IntoFrameT) -> IntoFrameT:
            ...     return nw.from_native(df_native).drop("foo", "ham").to_native()

            >>> agnostic_drop_multi(df_pd)
               bar
            0  6.0
            1  7.0
            2  8.0
            >>> agnostic_drop_multi(df_pl)
            shape: (3, 1)
            ┌─────┐
            │ bar │
            │ --- │
            │ f64 │
            ╞═════╡
            │ 6.0 │
            │ 7.0 │
            │ 8.0 │
            └─────┘
            >>> agnostic_drop_multi(df_pa)
            pyarrow.Table
            bar: double
            ----
            bar: [[6,7,8]]

        """
        return super().drop(*flatten(columns), strict=strict)

    def unique(
        self,
        subset: str | list[str] | None = None,
        *,
        keep: Literal["any", "first", "last", "none"] = "any",
        maintain_order: bool = False,
    ) -> Self:
        """Drop duplicate rows from this dataframe.

        Arguments:
            subset: Column name(s) to consider when identifying duplicate rows.
            keep: {'first', 'last', 'any', 'none'}
                Which of the duplicate rows to keep.

                * 'any': Does not give any guarantee of which row is kept.
                        This allows more optimizations.
                * 'none': Don't keep duplicate rows.
                * 'first': Keep first unique row.
                * 'last': Keep last unique row.
            maintain_order: Keep the same order as the original DataFrame. This may be more
                expensive to compute.

        Returns:
            The dataframe with the duplicate rows removed.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {
            ...     "foo": [1, 2, 3, 1],
            ...     "bar": ["a", "a", "a", "a"],
            ...     "ham": ["b", "b", "b", "b"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_unique(df_native: IntoFrameT) -> IntoFrameT:
            ...     return nw.from_native(df_native).unique(["bar", "ham"]).to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_unique`:

            >>> agnostic_unique(df_pd)
               foo bar ham
            0    1   a   b
            >>> agnostic_unique(df_pl)
            shape: (1, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ str ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ a   ┆ b   │
            └─────┴─────┴─────┘
            >>> agnostic_unique(df_pa)
            pyarrow.Table
            foo: int64
            bar: string
            ham: string
            ----
            foo: [[1]]
            bar: [["a"]]
            ham: [["b"]]
        """
        if keep not in {"any", "none", "first", "last"}:
            msg = f"Expected {'any', 'none', 'first', 'last'}, got: {keep}"
            raise ValueError(msg)
        if isinstance(subset, str):
            subset = [subset]
        return self._from_compliant_dataframe(
            self._compliant_frame.unique(
                subset=subset, keep=keep, maintain_order=maintain_order
            )
        )

    def filter(
        self, *predicates: IntoExpr | Iterable[IntoExpr] | list[bool], **constraints: Any
    ) -> Self:
        r"""Filter the rows in the DataFrame based on one or more predicate expressions.

        The original order of the remaining rows is preserved.

        Arguments:
            *predicates: Expression(s) that evaluates to a boolean Series. Can
                also be a (single!) boolean list.
            **constraints: Column filters; use `name = value` to filter columns by the supplied value.
                Each constraint will behave the same as `nw.col(name).eq(value)`, and will be implicitly
                joined with the other filter conditions using &.

        Returns:
            The filtered dataframe.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6, 7, 8],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function in which we filter on
            one condition.

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.filter(nw.col("foo") > 1).to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_filter`:

            >>> agnostic_filter(df_pd)
               foo  bar ham
            1    2    7   b
            2    3    8   c
            >>> agnostic_filter(df_pl)
            shape: (2, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 2   ┆ 7   ┆ b   │
            │ 3   ┆ 8   ┆ c   │
            └─────┴─────┴─────┘
            >>> agnostic_filter(df_pa)
            pyarrow.Table
            foo: int64
            bar: int64
            ham: string
            ----
            foo: [[2,3]]
            bar: [[7,8]]
            ham: [["b","c"]]

            Filter on multiple conditions, combined with and/or operators:

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.filter((nw.col("foo") < 3) & (nw.col("ham") == "a")).to_native()
            >>> agnostic_filter(df_pd)
               foo  bar ham
            0    1    6   a
            >>> agnostic_filter(df_pl)
            shape: (1, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 6   ┆ a   │
            └─────┴─────┴─────┘
            >>> agnostic_filter(df_pa)
            pyarrow.Table
            foo: int64
            bar: int64
            ham: string
            ----
            foo: [[1]]
            bar: [[6]]
            ham: [["a"]]

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     dframe = df.filter(
            ...         (nw.col("foo") == 1) | (nw.col("ham") == "c")
            ...     ).to_native()
            ...     return dframe
            >>> agnostic_filter(df_pd)
               foo  bar ham
            0    1    6   a
            2    3    8   c
            >>> agnostic_filter(df_pl)
            shape: (2, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 6   ┆ a   │
            │ 3   ┆ 8   ┆ c   │
            └─────┴─────┴─────┘
            >>> agnostic_filter(df_pa)
            pyarrow.Table
            foo: int64
            bar: int64
            ham: string
            ----
            foo: [[1,3]]
            bar: [[6,8]]
            ham: [["a","c"]]

            Provide multiple filters using `*args` syntax:

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     dframe = df.filter(
            ...         nw.col("foo") <= 2,
            ...         ~nw.col("ham").is_in(["b", "c"]),
            ...     ).to_native()
            ...     return dframe
            >>> agnostic_filter(df_pd)
               foo  bar ham
            0    1    6   a
            >>> agnostic_filter(df_pl)
            shape: (1, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 6   ┆ a   │
            └─────┴─────┴─────┘
            >>> agnostic_filter(df_pa)
            pyarrow.Table
            foo: int64
            bar: int64
            ham: string
            ----
            foo: [[1]]
            bar: [[6]]
            ham: [["a"]]

            Provide multiple filters using `**kwargs` syntax:

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.filter(foo=2, ham="b").to_native()
            >>> agnostic_filter(df_pd)
               foo  bar ham
            1    2    7   b
            >>> agnostic_filter(df_pl)
            shape: (1, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 2   ┆ 7   ┆ b   │
            └─────┴─────┴─────┘
            >>> agnostic_filter(df_pa)
            pyarrow.Table
            foo: int64
            bar: int64
            ham: string
            ----
            foo: [[2]]
            bar: [[7]]
            ham: [["b"]]
        """
        return super().filter(*predicates, **constraints)

    def group_by(
        self, *keys: str | Iterable[str], drop_null_keys: bool = False
    ) -> GroupBy[Self]:
        r"""Start a group by operation.

        Arguments:
            *keys: Column(s) to group by. Accepts multiple columns names as a list.
            drop_null_keys: if True, then groups where any key is null won't be included
                in the result.

        Returns:
            GroupBy: Object which can be used to perform aggregations.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrameT
            >>> data = {
            ...     "a": ["a", "b", "a", "b", "c"],
            ...     "b": [1, 2, 1, 3, 3],
            ...     "c": [5, 4, 3, 2, 1],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function in which we group by one column
            and call `agg` to compute the grouped sum of another column.

            >>> def agnostic_group_by_agg(df_native: IntoDataFrameT) -> IntoDataFrameT:
            ...     df = nw.from_native(df_native, eager_only=True)
            ...     return df.group_by("a").agg(nw.col("b").sum()).sort("a").to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_group_by_agg`:

            >>> agnostic_group_by_agg(df_pd)
               a  b
            0  a  2
            1  b  5
            2  c  3
            >>> agnostic_group_by_agg(df_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ str ┆ i64 │
            ╞═════╪═════╡
            │ a   ┆ 2   │
            │ b   ┆ 5   │
            │ c   ┆ 3   │
            └─────┴─────┘
            >>> agnostic_group_by_agg(df_pa)
            pyarrow.Table
            a: string
            b: int64
            ----
            a: [["a","b","c"]]
            b: [[2,5,3]]

            Group by multiple columns by passing a list of column names.

            >>> def agnostic_group_by_agg(df_native: IntoDataFrameT) -> IntoDataFrameT:
            ...     df = nw.from_native(df_native, eager_only=True)
            ...     return df.group_by(["a", "b"]).agg(nw.max("c")).sort("a", "b").to_native()

            >>> agnostic_group_by_agg(df_pd)
               a  b  c
            0  a  1  5
            1  b  2  4
            2  b  3  2
            3  c  3  1
            >>> agnostic_group_by_agg(df_pl)
            shape: (4, 3)
            ┌─────┬─────┬─────┐
            │ a   ┆ b   ┆ c   │
            │ --- ┆ --- ┆ --- │
            │ str ┆ i64 ┆ i64 │
            ╞═════╪═════╪═════╡
            │ a   ┆ 1   ┆ 5   │
            │ b   ┆ 2   ┆ 4   │
            │ b   ┆ 3   ┆ 2   │
            │ c   ┆ 3   ┆ 1   │
            └─────┴─────┴─────┘
            >>> agnostic_group_by_agg(df_pa)
            pyarrow.Table
            a: string
            b: int64
            c: int64
            ----
            a: [["a","b","b","c"]]
            b: [[1,2,3,3]]
            c: [[5,4,2,1]]
        """
        from narwhals.expr import Expr
        from narwhals.group_by import GroupBy
        from narwhals.series import Series

        flat_keys = flatten(keys)
        if any(isinstance(x, (Expr, Series)) for x in flat_keys):
            msg = (
                "`group_by` with expression or Series keys is not (yet?) supported.\n\n"
                "Hint: instead of `df.group_by(nw.col('a'))`, use `df.group_by('a')`."
            )
            raise NotImplementedError(msg)
        return GroupBy(self, *flat_keys, drop_null_keys=drop_null_keys)

    def sort(
        self,
        by: str | Iterable[str],
        *more_by: str,
        descending: bool | Sequence[bool] = False,
        nulls_last: bool = False,
    ) -> Self:
        r"""Sort the dataframe by the given columns.

        Arguments:
            by: Column(s) names to sort by.
            *more_by: Additional columns to sort by, specified as positional arguments.
            descending: Sort in descending order. When sorting by multiple columns, can be
                specified per column by passing a sequence of booleans.
            nulls_last: Place null values last.

        Returns:
            The sorted dataframe.

        Warning:
            Unlike Polars, it is not possible to specify a sequence of booleans for
            `nulls_last` in order to control per-column behaviour. Instead a single
            boolean is applied for all `by` columns.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {
            ...     "a": [1, 2, None],
            ...     "b": [6.0, 5.0, 4.0],
            ...     "c": ["a", "c", "b"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function in which we sort by multiple
            columns in different orders

            >>> def agnostic_sort(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.sort("c", "a", descending=[False, True]).to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_sort`:

            >>> agnostic_sort(df_pd)
                 a    b  c
            0  1.0  6.0  a
            2  NaN  4.0  b
            1  2.0  5.0  c
            >>> agnostic_sort(df_pl)
            shape: (3, 3)
            ┌──────┬─────┬─────┐
            │ a    ┆ b   ┆ c   │
            │ ---  ┆ --- ┆ --- │
            │ i64  ┆ f64 ┆ str │
            ╞══════╪═════╪═════╡
            │ 1    ┆ 6.0 ┆ a   │
            │ null ┆ 4.0 ┆ b   │
            │ 2    ┆ 5.0 ┆ c   │
            └──────┴─────┴─────┘
            >>> agnostic_sort(df_pa)
            pyarrow.Table
            a: int64
            b: double
            c: string
            ----
            a: [[1,null,2]]
            b: [[6,4,5]]
            c: [["a","b","c"]]
        """
        return super().sort(by, *more_by, descending=descending, nulls_last=nulls_last)

    def join(
        self,
        other: Self,
        on: str | list[str] | None = None,
        how: Literal["inner", "left", "cross", "semi", "anti"] = "inner",
        *,
        left_on: str | list[str] | None = None,
        right_on: str | list[str] | None = None,
        suffix: str = "_right",
    ) -> Self:
        r"""Join in SQL-like fashion.

        Arguments:
            other: DataFrame to join with.
            on: Name(s) of the join columns in both DataFrames. If set, `left_on` and
                `right_on` should be None.
            how: Join strategy.

                  * *inner*: Returns rows that have matching values in both tables.
                  * *left*: Returns all rows from the left table, and the matched rows from the right table.
                  * *cross*: Returns the Cartesian product of rows from both tables.
                  * *semi*: Filter rows that have a match in the right table.
                  * *anti*: Filter rows that do not have a match in the right table.
            left_on: Join column of the left DataFrame.
            right_on: Join column of the right DataFrame.
            suffix: Suffix to append to columns with a duplicate name.

        Returns:
            A new joined DataFrame

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6.0, 7.0, 8.0],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> data_other = {
            ...     "apple": ["x", "y", "z"],
            ...     "ham": ["a", "b", "d"],
            ... }

            >>> df_pd = pd.DataFrame(data)
            >>> other_pd = pd.DataFrame(data_other)

            >>> df_pl = pl.DataFrame(data)
            >>> other_pl = pl.DataFrame(data_other)

            >>> df_pa = pa.table(data)
            >>> other_pa = pa.table(data_other)

            Let's define a dataframe-agnostic function in which we join over "ham" column:

            >>> def agnostic_join_on_ham(
            ...     df_native: IntoFrameT, other_native: IntoFrameT
            ... ) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     other = nw.from_native(other_native)
            ...     return df.join(other, left_on="ham", right_on="ham").to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_join_on_ham`:

            >>> agnostic_join_on_ham(df_pd, other_pd)
               foo  bar ham apple
            0    1  6.0   a     x
            1    2  7.0   b     y

            >>> agnostic_join_on_ham(df_pl, other_pl)
            shape: (2, 4)
            ┌─────┬─────┬─────┬───────┐
            │ foo ┆ bar ┆ ham ┆ apple │
            │ --- ┆ --- ┆ --- ┆ ---   │
            │ i64 ┆ f64 ┆ str ┆ str   │
            ╞═════╪═════╪═════╪═══════╡
            │ 1   ┆ 6.0 ┆ a   ┆ x     │
            │ 2   ┆ 7.0 ┆ b   ┆ y     │
            └─────┴─────┴─────┴───────┘
            >>> agnostic_join_on_ham(df_pa, other_pa)
            pyarrow.Table
            foo: int64
            bar: double
            ham: string
            apple: string
            ----
            foo: [[1,2]]
            bar: [[6,7]]
            ham: [["a","b"]]
            apple: [["x","y"]]
        """
        return super().join(
            other, how=how, left_on=left_on, right_on=right_on, on=on, suffix=suffix
        )

    def join_asof(
        self,
        other: Self,
        *,
        left_on: str | None = None,
        right_on: str | None = None,
        on: str | None = None,
        by_left: str | list[str] | None = None,
        by_right: str | list[str] | None = None,
        by: str | list[str] | None = None,
        strategy: Literal["backward", "forward", "nearest"] = "backward",
    ) -> Self:
        """Perform an asof join.

        This is similar to a left-join except that we match on nearest key rather than equal keys.

        Both DataFrames must be sorted by the asof_join key.

        Arguments:
            other: DataFrame to join with.
            left_on: Name(s) of the left join column(s).
            right_on: Name(s) of the right join column(s).
            on: Join column of both DataFrames. If set, left_on and right_on should be None.
            by_left: join on these columns before doing asof join.
            by_right: join on these columns before doing asof join.
            by: join on these columns before doing asof join.
            strategy: Join strategy. The default is "backward".

                  * *backward*: selects the last row in the right DataFrame whose "on" key is less than or equal to the left's key.
                  * *forward*: selects the first row in the right DataFrame whose "on" key is greater than or equal to the left's key.
                  * *nearest*: search selects the last row in the right DataFrame whose value is nearest to the left's key.

        Returns:
            A new joined DataFrame

        Examples:
            >>> from datetime import datetime
            >>> from typing import Literal
            >>> import pandas as pd
            >>> import polars as pl
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data_gdp = {
            ...     "datetime": [
            ...         datetime(2016, 1, 1),
            ...         datetime(2017, 1, 1),
            ...         datetime(2018, 1, 1),
            ...         datetime(2019, 1, 1),
            ...         datetime(2020, 1, 1),
            ...     ],
            ...     "gdp": [4164, 4411, 4566, 4696, 4827],
            ... }
            >>> data_population = {
            ...     "datetime": [
            ...         datetime(2016, 3, 1),
            ...         datetime(2018, 8, 1),
            ...         datetime(2019, 1, 1),
            ...     ],
            ...     "population": [82.19, 82.66, 83.12],
            ... }
            >>> gdp_pd = pd.DataFrame(data_gdp)
            >>> population_pd = pd.DataFrame(data_population)

            >>> gdp_pl = pl.DataFrame(data_gdp).sort("datetime")
            >>> population_pl = pl.DataFrame(data_population).sort("datetime")

            Let's define a dataframe-agnostic function in which we join over "datetime" column:

            >>> def agnostic_join_asof_datetime(
            ...     df_native: IntoFrameT,
            ...     other_native: IntoFrameT,
            ...     strategy: Literal["backward", "forward", "nearest"],
            ... ) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     other = nw.from_native(other_native)
            ...     return df.join_asof(other, on="datetime", strategy=strategy).to_native()

            We can then pass any supported library such as Pandas or Polars
            to `agnostic_join_asof_datetime`:

            >>> agnostic_join_asof_datetime(population_pd, gdp_pd, strategy="backward")
                datetime  population   gdp
            0 2016-03-01       82.19  4164
            1 2018-08-01       82.66  4566
            2 2019-01-01       83.12  4696

            >>> agnostic_join_asof_datetime(population_pl, gdp_pl, strategy="backward")
            shape: (3, 3)
            ┌─────────────────────┬────────────┬──────┐
            │ datetime            ┆ population ┆ gdp  │
            │ ---                 ┆ ---        ┆ ---  │
            │ datetime[μs]        ┆ f64        ┆ i64  │
            ╞═════════════════════╪════════════╪══════╡
            │ 2016-03-01 00:00:00 ┆ 82.19      ┆ 4164 │
            │ 2018-08-01 00:00:00 ┆ 82.66      ┆ 4566 │
            │ 2019-01-01 00:00:00 ┆ 83.12      ┆ 4696 │
            └─────────────────────┴────────────┴──────┘

            Here is a real-world times-series example that uses `by` argument.

            >>> from datetime import datetime
            >>> import narwhals as nw
            >>> import pandas as pd
            >>> import polars as pl
            >>> data_quotes = {
            ...     "datetime": [
            ...         datetime(2016, 5, 25, 13, 30, 0, 23),
            ...         datetime(2016, 5, 25, 13, 30, 0, 23),
            ...         datetime(2016, 5, 25, 13, 30, 0, 30),
            ...         datetime(2016, 5, 25, 13, 30, 0, 41),
            ...         datetime(2016, 5, 25, 13, 30, 0, 48),
            ...         datetime(2016, 5, 25, 13, 30, 0, 49),
            ...         datetime(2016, 5, 25, 13, 30, 0, 72),
            ...         datetime(2016, 5, 25, 13, 30, 0, 75),
            ...     ],
            ...     "ticker": [
            ...         "GOOG",
            ...         "MSFT",
            ...         "MSFT",
            ...         "MSFT",
            ...         "GOOG",
            ...         "AAPL",
            ...         "GOOG",
            ...         "MSFT",
            ...     ],
            ...     "bid": [720.50, 51.95, 51.97, 51.99, 720.50, 97.99, 720.50, 52.01],
            ...     "ask": [720.93, 51.96, 51.98, 52.00, 720.93, 98.01, 720.88, 52.03],
            ... }
            >>> data_trades = {
            ...     "datetime": [
            ...         datetime(2016, 5, 25, 13, 30, 0, 23),
            ...         datetime(2016, 5, 25, 13, 30, 0, 38),
            ...         datetime(2016, 5, 25, 13, 30, 0, 48),
            ...         datetime(2016, 5, 25, 13, 30, 0, 48),
            ...         datetime(2016, 5, 25, 13, 30, 0, 48),
            ...     ],
            ...     "ticker": ["MSFT", "MSFT", "GOOG", "GOOG", "AAPL"],
            ...     "price": [51.95, 51.95, 720.77, 720.92, 98.0],
            ...     "quantity": [75, 155, 100, 100, 100],
            ... }
            >>> quotes_pd = pd.DataFrame(data_quotes)
            >>> trades_pd = pd.DataFrame(data_trades)
            >>> quotes_pl = pl.DataFrame(data_quotes).sort("datetime")
            >>> trades_pl = pl.DataFrame(data_trades).sort("datetime")

            Let's define a dataframe-agnostic function in which we join over "datetime" and by "ticker" columns:

            >>> def agnostic_join_asof_datetime_by_ticker(
            ...     df_native: IntoFrameT, other_native: IntoFrameT
            ... ) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     other = nw.from_native(other_native)
            ...     return df.join_asof(other, on="datetime", by="ticker").to_native()

            We can now pass either pandas or Polars to the function:

            >>> agnostic_join_asof_datetime_by_ticker(trades_pd, quotes_pd)
                                datetime ticker   price  quantity     bid     ask
            0 2016-05-25 13:30:00.000023   MSFT   51.95        75   51.95   51.96
            1 2016-05-25 13:30:00.000038   MSFT   51.95       155   51.97   51.98
            2 2016-05-25 13:30:00.000048   GOOG  720.77       100  720.50  720.93
            3 2016-05-25 13:30:00.000048   GOOG  720.92       100  720.50  720.93
            4 2016-05-25 13:30:00.000048   AAPL   98.00       100     NaN     NaN

            >>> agnostic_join_asof_datetime_by_ticker(trades_pl, quotes_pl)
            shape: (5, 6)
            ┌────────────────────────────┬────────┬────────┬──────────┬───────┬────────┐
            │ datetime                   ┆ ticker ┆ price  ┆ quantity ┆ bid   ┆ ask    │
            │ ---                        ┆ ---    ┆ ---    ┆ ---      ┆ ---   ┆ ---    │
            │ datetime[μs]               ┆ str    ┆ f64    ┆ i64      ┆ f64   ┆ f64    │
            ╞════════════════════════════╪════════╪════════╪══════════╪═══════╪════════╡
            │ 2016-05-25 13:30:00.000023 ┆ MSFT   ┆ 51.95  ┆ 75       ┆ 51.95 ┆ 51.96  │
            │ 2016-05-25 13:30:00.000038 ┆ MSFT   ┆ 51.95  ┆ 155      ┆ 51.97 ┆ 51.98  │
            │ 2016-05-25 13:30:00.000048 ┆ GOOG   ┆ 720.77 ┆ 100      ┆ 720.5 ┆ 720.93 │
            │ 2016-05-25 13:30:00.000048 ┆ GOOG   ┆ 720.92 ┆ 100      ┆ 720.5 ┆ 720.93 │
            │ 2016-05-25 13:30:00.000048 ┆ AAPL   ┆ 98.0   ┆ 100      ┆ null  ┆ null   │
            └────────────────────────────┴────────┴────────┴──────────┴───────┴────────┘
        """
        return super().join_asof(
            other,
            left_on=left_on,
            right_on=right_on,
            on=on,
            by_left=by_left,
            by_right=by_right,
            by=by,
            strategy=strategy,
        )

    # --- descriptive ---
    def is_duplicated(self: Self) -> Series[Any]:
        r"""Get a mask of all duplicated rows in this DataFrame.

        Returns:
            A new Series.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> from narwhals.typing import IntoSeries
            >>> data = {
            ...     "a": [1, 2, 3, 1],
            ...     "b": ["x", "y", "z", "x"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_is_duplicated(df_native: IntoDataFrame) -> IntoSeries:
            ...     df = nw.from_native(df_native, eager_only=True)
            ...     return df.is_duplicated().to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_is_duplicated`:

            >>> agnostic_is_duplicated(df_pd)
            0     True
            1    False
            2    False
            3     True
            dtype: bool

            >>> agnostic_is_duplicated(df_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (4,)
            Series: '' [bool]
            [
                true
                false
                false
                true
            ]
            >>> agnostic_is_duplicated(df_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                true,
                false,
                false,
                true
              ]
            ]
        """
        return self._series(
            self._compliant_frame.is_duplicated(),
            level=self._level,
        )

    def is_empty(self: Self) -> bool:
        r"""Check if the dataframe is empty.

        Returns:
            A boolean indicating whether the dataframe is empty (True) or not (False).

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame

            Let's define a dataframe-agnostic function that filters rows in which "foo"
            values are greater than 10, and then checks if the result is empty or not:

            >>> def agnostic_is_empty(df_native: IntoDataFrame) -> bool:
            ...     df = nw.from_native(df_native, eager_only=True)
            ...     return df.filter(nw.col("foo") > 10).is_empty()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_is_empty`:

            >>> data = {"foo": [1, 2, 3], "bar": [4, 5, 6]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)
            >>> agnostic_is_empty(df_pd), agnostic_is_empty(df_pl), agnostic_is_empty(df_pa)
            (True, True, True)

            >>> data = {"foo": [100, 2, 3], "bar": [4, 5, 6]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)
            >>> agnostic_is_empty(df_pd), agnostic_is_empty(df_pl), agnostic_is_empty(df_pa)
            (False, False, False)
        """
        return self._compliant_frame.is_empty()  # type: ignore[no-any-return]

    def is_unique(self: Self) -> Series[Any]:
        r"""Get a mask of all unique rows in this DataFrame.

        Returns:
            A new Series.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> from narwhals.typing import IntoSeries
            >>> data = {
            ...     "a": [1, 2, 3, 1],
            ...     "b": ["x", "y", "z", "x"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_is_unique(df_native: IntoDataFrame) -> IntoSeries:
            ...     df = nw.from_native(df_native, eager_only=True)
            ...     return df.is_unique().to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_is_unique`:

            >>> agnostic_is_unique(df_pd)
            0    False
            1     True
            2     True
            3    False
            dtype: bool

            >>> agnostic_is_unique(df_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (4,)
            Series: '' [bool]
            [
                false
                 true
                 true
                false
            ]
            >>> agnostic_is_unique(df_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                false,
                true,
                true,
                false
              ]
            ]
        """
        return self._series(
            self._compliant_frame.is_unique(),
            level=self._level,
        )

    def null_count(self: Self) -> Self:
        r"""Create a new DataFrame that shows the null counts per column.

        Returns:
            A dataframe of shape (1, n_columns).

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
            >>> data = {
            ...     "foo": [1, None, 3],
            ...     "bar": [6, 7, None],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function that returns the null count of
            each columns:

            >>> def agnostic_null_count(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.null_count().to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow to
            `agnostic_null_count`:

            >>> agnostic_null_count(df_pd)
               foo  bar  ham
            0    1    1    0

            >>> agnostic_null_count(df_pl)
            shape: (1, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ u32 ┆ u32 ┆ u32 │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 1   ┆ 0   │
            └─────┴─────┴─────┘

            >>> agnostic_null_count(df_pa)
            pyarrow.Table
            foo: int64
            bar: int64
            ham: int64
            ----
            foo: [[1]]
            bar: [[1]]
            ham: [[0]]
        """
        return self._from_compliant_dataframe(self._compliant_frame.null_count())

    def item(self: Self, row: int | None = None, column: int | str | None = None) -> Any:
        r"""Return the DataFrame as a scalar, or return the element at the given row/column.

        Arguments:
            row: The *n*-th row.
            column: The column selected via an integer or a string (column name).

        Returns:
            A scalar or the specified element in the dataframe.

        Notes:
            If row/col not provided, this is equivalent to df[0,0], with a check that the shape is (1,1).
            With row/col, this is equivalent to df[row,col].

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> data = {"a": [1, 2, 3], "b": [4, 5, 6]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function that returns item at given row/column

            >>> def agnostic_item(
            ...     df_native: IntoDataFrame, row: int | None, column: int | str | None
            ... ):
            ...     df = nw.from_native(df_native, eager_only=True)
            ...     return df.item(row, column)

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_item`:

            >>> agnostic_item(df_pd, 1, 1), agnostic_item(df_pd, 2, "b")
            (np.int64(5), np.int64(6))
            >>> agnostic_item(df_pl, 1, 1), agnostic_item(df_pl, 2, "b")
            (5, 6)
            >>> agnostic_item(df_pa, 1, 1), agnostic_item(df_pa, 2, "b")
            (5, 6)
        """
        return self._compliant_frame.item(row=row, column=column)

    def clone(self) -> Self:
        r"""Create a copy of this DataFrame.

        Returns:
            An identical copy of the original dataframe.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {"a": [1, 2], "b": [3, 4]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)

            Let's define a dataframe-agnostic function in which we clone the DataFrame:

            >>> def agnostic_clone(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.clone().to_native()

            We can then pass any supported library such as Pandas or Polars
            to `agnostic_clone`:

            >>> agnostic_clone(df_pd)
               a  b
            0  1  3
            1  2  4

            >>> agnostic_clone(df_pl)
            shape: (2, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 3   │
            │ 2   ┆ 4   │
            └─────┴─────┘
        """
        return super().clone()

    def gather_every(self: Self, n: int, offset: int = 0) -> Self:
        r"""Take every nth row in the DataFrame and return as a new DataFrame.

        Arguments:
            n: Gather every *n*-th row.
            offset: Starting index.

        Returns:
            The dataframe containing only the selected rows.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {"a": [1, 2, 3, 4], "b": [5, 6, 7, 8]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function in which gather every 2 rows,
            starting from a offset of 1:

            >>> def agnostic_gather_every(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.gather_every(n=2, offset=1).to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_gather_every`:

            >>> agnostic_gather_every(df_pd)
               a  b
            1  2  6
            3  4  8

            >>> agnostic_gather_every(df_pl)
            shape: (2, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 2   ┆ 6   │
            │ 4   ┆ 8   │
            └─────┴─────┘
            >>> agnostic_gather_every(df_pa)
            pyarrow.Table
            a: int64
            b: int64
            ----
            a: [[2,4]]
            b: [[6,8]]
        """
        return super().gather_every(n=n, offset=offset)

    def pivot(
        self: Self,
        on: str | list[str],
        *,
        index: str | list[str] | None = None,
        values: str | list[str] | None = None,
        aggregate_function: Literal[
            "min", "max", "first", "last", "sum", "mean", "median", "len"
        ]
        | None = None,
        maintain_order: bool | None = None,
        sort_columns: bool = False,
        separator: str = "_",
    ) -> Self:
        r"""Create a spreadsheet-style pivot table as a DataFrame.

        Arguments:
            on: Name of the column(s) whose values will be used as the header of the
                output DataFrame.
            index: One or multiple keys to group by. If None, all remaining columns not
                specified on `on` and `values` will be used. At least one of `index` and
                `values` must be specified.
            values: One or multiple keys to group by. If None, all remaining columns not
                specified on `on` and `index` will be used. At least one of `index` and
                `values` must be specified.
            aggregate_function: Choose from:

                - None: no aggregation takes place, will raise error if multiple values
                    are in group.
                - A predefined aggregate function string, one of
                    {'min', 'max', 'first', 'last', 'sum', 'mean', 'median', 'len'}
            maintain_order: Has no effect and is kept around only for backwards-compatibility.
            sort_columns: Sort the transposed columns by name. Default is by order of
                discovery.
            separator: Used as separator/delimiter in generated column names in case of
                multiple `values` columns.

        Returns:
            A new dataframe.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrameT
            >>> data = {
            ...     "ix": [1, 1, 2, 2, 1, 2],
            ...     "col": ["a", "a", "a", "a", "b", "b"],
            ...     "foo": [0, 1, 2, 2, 7, 1],
            ...     "bar": [0, 2, 0, 0, 9, 4],
            ... }
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_pivot(df_native: IntoDataFrameT) -> IntoDataFrameT:
            ...     df = nw.from_native(df_native, eager_only=True)
            ...     return df.pivot("col", index="ix", aggregate_function="sum").to_native()

            We can then pass any supported library such as Pandas or Polars
            to `agnostic_pivot`:

            >>> agnostic_pivot(df_pd)
               ix  foo_a  foo_b  bar_a  bar_b
            0   1      1      7      2      9
            1   2      4      1      0      4
            >>> agnostic_pivot(df_pl)
            shape: (2, 5)
            ┌─────┬───────┬───────┬───────┬───────┐
            │ ix  ┆ foo_a ┆ foo_b ┆ bar_a ┆ bar_b │
            │ --- ┆ ---   ┆ ---   ┆ ---   ┆ ---   │
            │ i64 ┆ i64   ┆ i64   ┆ i64   ┆ i64   │
            ╞═════╪═══════╪═══════╪═══════╪═══════╡
            │ 1   ┆ 1     ┆ 7     ┆ 2     ┆ 9     │
            │ 2   ┆ 4     ┆ 1     ┆ 0     ┆ 4     │
            └─────┴───────┴───────┴───────┴───────┘
        """
        if values is None and index is None:
            msg = "At least one of `values` and `index` must be passed"
            raise ValueError(msg)
        if maintain_order is not None:
            msg = (
                "`maintain_order` has no effect and is only kept around for backwards-compatibility. "
                "You can safely remove this argument."
            )
            warn(message=msg, category=UserWarning, stacklevel=find_stacklevel())

        return self._from_compliant_dataframe(
            self._compliant_frame.pivot(
                on=on,
                index=index,
                values=values,
                aggregate_function=aggregate_function,
                sort_columns=sort_columns,
                separator=separator,
            )
        )

    def to_arrow(self: Self) -> pa.Table:
        r"""Convert to arrow table.

        Returns:
            A new PyArrow table.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrame
            >>> data = {"foo": [1, 2, 3], "bar": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            Let's define a dataframe-agnostic function that converts to arrow table:

            >>> def agnostic_to_arrow(df_native: IntoDataFrame) -> pa.Table:
            ...     df = nw.from_native(df_native, eager_only=True)
            ...     return df.to_arrow()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_to_arrow`:

            >>> agnostic_to_arrow(df_pd)
            pyarrow.Table
            foo: int64
            bar: string
            ----
            foo: [[1,2,3]]
            bar: [["a","b","c"]]

            >>> agnostic_to_arrow(df_pl)
            pyarrow.Table
            foo: int64
            bar: large_string
            ----
            foo: [[1,2,3]]
            bar: [["a","b","c"]]

            >>> agnostic_to_arrow(df_pa)
            pyarrow.Table
            foo: int64
            bar: string
            ----
            foo: [[1,2,3]]
            bar: [["a","b","c"]]
        """
        return self._compliant_frame.to_arrow()

    def sample(
        self: Self,
        n: int | None = None,
        *,
        fraction: float | None = None,
        with_replacement: bool = False,
        seed: int | None = None,
    ) -> Self:
        r"""Sample from this DataFrame.

        Arguments:
            n: Number of items to return. Cannot be used with fraction.
            fraction: Fraction of items to return. Cannot be used with n.
            with_replacement: Allow values to be sampled more than once.
            seed: Seed for the random number generator. If set to None (default), a random
                seed is generated for each sample operation.

        Returns:
            A new dataframe.

        Notes:
            The results may not be consistent across libraries.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoDataFrameT
            >>> data = {"a": [1, 2, 3, 4], "b": ["x", "y", "x", "y"]}
            >>> df_pd = pd.DataFrame(data)
            >>> df_pl = pl.DataFrame(data)
            >>> df_pa = pa.table(data)

            We define a library agnostic function:

            >>> def agnostic_sample(df_native: IntoDataFrameT) -> IntoDataFrameT:
            ...     df = nw.from_native(df_native, eager_only=True)
            ...     return df.sample(n=2, seed=123).to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_sample`:

            >>> agnostic_sample(df_pd)
               a  b
            3  4  y
            0  1  x
            >>> agnostic_sample(df_pl)
            shape: (2, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ str │
            ╞═════╪═════╡
            │ 2   ┆ y   │
            │ 3   ┆ x   │
            └─────┴─────┘
            >>> agnostic_sample(df_pa)
            pyarrow.Table
            a: int64
            b: string
            ----
            a: [[1,3]]
            b: [["x","x"]]

            As you can see, by using the same seed, the result will be consistent within
            the same backend, but not necessarely across different backends.
        """
        return self._from_compliant_dataframe(
            self._compliant_frame.sample(
                n=n, fraction=fraction, with_replacement=with_replacement, seed=seed
            )
        )

    def unpivot(
        self: Self,
        on: str | list[str] | None = None,
        *,
        index: str | list[str] | None = None,
        variable_name: str | None = None,
        value_name: str | None = None,
    ) -> Self:
        r"""Unpivot a DataFrame from wide to long format.

        Optionally leaves identifiers set.

        This function is useful to massage a DataFrame into a format where one or more
        columns are identifier variables (index) while all other columns, considered
        measured variables (on), are "unpivoted" to the row axis leaving just
        two non-identifier columns, 'variable' and 'value'.

        Arguments:
            on: Column(s) to use as values variables; if `on` is empty all columns that
                are not in `index` will be used.
            index: Column(s) to use as identifier variables.
            variable_name: Name to give to the `variable` column. Defaults to "variable".
            value_name: Name to give to the `value` column. Defaults to "value".

        Returns:
            The unpivoted dataframe.

        Notes:
            If you're coming from pandas, this is similar to `pandas.DataFrame.melt`,
            but with `index` replacing `id_vars` and `on` replacing `value_vars`.
            In other frameworks, you might know this operation as `pivot_longer`.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {
            ...     "a": ["x", "y", "z"],
            ...     "b": [1, 3, 5],
            ...     "c": [2, 4, 6],
            ... }

            We define a library agnostic function:

            >>> def agnostic_unpivot(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.unpivot(on=["b", "c"], index="a").to_native()

            We can then pass any supported library such as Pandas, Polars, or PyArrow
            to `agnostic_unpivot`:

            >>> agnostic_unpivot(pl.DataFrame(data))
            shape: (6, 3)
            ┌─────┬──────────┬───────┐
            │ a   ┆ variable ┆ value │
            │ --- ┆ ---      ┆ ---   │
            │ str ┆ str      ┆ i64   │
            ╞═════╪══════════╪═══════╡
            │ x   ┆ b        ┆ 1     │
            │ y   ┆ b        ┆ 3     │
            │ z   ┆ b        ┆ 5     │
            │ x   ┆ c        ┆ 2     │
            │ y   ┆ c        ┆ 4     │
            │ z   ┆ c        ┆ 6     │
            └─────┴──────────┴───────┘

            >>> agnostic_unpivot(pd.DataFrame(data))
               a variable  value
            0  x        b      1
            1  y        b      3
            2  z        b      5
            3  x        c      2
            4  y        c      4
            5  z        c      6

            >>> agnostic_unpivot(pa.table(data))
            pyarrow.Table
            a: string
            variable: string
            value: int64
            ----
            a: [["x","y","z"],["x","y","z"]]
            variable: [["b","b","b"],["c","c","c"]]
            value: [[1,3,5],[2,4,6]]
        """
        return super().unpivot(
            on=on, index=index, variable_name=variable_name, value_name=value_name
        )

    def explode(self: Self, columns: str | Sequence[str], *more_columns: str) -> Self:
        """Explode the dataframe to long format by exploding the given columns.

        Notes:
            It is possible to explode multiple columns only if these columns must have
            matching element counts.

        Arguments:
            columns: Column names. The underlying columns being exploded must be of the `List` data type.
            *more_columns: Additional names of columns to explode, specified as positional arguments.

        Returns:
            New DataFrame

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> data = {
            ...     "a": ["x", "y", "z", "w"],
            ...     "lst1": [[1, 2], None, [None], []],
            ...     "lst2": [[3, None], None, [42], []],
            ... }

            We define a library agnostic function:

            >>> def agnostic_explode(df_native: IntoFrameT) -> IntoFrameT:
            ...     return (
            ...         nw.from_native(df_native)
            ...         .with_columns(nw.col("lst1", "lst2").cast(nw.List(nw.Int32())))
            ...         .explode("lst1", "lst2")
            ...         .to_native()
            ...     )

            We can then pass any supported library such as pandas, Polars (eager),
            or PyArrow to `agnostic_explode`:

            >>> agnostic_explode(pd.DataFrame(data))
               a  lst1  lst2
            0  x     1     3
            0  x     2  <NA>
            1  y  <NA>  <NA>
            2  z  <NA>    42
            3  w  <NA>  <NA>
            >>> agnostic_explode(pl.DataFrame(data))
            shape: (5, 3)
            ┌─────┬──────┬──────┐
            │ a   ┆ lst1 ┆ lst2 │
            │ --- ┆ ---  ┆ ---  │
            │ str ┆ i32  ┆ i32  │
            ╞═════╪══════╪══════╡
            │ x   ┆ 1    ┆ 3    │
            │ x   ┆ 2    ┆ null │
            │ y   ┆ null ┆ null │
            │ z   ┆ null ┆ 42   │
            │ w   ┆ null ┆ null │
            └─────┴──────┴──────┘
        """
        return super().explode(columns, *more_columns)


class LazyFrame(BaseFrame[FrameT]):
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

    def __init__(
        self,
        df: Any,
        *,
        level: Literal["full", "lazy", "interchange"],
    ) -> None:
        self._level = level
        if hasattr(df, "__narwhals_lazyframe__"):
            self._compliant_frame: Any = df.__narwhals_lazyframe__()
        else:  # pragma: no cover
            msg = f"Expected Polars LazyFrame or an object that implements `__narwhals_lazyframe__`, got: {type(df)}"
            raise AssertionError(msg)

    def __repr__(self) -> str:  # pragma: no cover
        return generate_repr("Narwhals LazyFrame", self.to_native().__repr__())

    @property
    def implementation(self) -> Implementation:
        """Return implementation of native frame.

        This can be useful when you need to use special-casing for features outside of
        Narwhals' scope - for example, when dealing with pandas' Period Dtype.

        Returns:
            Implementation.

        Examples:
            >>> import narwhals as nw
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> lf_pl = pl.LazyFrame({"a": [1, 2, 3]})
            >>> lf_dask = dd.from_dict({"a": [1, 2, 3]}, npartitions=2)

            >>> lf = nw.from_native(lf_pl)
            >>> lf.implementation
            <Implementation.POLARS: 6>
            >>> lf.implementation.is_pandas()
            False
            >>> lf.implementation.is_polars()
            True

            >>> lf = nw.from_native(lf_dask)
            >>> lf.implementation
            <Implementation.DASK: 7>
            >>> lf.implementation.is_dask()
            True
        """
        return self._compliant_frame._implementation  # type: ignore[no-any-return]

    def __getitem__(self, item: str | slice) -> NoReturn:
        msg = "Slicing is not supported on LazyFrame"
        raise TypeError(msg)

    def collect(self) -> DataFrame[Any]:
        r"""Materialize this LazyFrame into a DataFrame.

        Returns:
            DataFrame

        Examples:
            >>> import narwhals as nw
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> data = {
            ...     "a": ["a", "b", "a", "b", "b", "c"],
            ...     "b": [1, 2, 3, 4, 5, 6],
            ...     "c": [6, 5, 4, 3, 2, 1],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            >>> lf = nw.from_native(lf_pl)
            >>> lf  # doctest:+ELLIPSIS
            ┌─────────────────────────────┐
            |     Narwhals LazyFrame      |
            |-----------------------------|
            |<LazyFrame at ...
            └─────────────────────────────┘
            >>> df = lf.group_by("a").agg(nw.all().sum()).collect()
            >>> df.to_native().sort("a")
            shape: (3, 3)
            ┌─────┬─────┬─────┐
            │ a   ┆ b   ┆ c   │
            │ --- ┆ --- ┆ --- │
            │ str ┆ i64 ┆ i64 │
            ╞═════╪═════╪═════╡
            │ a   ┆ 4   ┆ 10  │
            │ b   ┆ 11  ┆ 10  │
            │ c   ┆ 6   ┆ 1   │
            └─────┴─────┴─────┘

            >>> lf = nw.from_native(lf_dask)
            >>> lf
            ┌───────────────────────────────────┐
            |        Narwhals LazyFrame         |
            |-----------------------------------|
            |Dask DataFrame Structure:          |
            |                    a      b      c|
            |npartitions=2                      |
            |0              string  int64  int64|
            |3                 ...    ...    ...|
            |5                 ...    ...    ...|
            |Dask Name: frompandas, 1 expression|
            |Expr=df                            |
            └───────────────────────────────────┘
            >>> df = lf.group_by("a").agg(nw.col("b", "c").sum()).collect()
            >>> df.to_native()
               a   b   c
            0  a   4  10
            1  b  11  10
            2  c   6   1
        """
        return self._dataframe(
            self._compliant_frame.collect(),
            level="full",
        )

    def to_native(self) -> FrameT:
        """Convert Narwhals LazyFrame to native one.

        Returns:
            Object of class that user started with.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>>
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Calling `to_native` on a Narwhals LazyFrame returns the native object:

            >>> nw.from_native(lf_pl).to_native().collect()
            shape: (3, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ f64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 6.0 ┆ a   │
            │ 2   ┆ 7.0 ┆ b   │
            │ 3   ┆ 8.0 ┆ c   │
            └─────┴─────┴─────┘
            >>> nw.from_native(lf_dask).to_native().compute()
               foo  bar ham
            0    1  6.0   a
            1    2  7.0   b
            2    3  8.0   c
        """
        return to_native(narwhals_object=self, pass_through=False)

    # inherited
    def pipe(self, function: Callable[[Any], Self], *args: Any, **kwargs: Any) -> Self:
        """Pipe function call.

        Arguments:
            function: Function to apply.
            args: Positional arguments to pass to function.
            kwargs: Keyword arguments to pass to function.

        Returns:
            The original object with the function applied.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3], "ba": [4, 5, 6]}
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_pipe(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.pipe(lambda _df: _df.select("a")).collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_pipe`:

            >>> agnostic_pipe(lf_pl)
            shape: (3, 1)
            ┌─────┐
            │ a   │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 1   │
            │ 2   │
            │ 3   │
            └─────┘
            >>> agnostic_pipe(lf_dask)
               a
            0  1
            1  2
            2  3
        """
        return super().pipe(function, *args, **kwargs)

    def drop_nulls(self: Self, subset: str | list[str] | None = None) -> Self:
        """Drop rows that contain null values.

        Arguments:
            subset: Column name(s) for which null values are considered. If set to None
                (default), use all columns.

        Returns:
            The original object with the rows removed that contained the null values.

        Notes:
            pandas handles null values differently from Polars and PyArrow.
            See [null_handling](../pandas_like_concepts/null_handling.md/)
            for reference.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1.0, 2.0, None], "ba": [1.0, None, 2.0]}
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_drop_nulls(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.drop_nulls().collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_drop_nulls`:

            >>> agnostic_drop_nulls(lf_pl)
            shape: (1, 2)
            ┌─────┬─────┐
            │ a   ┆ ba  │
            │ --- ┆ --- │
            │ f64 ┆ f64 │
            ╞═════╪═════╡
            │ 1.0 ┆ 1.0 │
            └─────┴─────┘
            >>> agnostic_drop_nulls(lf_dask)
                 a   ba
            0  1.0  1.0
        """
        return super().drop_nulls(subset=subset)

    def with_row_index(self, name: str = "index") -> Self:
        """Insert column which enumerates rows.

        Arguments:
            name: The name of the column as a string. The default is "index".

        Returns:
            The original object with the column added.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3], "b": [4, 5, 6]}
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Let's define a dataframe-agnostic function:

            >>> def agnostic_with_row_index(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.with_row_index().collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_with_row_index`:

            >>> agnostic_with_row_index(lf_pl)
            shape: (3, 3)
            ┌───────┬─────┬─────┐
            │ index ┆ a   ┆ b   │
            │ ---   ┆ --- ┆ --- │
            │ u32   ┆ i64 ┆ i64 │
            ╞═══════╪═════╪═════╡
            │ 0     ┆ 1   ┆ 4   │
            │ 1     ┆ 2   ┆ 5   │
            │ 2     ┆ 3   ┆ 6   │
            └───────┴─────┴─────┘
            >>> agnostic_with_row_index(lf_dask)
               index  a  b
            0      0  1  4
            1      1  2  5
            2      2  3  6
        """
        return super().with_row_index(name)

    @property
    def schema(self) -> Schema:
        r"""Get an ordered mapping of column names to their data type.

        Returns:
            A Narwhals Schema object that displays the mapping of column names.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6.0, 7.0, 8.0],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            >>> lf = nw.from_native(lf_pl)
            >>> lf.schema  # doctest: +SKIP
            Schema({'foo': Int64, 'bar': Float64, 'ham': String})

            >>> lf = nw.from_native(lf_dask)
            >>> lf.schema  # doctest: +SKIP
            Schema({'foo': Int64, 'bar': Float64, 'ham': String})
        """
        return super().schema

    def collect_schema(self: Self) -> Schema:
        r"""Get an ordered mapping of column names to their data type.

        Returns:
            A Narwhals Schema object that displays the mapping of column names.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6.0, 7.0, 8.0],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            >>> lf = nw.from_native(lf_pl)
            >>> lf.collect_schema()
            Schema({'foo': Int64, 'bar': Float64, 'ham': String})

            >>> lf = nw.from_native(lf_dask)
            >>> lf.collect_schema()
            Schema({'foo': Int64, 'bar': Float64, 'ham': String})
        """
        return super().collect_schema()

    @property
    def columns(self) -> list[str]:
        r"""Get column names.

        Returns:
            The column names stored in a list.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrame
            >>>
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            We define a library agnostic function:

            >>> def agnostic_columns(df_native: IntoFrame) -> list[str]:
            ...     df = nw.from_native(df_native)
            ...     return df.columns

            We can then pass any supported library such as Polars or Dask to `agnostic_columns`:

            >>> agnostic_columns(lf_pl)  # doctest: +SKIP
            ['foo', 'bar', 'ham']
            >>> agnostic_columns(lf_dask)
            ['foo', 'bar', 'ham']
        """
        return super().columns

    def with_columns(
        self, *exprs: IntoExpr | Iterable[IntoExpr], **named_exprs: IntoExpr
    ) -> Self:
        r"""Add columns to this LazyFrame.

        Added columns will replace existing columns with the same name.

        Arguments:
            *exprs: Column(s) to add, specified as positional arguments.
                     Accepts expression input. Strings are parsed as column names, other
                     non-expression inputs are parsed as literals.

            **named_exprs: Additional columns to add, specified as keyword arguments.
                            The columns will be renamed to the keyword used.

        Returns:
            LazyFrame: A new LazyFrame with the columns added.

        Note:
            Creating a new LazyFrame using this method does not create a new copy of
            existing data.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "a": [1, 2, 3, 4],
            ...     "b": [0.5, 4, 10, 13],
            ...     "c": [True, True, False, True],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Let's define a dataframe-agnostic function in which we pass an expression
            to add it as a new column:

            >>> def agnostic_with_columns(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return (
            ...         df.with_columns((nw.col("a") * 2).alias("2a")).collect().to_native()
            ...     )

            We can then pass any supported library such as Polars or Dask to `agnostic_with_columns`:

            >>> agnostic_with_columns(lf_pl)
            shape: (4, 4)
            ┌─────┬──────┬───────┬─────┐
            │ a   ┆ b    ┆ c     ┆ 2a  │
            │ --- ┆ ---  ┆ ---   ┆ --- │
            │ i64 ┆ f64  ┆ bool  ┆ i64 │
            ╞═════╪══════╪═══════╪═════╡
            │ 1   ┆ 0.5  ┆ true  ┆ 2   │
            │ 2   ┆ 4.0  ┆ true  ┆ 4   │
            │ 3   ┆ 10.0 ┆ false ┆ 6   │
            │ 4   ┆ 13.0 ┆ true  ┆ 8   │
            └─────┴──────┴───────┴─────┘
            >>> agnostic_with_columns(lf_dask)
               a     b      c  2a
            0  1   0.5   True   2
            1  2   4.0   True   4
            2  3  10.0  False   6
            3  4  13.0   True   8
        """
        return super().with_columns(*exprs, **named_exprs)

    def select(
        self,
        *exprs: IntoExpr | Iterable[IntoExpr],
        **named_exprs: IntoExpr,
    ) -> Self:
        r"""Select columns from this LazyFrame.

        Arguments:
            *exprs: Column(s) to select, specified as positional arguments.
                Accepts expression input. Strings are parsed as column names.
            **named_exprs: Additional columns to select, specified as keyword arguments.
                The columns will be renamed to the keyword used.

        Returns:
            The LazyFrame containing only the selected columns.

        Notes:
            If you'd like to select a column whose name isn't a string (for example,
            if you're working with pandas) then you should explicitly use `nw.col` instead
            of just passing the column name. For example, to select a column named
            `0` use `df.select(nw.col(0))`, not `df.select(0)`.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6, 7, 8],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Let's define a dataframe-agnostic function in which we pass the name of a
            column to select that column.

            >>> def agnostic_select(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select("foo").collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_select`:

            >>> agnostic_select(lf_pl)
            shape: (3, 1)
            ┌─────┐
            │ foo │
            │ --- │
            │ i64 │
            ╞═════╡
            │ 1   │
            │ 2   │
            │ 3   │
            └─────┘
            >>> agnostic_select(lf_dask)
               foo
            0    1
            1    2
            2    3

            Multiple columns can be selected by passing a list of column names.

            >>> def agnostic_select(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(["foo", "bar"]).collect().to_native()

            >>> agnostic_select(lf_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ foo ┆ bar │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 6   │
            │ 2   ┆ 7   │
            │ 3   ┆ 8   │
            └─────┴─────┘
            >>> agnostic_select(lf_dask)
               foo  bar
            0    1    6
            1    2    7
            2    3    8

            Multiple columns can also be selected using positional arguments instead of a
            list. Expressions are also accepted.

            >>> def agnostic_select(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(nw.col("foo"), nw.col("bar") + 1).collect().to_native()

            >>> agnostic_select(lf_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ foo ┆ bar │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 7   │
            │ 2   ┆ 8   │
            │ 3   ┆ 9   │
            └─────┴─────┘
            >>> agnostic_select(lf_dask)
               foo  bar
            0    1    7
            1    2    8
            2    3    9

            Use keyword arguments to easily name your expression inputs.

            >>> def agnostic_select(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.select(threshold=nw.col("foo") * 2).collect().to_native()

            >>> agnostic_select(lf_pl)
            shape: (3, 1)
            ┌───────────┐
            │ threshold │
            │ ---       │
            │ i64       │
            ╞═══════════╡
            │ 2         │
            │ 4         │
            │ 6         │
            └───────────┘
            >>> agnostic_select(lf_dask)
               threshold
            0          2
            1          4
            2          6
        """
        return super().select(*exprs, **named_exprs)

    def rename(self, mapping: dict[str, str]) -> Self:
        r"""Rename column names.

        Arguments:
            mapping: Key value pairs that map from old name to new name, or a
                      function that takes the old name as input and returns the
                      new name.

        Returns:
            The LazyFrame with the specified columns renamed.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"foo": [1, 2, 3], "bar": [6, 7, 8], "ham": ["a", "b", "c"]}
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            We define a library agnostic function:

            >>> def agnostic_rename(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.rename({"foo": "apple"}).collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_rename`:

            >>> agnostic_rename(lf_pl)
            shape: (3, 3)
            ┌───────┬─────┬─────┐
            │ apple ┆ bar ┆ ham │
            │ ---   ┆ --- ┆ --- │
            │ i64   ┆ i64 ┆ str │
            ╞═══════╪═════╪═════╡
            │ 1     ┆ 6   ┆ a   │
            │ 2     ┆ 7   ┆ b   │
            │ 3     ┆ 8   ┆ c   │
            └───────┴─────┴─────┘
            >>> agnostic_rename(lf_dask)
               apple  bar ham
            0      1    6   a
            1      2    7   b
            2      3    8   c
        """
        return super().rename(mapping)

    def head(self, n: int = 5) -> Self:
        r"""Get the first `n` rows.

        Arguments:
            n: Number of rows to return.

        Returns:
            A subset of the LazyFrame of shape (n, n_columns).

        Examples:
            >>> import narwhals as nw
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "a": [1, 2, 3, 4, 5, 6],
            ...     "b": [7, 8, 9, 10, 11, 12],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Let's define a dataframe-agnostic function that gets the first 3 rows.

            >>> def agnostic_head(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.head(3).collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_head`:

            >>> agnostic_head(lf_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 7   │
            │ 2   ┆ 8   │
            │ 3   ┆ 9   │
            └─────┴─────┘
            >>> agnostic_head(lf_dask)
               a  b
            0  1  7
            1  2  8
            2  3  9
        """
        return super().head(n)

    def tail(self, n: int = 5) -> Self:
        r"""Get the last `n` rows.

        Arguments:
            n: Number of rows to return.

        Returns:
            A subset of the LazyFrame of shape (n, n_columns).

        Notes:
            `LazyFrame.tail` is not supported for the Dask backend with multiple
            partitions.

        Examples:
            >>> import narwhals as nw
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "a": [1, 2, 3, 4, 5, 6],
            ...     "b": [7, 8, 9, 10, 11, 12],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=1)

            Let's define a dataframe-agnostic function that gets the last 3 rows.

            >>> def agnostic_tail(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.tail(3).collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_tail`:

            >>> agnostic_tail(lf_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 4   ┆ 10  │
            │ 5   ┆ 11  │
            │ 6   ┆ 12  │
            └─────┴─────┘
            >>> agnostic_tail(lf_dask)
               a   b
            3  4  10
            4  5  11
            5  6  12
        """
        return super().tail(n)

    def drop(self, *columns: str | Iterable[str], strict: bool = True) -> Self:
        r"""Remove columns from the LazyFrame.

        Arguments:
            *columns: Names of the columns that should be removed from the dataframe.
            strict: Validate that all column names exist in the schema and throw an
                exception if a column name does not exist in the schema.

        Returns:
            The LazyFrame with the specified columns removed.

        Warning:
            `strict` argument is ignored for `polars<1.0.0`.

            Please consider upgrading to a newer version or pass to eager mode.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            We define a library agnostic function:

            >>> def agnostic_drop(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.drop("ham").collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_drop`:

            >>> agnostic_drop(lf_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ foo ┆ bar │
            │ --- ┆ --- │
            │ i64 ┆ f64 │
            ╞═════╪═════╡
            │ 1   ┆ 6.0 │
            │ 2   ┆ 7.0 │
            │ 3   ┆ 8.0 │
            └─────┴─────┘
            >>> agnostic_drop(lf_dask)
               foo  bar
            0    1  6.0
            1    2  7.0
            2    3  8.0

            Use positional arguments to drop multiple columns.

            >>> def agnostic_drop(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.drop("foo", "ham").collect().to_native()

            >>> agnostic_drop(lf_pl)
            shape: (3, 1)
            ┌─────┐
            │ bar │
            │ --- │
            │ f64 │
            ╞═════╡
            │ 6.0 │
            │ 7.0 │
            │ 8.0 │
            └─────┘
            >>> agnostic_drop(lf_dask)
               bar
            0  6.0
            1  7.0
            2  8.0
        """
        return super().drop(*flatten(columns), strict=strict)

    def unique(
        self,
        subset: str | list[str] | None = None,
        *,
        keep: Literal["any", "none"] = "any",
        maintain_order: bool | None = None,
    ) -> Self:
        """Drop duplicate rows from this LazyFrame.

        Arguments:
            subset: Column name(s) to consider when identifying duplicate rows.
                     If set to `None`, use all columns.
            keep: {'first', 'none'}
                Which of the duplicate rows to keep.

                * 'any': Does not give any guarantee of which row is kept.
                        This allows more optimizations.
                * 'none': Don't keep duplicate rows.
            maintain_order: Has no effect and is kept around only for backwards-compatibility.

        Returns:
            The LazyFrame with unique rows.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "foo": [1, 2, 3, 1],
            ...     "bar": ["a", "a", "a", "a"],
            ...     "ham": ["b", "b", "b", "b"],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            We define a library agnostic function:

            >>> def agnostic_unique(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.unique(["bar", "ham"]).collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_unique`:

            >>> agnostic_unique(lf_pl)
            shape: (1, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ str ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ a   ┆ b   │
            └─────┴─────┴─────┘
            >>> agnostic_unique(lf_dask)
               foo bar ham
            0    1   a   b
        """
        if keep not in {"any", "none"}:
            msg = (
                "narwhals.LazyFrame makes no assumptions about row order, so only "
                f"'any' and 'none' are supported for `keep` in `unique`. Got: {keep}."
            )
            raise ValueError(msg)
        if maintain_order:
            msg = "`maintain_order=True` is not supported for LazyFrame.unique."
            raise ValueError(msg)
        if maintain_order is not None:
            msg = (
                "`maintain_order` has no effect and is only kept around for backwards-compatibility. "
                "You can safely remove this argument."
            )
            warn(message=msg, category=UserWarning, stacklevel=find_stacklevel())
        if isinstance(subset, str):
            subset = [subset]
        return self._from_compliant_dataframe(
            self._compliant_frame.unique(subset=subset, keep=keep)
        )

    def filter(
        self, *predicates: IntoExpr | Iterable[IntoExpr] | list[bool], **constraints: Any
    ) -> Self:
        r"""Filter the rows in the LazyFrame based on a predicate expression.

        The original order of the remaining rows is preserved.

        Arguments:
            *predicates: Expression that evaluates to a boolean Series. Can
                also be a (single!) boolean list.
            **constraints: Column filters; use `name = value` to filter columns by the supplied value.
                Each constraint will behave the same as `nw.col(name).eq(value)`, and will be implicitly
                joined with the other filter conditions using &.

        Returns:
            The filtered LazyFrame.

        Examples:
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6, 7, 8],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Let's define a dataframe-agnostic function in which we filter on
            one condition.

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.filter(nw.col("foo") > 1).collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_filter`:

            >>> agnostic_filter(lf_pl)
            shape: (2, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 2   ┆ 7   ┆ b   │
            │ 3   ┆ 8   ┆ c   │
            └─────┴─────┴─────┘
            >>> agnostic_filter(lf_dask)
               foo  bar ham
            1    2    7   b
            2    3    8   c

            Filter on multiple conditions:

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return (
            ...         df.filter((nw.col("foo") < 3) & (nw.col("ham") == "a"))
            ...         .collect()
            ...         .to_native()
            ...     )

            >>> agnostic_filter(lf_pl)
            shape: (1, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 6   ┆ a   │
            └─────┴─────┴─────┘
            >>> agnostic_filter(lf_dask)
               foo  bar ham
            0    1    6   a

            Provide multiple filters using `*args` syntax:

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return (
            ...         df.filter(
            ...             nw.col("foo") == 1,
            ...             nw.col("ham") == "a",
            ...         )
            ...         .collect()
            ...         .to_native()
            ...     )

            >>> agnostic_filter(lf_pl)
            shape: (1, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 6   ┆ a   │
            └─────┴─────┴─────┘
            >>> agnostic_filter(lf_dask)
               foo  bar ham
            0    1    6   a

            Filter on an OR condition:

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return (
            ...         df.filter((nw.col("foo") == 1) | (nw.col("ham") == "c"))
            ...         .collect()
            ...         .to_native()
            ...     )

            >>> agnostic_filter(lf_pl)
            shape: (2, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 1   ┆ 6   ┆ a   │
            │ 3   ┆ 8   ┆ c   │
            └─────┴─────┴─────┘
            >>> agnostic_filter(lf_dask)
               foo  bar ham
            0    1    6   a
            2    3    8   c

            Provide multiple filters using `**kwargs` syntax:

            >>> def agnostic_filter(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.filter(foo=2, ham="b").collect().to_native()

            >>> agnostic_filter(lf_pl)
            shape: (1, 3)
            ┌─────┬─────┬─────┐
            │ foo ┆ bar ┆ ham │
            │ --- ┆ --- ┆ --- │
            │ i64 ┆ i64 ┆ str │
            ╞═════╪═════╪═════╡
            │ 2   ┆ 7   ┆ b   │
            └─────┴─────┴─────┘
            >>> agnostic_filter(lf_dask)
               foo  bar ham
            1    2    7   b
        """
        if (
            len(predicates) == 1
            and isinstance(predicates[0], list)
            and all(isinstance(x, bool) for x in predicates[0])
            and not constraints
        ):  # pragma: no cover
            msg = "`LazyFrame.filter` is not supported with Python boolean masks - use expressions instead."
            raise TypeError(msg)

        return super().filter(*predicates, **constraints)

    def group_by(
        self, *keys: str | Iterable[str], drop_null_keys: bool = False
    ) -> LazyGroupBy[Self]:
        r"""Start a group by operation.

        Arguments:
            *keys:
                Column(s) to group by. Accepts expression input. Strings are
                parsed as column names.
            drop_null_keys: if True, then groups where any key is null won't be
                included in the result.

        Returns:
            Object which can be used to perform aggregations.

        Examples:
            Group by one column and call `agg` to compute the grouped sum of
            another column.

            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "a": ["a", "b", "a", "b", "c"],
            ...     "b": [1, 2, 1, 3, 3],
            ...     "c": [5, 4, 3, 2, 1],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Let's define a dataframe-agnostic function in which we group by one column
            and call `agg` to compute the grouped sum of another column.

            >>> def agnostic_group_by_agg(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return (
            ...         df.group_by("a")
            ...         .agg(nw.col("b").sum())
            ...         .sort("a")
            ...         .collect()
            ...         .to_native()
            ...     )

            We can then pass any supported library such as Polars or Dask to `agnostic_group_by_agg`:

            >>> agnostic_group_by_agg(lf_pl)
            shape: (3, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ str ┆ i64 │
            ╞═════╪═════╡
            │ a   ┆ 2   │
            │ b   ┆ 5   │
            │ c   ┆ 3   │
            └─────┴─────┘
            >>> agnostic_group_by_agg(lf_dask)
               a  b
            0  a  2
            1  b  5
            2  c  3

            Group by multiple columns by passing a list of column names.

            >>> def agnostic_group_by_agg(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return (
            ...         df.group_by(["a", "b"])
            ...         .agg(nw.max("c"))
            ...         .sort(["a", "b"])
            ...         .collect()
            ...         .to_native()
            ...     )

            >>> agnostic_group_by_agg(lf_pl)
            shape: (4, 3)
            ┌─────┬─────┬─────┐
            │ a   ┆ b   ┆ c   │
            │ --- ┆ --- ┆ --- │
            │ str ┆ i64 ┆ i64 │
            ╞═════╪═════╪═════╡
            │ a   ┆ 1   ┆ 5   │
            │ b   ┆ 2   ┆ 4   │
            │ b   ┆ 3   ┆ 2   │
            │ c   ┆ 3   ┆ 1   │
            └─────┴─────┴─────┘
            >>> agnostic_group_by_agg(lf_dask)
               a  b  c
            0  a  1  5
            1  b  2  4
            2  b  3  2
            3  c  3  1
        """
        from narwhals.expr import Expr
        from narwhals.group_by import LazyGroupBy
        from narwhals.series import Series

        flat_keys = flatten(keys)
        if any(isinstance(x, (Expr, Series)) for x in flat_keys):
            msg = (
                "`group_by` with expression or Series keys is not (yet?) supported.\n\n"
                "Hint: instead of `df.group_by(nw.col('a'))`, use `df.group_by('a')`."
            )
            raise NotImplementedError(msg)
        return LazyGroupBy(self, *flat_keys, drop_null_keys=drop_null_keys)

    def sort(
        self,
        by: str | Iterable[str],
        *more_by: str,
        descending: bool | Sequence[bool] = False,
        nulls_last: bool = False,
    ) -> Self:
        r"""Sort the LazyFrame by the given columns.

        Arguments:
            by: Column(s) names to sort by.
            *more_by: Additional columns to sort by, specified as positional arguments.
            descending: Sort in descending order. When sorting by multiple columns, can be
                specified per column by passing a sequence of booleans.
            nulls_last: Place null values last; can specify a single boolean applying to
                all columns or a sequence of booleans for per-column control.

        Returns:
            The sorted LazyFrame.

        Warning:
            Unlike Polars, it is not possible to specify a sequence of booleans for
            `nulls_last` in order to control per-column behaviour. Instead a single
            boolean is applied for all `by` columns.

        Examples:
            >>> import narwhals as nw
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "a": [1, 2, None],
            ...     "b": [6.0, 5.0, 4.0],
            ...     "c": ["a", "c", "b"],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Let's define a dataframe-agnostic function in which we sort by multiple
            columns in different orders

            >>> def agnostic_sort(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.sort("c", "a", descending=[False, True]).collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_sort`:

            >>> agnostic_sort(lf_pl)
            shape: (3, 3)
            ┌──────┬─────┬─────┐
            │ a    ┆ b   ┆ c   │
            │ ---  ┆ --- ┆ --- │
            │ i64  ┆ f64 ┆ str │
            ╞══════╪═════╪═════╡
            │ 1    ┆ 6.0 ┆ a   │
            │ null ┆ 4.0 ┆ b   │
            │ 2    ┆ 5.0 ┆ c   │
            └──────┴─────┴─────┘
            >>> agnostic_sort(lf_dask)
                 a    b  c
            0  1.0  6.0  a
            2  NaN  4.0  b
            1  2.0  5.0  c
        """
        return super().sort(by, *more_by, descending=descending, nulls_last=nulls_last)

    def join(
        self,
        other: Self,
        on: str | list[str] | None = None,
        how: Literal["inner", "left", "cross", "semi", "anti"] = "inner",
        *,
        left_on: str | list[str] | None = None,
        right_on: str | list[str] | None = None,
        suffix: str = "_right",
    ) -> Self:
        r"""Add a join operation to the Logical Plan.

        Arguments:
            other: Lazy DataFrame to join with.
            on: Name(s) of the join columns in both DataFrames. If set, `left_on` and
                `right_on` should be None.
            how: Join strategy.

                  * *inner*: Returns rows that have matching values in both tables.
                  * *left*: Returns all rows from the left table, and the matched rows from the right table.
                  * *cross*: Returns the Cartesian product of rows from both tables.
                  * *semi*: Filter rows that have a match in the right table.
                  * *anti*: Filter rows that do not have a match in the right table.
            left_on: Join column of the left DataFrame.
            right_on: Join column of the right DataFrame.
            suffix: Suffix to append to columns with a duplicate name.

        Returns:
            A new joined LazyFrame.

        Examples:
            >>> import narwhals as nw
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "foo": [1, 2, 3],
            ...     "bar": [6.0, 7.0, 8.0],
            ...     "ham": ["a", "b", "c"],
            ... }
            >>> data_other = {
            ...     "apple": ["x", "y", "z"],
            ...     "ham": ["a", "b", "d"],
            ... }

            >>> lf_pl = pl.LazyFrame(data)
            >>> other_pl = pl.LazyFrame(data_other)
            >>> lf_dask = dd.from_dict(data, npartitions=2)
            >>> other_dask = dd.from_dict(data_other, npartitions=2)

            Let's define a dataframe-agnostic function in which we join over "ham" column:

            >>> def agnostic_join_on_ham(
            ...     df_native: IntoFrameT,
            ...     other_native: IntoFrameT,
            ... ) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     other = nw.from_native(other_native)
            ...     return (
            ...         df.join(other, left_on="ham", right_on="ham")
            ...         .sort("ham")
            ...         .collect()
            ...         .to_native()
            ...     )

            We can then pass any supported library such as Polars or Dask to `agnostic_join_on_ham`:

            >>> agnostic_join_on_ham(lf_pl, other_pl)
            shape: (2, 4)
            ┌─────┬─────┬─────┬───────┐
            │ foo ┆ bar ┆ ham ┆ apple │
            │ --- ┆ --- ┆ --- ┆ ---   │
            │ i64 ┆ f64 ┆ str ┆ str   │
            ╞═════╪═════╪═════╪═══════╡
            │ 1   ┆ 6.0 ┆ a   ┆ x     │
            │ 2   ┆ 7.0 ┆ b   ┆ y     │
            └─────┴─────┴─────┴───────┘
            >>> agnostic_join_on_ham(lf_dask, other_dask)
               foo  bar ham apple
            0    1  6.0   a     x
            0    2  7.0   b     y
        """
        return super().join(
            other, how=how, left_on=left_on, right_on=right_on, on=on, suffix=suffix
        )

    def join_asof(
        self,
        other: Self,
        *,
        left_on: str | None = None,
        right_on: str | None = None,
        on: str | None = None,
        by_left: str | list[str] | None = None,
        by_right: str | list[str] | None = None,
        by: str | list[str] | None = None,
        strategy: Literal["backward", "forward", "nearest"] = "backward",
    ) -> Self:
        """Perform an asof join.

        This is similar to a left-join except that we match on nearest key rather than equal keys.

        Both DataFrames must be sorted by the asof_join key.

        Arguments:
            other: DataFrame to join with.

            left_on: Name(s) of the left join column(s).

            right_on: Name(s) of the right join column(s).

            on: Join column of both DataFrames. If set, left_on and right_on should be None.

            by_left: join on these columns before doing asof join

            by_right: join on these columns before doing asof join

            by: join on these columns before doing asof join

            strategy: Join strategy. The default is "backward".

                  * *backward*: selects the last row in the right DataFrame whose "on" key is less than or equal to the left's key.
                  * *forward*: selects the first row in the right DataFrame whose "on" key is greater than or equal to the left's key.
                  * *nearest*: search selects the last row in the right DataFrame whose value is nearest to the left's key.

        Returns:
            A new joined LazyFrame.

        Examples:
            >>> from datetime import datetime
            >>> import narwhals as nw
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> from typing import Literal
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data_gdp = {
            ...     "datetime": [
            ...         datetime(2016, 1, 1),
            ...         datetime(2017, 1, 1),
            ...         datetime(2018, 1, 1),
            ...         datetime(2019, 1, 1),
            ...         datetime(2020, 1, 1),
            ...     ],
            ...     "gdp": [4164, 4411, 4566, 4696, 4827],
            ... }
            >>> data_population = {
            ...     "datetime": [
            ...         datetime(2016, 3, 1),
            ...         datetime(2018, 8, 1),
            ...         datetime(2019, 1, 1),
            ...     ],
            ...     "population": [82.19, 82.66, 83.12],
            ... }
            >>> gdp_pl = pl.LazyFrame(data_gdp)
            >>> population_pl = pl.LazyFrame(data_population)
            >>> gdp_dask = dd.from_dict(data_gdp, npartitions=2)
            >>> population_dask = dd.from_dict(data_population, npartitions=2)

            Let's define a dataframe-agnostic function in which we join over "datetime" column:

            >>> def agnostic_join_asof_datetime(
            ...     df_native: IntoFrameT,
            ...     other_native: IntoFrameT,
            ...     strategy: Literal["backward", "forward", "nearest"],
            ... ) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     other = nw.from_native(other_native)
            ...     return (
            ...         df.sort("datetime")
            ...         .join_asof(other, on="datetime", strategy=strategy)
            ...         .collect()
            ...         .to_native()
            ...     )

            We can then pass any supported library such as Polars or Dask to `agnostic_join_asof_datetime`:

            >>> agnostic_join_asof_datetime(population_pl, gdp_pl, strategy="backward")
            shape: (3, 3)
            ┌─────────────────────┬────────────┬──────┐
            │ datetime            ┆ population ┆ gdp  │
            │ ---                 ┆ ---        ┆ ---  │
            │ datetime[μs]        ┆ f64        ┆ i64  │
            ╞═════════════════════╪════════════╪══════╡
            │ 2016-03-01 00:00:00 ┆ 82.19      ┆ 4164 │
            │ 2018-08-01 00:00:00 ┆ 82.66      ┆ 4566 │
            │ 2019-01-01 00:00:00 ┆ 83.12      ┆ 4696 │
            └─────────────────────┴────────────┴──────┘
            >>> agnostic_join_asof_datetime(population_dask, gdp_dask, strategy="backward")
                datetime  population   gdp
            0 2016-03-01       82.19  4164
            1 2018-08-01       82.66  4566
            0 2019-01-01       83.12  4696

            Here is a real-world times-series example that uses `by` argument.

            >>> from datetime import datetime
            >>> import narwhals as nw
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data_quotes = {
            ...     "datetime": [
            ...         datetime(2016, 5, 25, 13, 30, 0, 23),
            ...         datetime(2016, 5, 25, 13, 30, 0, 23),
            ...         datetime(2016, 5, 25, 13, 30, 0, 30),
            ...         datetime(2016, 5, 25, 13, 30, 0, 41),
            ...         datetime(2016, 5, 25, 13, 30, 0, 48),
            ...         datetime(2016, 5, 25, 13, 30, 0, 49),
            ...         datetime(2016, 5, 25, 13, 30, 0, 72),
            ...         datetime(2016, 5, 25, 13, 30, 0, 75),
            ...     ],
            ...     "ticker": [
            ...         "GOOG",
            ...         "MSFT",
            ...         "MSFT",
            ...         "MSFT",
            ...         "GOOG",
            ...         "AAPL",
            ...         "GOOG",
            ...         "MSFT",
            ...     ],
            ...     "bid": [720.50, 51.95, 51.97, 51.99, 720.50, 97.99, 720.50, 52.01],
            ...     "ask": [720.93, 51.96, 51.98, 52.00, 720.93, 98.01, 720.88, 52.03],
            ... }
            >>> data_trades = {
            ...     "datetime": [
            ...         datetime(2016, 5, 25, 13, 30, 0, 23),
            ...         datetime(2016, 5, 25, 13, 30, 0, 38),
            ...         datetime(2016, 5, 25, 13, 30, 0, 48),
            ...         datetime(2016, 5, 25, 13, 30, 0, 49),
            ...         datetime(2016, 5, 25, 13, 30, 0, 48),
            ...     ],
            ...     "ticker": ["MSFT", "MSFT", "GOOG", "GOOG", "AAPL"],
            ...     "price": [51.95, 51.95, 720.77, 720.92, 98.0],
            ...     "quantity": [75, 155, 100, 100, 100],
            ... }
            >>> quotes_pl = pl.LazyFrame(data_quotes)
            >>> trades_pl = pl.LazyFrame(data_trades)
            >>> quotes_dask = dd.from_dict(data_quotes, npartitions=2)
            >>> trades_dask = dd.from_dict(data_trades, npartitions=2)

            Let's define a dataframe-agnostic function in which we join over "datetime" and by "ticker" columns:

            >>> def agnostic_join_asof_datetime_by_ticker(
            ...     df_native: IntoFrameT,
            ...     other_native: IntoFrameT,
            ... ) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     other = nw.from_native(other_native)
            ...     return (
            ...         df.sort("datetime", "ticker")
            ...         .join_asof(other, on="datetime", by="ticker")
            ...         .sort("datetime", "ticker")
            ...         .collect()
            ...         .to_native()
            ...     )

            We can then pass any supported library such as Polars or Dask to `agnostic_join_asof_datetime_by_ticker`:

            >>> agnostic_join_asof_datetime_by_ticker(trades_pl, quotes_pl)
            shape: (5, 6)
            ┌────────────────────────────┬────────┬────────┬──────────┬───────┬────────┐
            │ datetime                   ┆ ticker ┆ price  ┆ quantity ┆ bid   ┆ ask    │
            │ ---                        ┆ ---    ┆ ---    ┆ ---      ┆ ---   ┆ ---    │
            │ datetime[μs]               ┆ str    ┆ f64    ┆ i64      ┆ f64   ┆ f64    │
            ╞════════════════════════════╪════════╪════════╪══════════╪═══════╪════════╡
            │ 2016-05-25 13:30:00.000023 ┆ MSFT   ┆ 51.95  ┆ 75       ┆ 51.95 ┆ 51.96  │
            │ 2016-05-25 13:30:00.000038 ┆ MSFT   ┆ 51.95  ┆ 155      ┆ 51.97 ┆ 51.98  │
            │ 2016-05-25 13:30:00.000048 ┆ AAPL   ┆ 98.0   ┆ 100      ┆ null  ┆ null   │
            │ 2016-05-25 13:30:00.000048 ┆ GOOG   ┆ 720.77 ┆ 100      ┆ 720.5 ┆ 720.93 │
            │ 2016-05-25 13:30:00.000049 ┆ GOOG   ┆ 720.92 ┆ 100      ┆ 720.5 ┆ 720.93 │
            └────────────────────────────┴────────┴────────┴──────────┴───────┴────────┘
            >>> agnostic_join_asof_datetime_by_ticker(trades_dask, quotes_dask)
                                datetime ticker   price  quantity     bid     ask
            0 2016-05-25 13:30:00.000023   MSFT   51.95        75   51.95   51.96
            0 2016-05-25 13:30:00.000038   MSFT   51.95       155   51.97   51.98
            1 2016-05-25 13:30:00.000048   AAPL   98.00       100     NaN     NaN
            2 2016-05-25 13:30:00.000048   GOOG  720.77       100  720.50  720.93
            3 2016-05-25 13:30:00.000049   GOOG  720.92       100  720.50  720.93
        """
        return super().join_asof(
            other,
            left_on=left_on,
            right_on=right_on,
            on=on,
            by_left=by_left,
            by_right=by_right,
            by=by,
            strategy=strategy,
        )

    def clone(self) -> Self:
        r"""Create a copy of this DataFrame.

        Returns:
            An identical copy of the original LazyFrame.

        Examples:
            >>> import narwhals as nw
            >>> import polars as pl
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2], "b": [3, 4]}
            >>> lf_pl = pl.LazyFrame(data)

            Let's define a dataframe-agnostic function in which we copy the DataFrame:

            >>> def agnostic_clone(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.clone().collect().to_native()

            We can then pass any supported library such as Polars to `agnostic_clone`:

            >>> agnostic_clone(lf_pl)
            shape: (2, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 1   ┆ 3   │
            │ 2   ┆ 4   │
            └─────┴─────┘
        """
        return super().clone()

    def lazy(self) -> Self:
        """Lazify the DataFrame (if possible).

        If a library does not support lazy execution, then this is a no-op.

        Returns:
            A LazyFrame.

        Examples:
            Construct pandas and Polars objects:

            >>> import pandas as pd
            >>> import polars as pl
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> df = {"foo": [1, 2, 3], "bar": [6.0, 7.0, 8.0], "ham": ["a", "b", "c"]}
            >>> df_pd = pd.DataFrame(df)
            >>> lf_pl = pl.LazyFrame(df)

            We define a library agnostic function:

            >>> def agnostic_lazy(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.lazy().to_native()

            Note that then, pandas dataframe stay eager, and the Polars LazyFrame stays lazy:

            >>> agnostic_lazy(df_pd)
               foo  bar ham
            0    1  6.0   a
            1    2  7.0   b
            2    3  8.0   c
            >>> agnostic_lazy(lf_pl)
            <LazyFrame ...>
        """
        return self

    def gather_every(self: Self, n: int, offset: int = 0) -> Self:
        r"""Take every nth row in the DataFrame and return as a new DataFrame.

        Arguments:
            n: Gather every *n*-th row.
            offset: Starting index.

        Returns:
            The LazyFrame containing only the selected rows.

        Examples:
            >>> import narwhals as nw
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {"a": [1, 2, 3, 4], "b": [5, 6, 7, 8]}
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            Let's define a dataframe-agnostic function in which we gather every 2 rows,
            starting from a offset of 1:

            >>> def agnostic_gather_every(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return df.gather_every(n=2, offset=1).collect().to_native()

            We can then pass any supported library such as Polars or Dask to `agnostic_gather_every`:

            >>> agnostic_gather_every(lf_pl)
            shape: (2, 2)
            ┌─────┬─────┐
            │ a   ┆ b   │
            │ --- ┆ --- │
            │ i64 ┆ i64 │
            ╞═════╪═════╡
            │ 2   ┆ 6   │
            │ 4   ┆ 8   │
            └─────┴─────┘
            >>> agnostic_gather_every(lf_dask)
               a  b
            1  2  6
            3  4  8
        """
        return super().gather_every(n=n, offset=offset)

    def unpivot(
        self: Self,
        on: str | list[str] | None = None,
        *,
        index: str | list[str] | None = None,
        variable_name: str | None = None,
        value_name: str | None = None,
    ) -> Self:
        r"""Unpivot a DataFrame from wide to long format.

        Optionally leaves identifiers set.

        This function is useful to massage a DataFrame into a format where one or more
        columns are identifier variables (index) while all other columns, considered
        measured variables (on), are "unpivoted" to the row axis leaving just
        two non-identifier columns, 'variable' and 'value'.

        Arguments:
            on: Column(s) to use as values variables; if `on` is empty all columns that
                are not in `index` will be used.
            index: Column(s) to use as identifier variables.
            variable_name: Name to give to the `variable` column. Defaults to "variable".
            value_name: Name to give to the `value` column. Defaults to "value".

        Returns:
            The unpivoted LazyFrame.

        Notes:
            If you're coming from pandas, this is similar to `pandas.DataFrame.melt`,
            but with `index` replacing `id_vars` and `on` replacing `value_vars`.
            In other frameworks, you might know this operation as `pivot_longer`.

        Examples:
            >>> import narwhals as nw
            >>> import polars as pl
            >>> import dask.dataframe as dd
            >>> from narwhals.typing import IntoFrameT
            >>>
            >>> data = {
            ...     "a": ["x", "y", "z"],
            ...     "b": [1, 3, 5],
            ...     "c": [2, 4, 6],
            ... }
            >>> lf_pl = pl.LazyFrame(data)
            >>> lf_dask = dd.from_dict(data, npartitions=2)

            We define a library agnostic function:

            >>> def agnostic_unpivot(df_native: IntoFrameT) -> IntoFrameT:
            ...     df = nw.from_native(df_native)
            ...     return (
            ...         (df.unpivot(on=["b", "c"], index="a").sort(["variable", "a"]))
            ...         .collect()
            ...         .to_native()
            ...     )

            We can then pass any supported library such as Polars or Dask to `agnostic_unpivot`:

            >>> agnostic_unpivot(lf_pl)
            shape: (6, 3)
            ┌─────┬──────────┬───────┐
            │ a   ┆ variable ┆ value │
            │ --- ┆ ---      ┆ ---   │
            │ str ┆ str      ┆ i64   │
            ╞═════╪══════════╪═══════╡
            │ x   ┆ b        ┆ 1     │
            │ y   ┆ b        ┆ 3     │
            │ z   ┆ b        ┆ 5     │
            │ x   ┆ c        ┆ 2     │
            │ y   ┆ c        ┆ 4     │
            │ z   ┆ c        ┆ 6     │
            └─────┴──────────┴───────┘
            >>> agnostic_unpivot(lf_dask)
               a variable  value
            0  x        b      1
            1  y        b      3
            0  z        b      5
            2  x        c      2
            3  y        c      4
            1  z        c      6
        """
        return super().unpivot(
            on=on, index=index, variable_name=variable_name, value_name=value_name
        )

    def explode(self: Self, columns: str | Sequence[str], *more_columns: str) -> Self:
        """Explode the dataframe to long format by exploding the given columns.

        Notes:
            It is possible to explode multiple columns only if these columns have
            matching element counts.

        Arguments:
            columns: Column names. The underlying columns being exploded must be of the `List` data type.
            *more_columns: Additional names of columns to explode, specified as positional arguments.

        Returns:
            New LazyFrame

        Examples:
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoFrameT
            >>> import polars as pl
            >>> data = {
            ...     "a": ["x", "y", "z", "w"],
            ...     "lst1": [[1, 2], None, [None], []],
            ...     "lst2": [[3, None], None, [42], []],
            ... }

            We define a library agnostic function:

            >>> def agnostic_explode(df_native: IntoFrameT) -> IntoFrameT:
            ...     return (
            ...         nw.from_native(df_native)
            ...         .with_columns(nw.col("lst1", "lst2").cast(nw.List(nw.Int32())))
            ...         .explode("lst1", "lst2")
            ...         .collect()
            ...         .to_native()
            ...     )

            We can then pass any supported library such as Polars to `agnostic_explode`:

            >>> agnostic_explode(pl.LazyFrame(data))
            shape: (5, 3)
            ┌─────┬──────┬──────┐
            │ a   ┆ lst1 ┆ lst2 │
            │ --- ┆ ---  ┆ ---  │
            │ str ┆ i32  ┆ i32  │
            ╞═════╪══════╪══════╡
            │ x   ┆ 1    ┆ 3    │
            │ x   ┆ 2    ┆ null │
            │ y   ┆ null ┆ null │
            │ z   ┆ null ┆ 42   │
            │ w   ┆ null ┆ null │
            └─────┴──────┴──────┘
        """
        return super().explode(columns, *more_columns)
