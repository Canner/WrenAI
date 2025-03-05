from __future__ import annotations

import platform
import sys
from typing import TYPE_CHECKING
from typing import Any
from typing import Iterable
from typing import Literal
from typing import Protocol
from typing import Sequence
from typing import TypeVar
from typing import Union
from typing import overload

from narwhals._expression_parsing import extract_compliant
from narwhals._pandas_like.utils import broadcast_align_and_extract_native
from narwhals.dataframe import DataFrame
from narwhals.dataframe import LazyFrame
from narwhals.dependencies import is_numpy_array
from narwhals.expr import Expr
from narwhals.translate import from_native
from narwhals.utils import Implementation
from narwhals.utils import Version
from narwhals.utils import flatten
from narwhals.utils import parse_version
from narwhals.utils import validate_laziness

# Missing type parameters for generic type "DataFrame"
# However, trying to provide one results in mypy still complaining...
# The rest of the annotations seem to work fine with this anyway
FrameT = TypeVar("FrameT", bound=Union[DataFrame, LazyFrame])  # type: ignore[type-arg]


if TYPE_CHECKING:
    from types import ModuleType

    import numpy as np

    from narwhals.dtypes import DType
    from narwhals.schema import Schema
    from narwhals.series import Series
    from narwhals.typing import IntoDataFrameT
    from narwhals.typing import IntoExpr
    from narwhals.typing import IntoFrameT
    from narwhals.typing import IntoSeriesT

    class ArrowStreamExportable(Protocol):
        def __arrow_c_stream__(
            self, requested_schema: object | None = None
        ) -> object: ...


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

    Examples:
        Let's take an example of vertical concatenation:

        >>> import pandas as pd
        >>> import polars as pl
        >>> import narwhals as nw
        >>> data_1 = {"a": [1, 2, 3], "b": [4, 5, 6]}
        >>> data_2 = {"a": [5, 2], "b": [1, 4]}

        >>> df_pd_1 = pd.DataFrame(data_1)
        >>> df_pd_2 = pd.DataFrame(data_2)
        >>> df_pl_1 = pl.DataFrame(data_1)
        >>> df_pl_2 = pl.DataFrame(data_2)

        Let's define a dataframe-agnostic function:

        >>> @nw.narwhalify
        ... def agnostic_vertical_concat(df1, df2):
        ...     return nw.concat([df1, df2], how="vertical")

        >>> agnostic_vertical_concat(df_pd_1, df_pd_2)
           a  b
        0  1  4
        1  2  5
        2  3  6
        0  5  1
        1  2  4
        >>> agnostic_vertical_concat(df_pl_1, df_pl_2)
        shape: (5, 2)
        ┌─────┬─────┐
        │ a   ┆ b   │
        │ --- ┆ --- │
        │ i64 ┆ i64 │
        ╞═════╪═════╡
        │ 1   ┆ 4   │
        │ 2   ┆ 5   │
        │ 3   ┆ 6   │
        │ 5   ┆ 1   │
        │ 2   ┆ 4   │
        └─────┴─────┘

        Let's look at case a for horizontal concatenation:

        >>> import pandas as pd
        >>> import polars as pl
        >>> import narwhals as nw
        >>> data_1 = {"a": [1, 2, 3], "b": [4, 5, 6]}
        >>> data_2 = {"c": [5, 2], "d": [1, 4]}

        >>> df_pd_1 = pd.DataFrame(data_1)
        >>> df_pd_2 = pd.DataFrame(data_2)
        >>> df_pl_1 = pl.DataFrame(data_1)
        >>> df_pl_2 = pl.DataFrame(data_2)

        Defining a dataframe-agnostic function:

        >>> @nw.narwhalify
        ... def agnostic_horizontal_concat(df1, df2):
        ...     return nw.concat([df1, df2], how="horizontal")

        >>> agnostic_horizontal_concat(df_pd_1, df_pd_2)
           a  b    c    d
        0  1  4  5.0  1.0
        1  2  5  2.0  4.0
        2  3  6  NaN  NaN

        >>> agnostic_horizontal_concat(df_pl_1, df_pl_2)
        shape: (3, 4)
        ┌─────┬─────┬──────┬──────┐
        │ a   ┆ b   ┆ c    ┆ d    │
        │ --- ┆ --- ┆ ---  ┆ ---  │
        │ i64 ┆ i64 ┆ i64  ┆ i64  │
        ╞═════╪═════╪══════╪══════╡
        │ 1   ┆ 4   ┆ 5    ┆ 1    │
        │ 2   ┆ 5   ┆ 2    ┆ 4    │
        │ 3   ┆ 6   ┆ null ┆ null │
        └─────┴─────┴──────┴──────┘

        Let's look at case a for diagonal concatenation:

        >>> import pandas as pd
        >>> import polars as pl
        >>> import narwhals as nw
        >>> data_1 = {"a": [1, 2], "b": [3.5, 4.5]}
        >>> data_2 = {"a": [3, 4], "z": ["x", "y"]}

        >>> df_pd_1 = pd.DataFrame(data_1)
        >>> df_pd_2 = pd.DataFrame(data_2)
        >>> df_pl_1 = pl.DataFrame(data_1)
        >>> df_pl_2 = pl.DataFrame(data_2)

        Defining a dataframe-agnostic function:

        >>> @nw.narwhalify
        ... def agnostic_diagonal_concat(df1, df2):
        ...     return nw.concat([df1, df2], how="diagonal")

        >>> agnostic_diagonal_concat(df_pd_1, df_pd_2)
           a    b    z
        0  1  3.5  NaN
        1  2  4.5  NaN
        0  3  NaN    x
        1  4  NaN    y

        >>> agnostic_diagonal_concat(df_pl_1, df_pl_2)
        shape: (4, 3)
        ┌─────┬──────┬──────┐
        │ a   ┆ b    ┆ z    │
        │ --- ┆ ---  ┆ ---  │
        │ i64 ┆ f64  ┆ str  │
        ╞═════╪══════╪══════╡
        │ 1   ┆ 3.5  ┆ null │
        │ 2   ┆ 4.5  ┆ null │
        │ 3   ┆ null ┆ x    │
        │ 4   ┆ null ┆ y    │
        └─────┴──────┴──────┘
    """
    if how not in {"horizontal", "vertical", "diagonal"}:  # pragma: no cover
        msg = "Only vertical, horizontal and diagonal concatenations are supported."
        raise NotImplementedError(msg)
    if not items:
        msg = "No items to concatenate"
        raise ValueError(msg)
    items = list(items)
    validate_laziness(items)
    first_item = items[0]
    plx = first_item.__narwhals_namespace__()
    return first_item._from_compliant_dataframe(
        plx.concat([df._compliant_frame for df in items], how=how),
    )


def new_series(
    name: str,
    values: Any,
    dtype: DType | type[DType] | None = None,
    *,
    native_namespace: ModuleType,
) -> Series[Any]:
    """Instantiate Narwhals Series from iterable (e.g. list or array).

    Arguments:
        name: Name of resulting Series.
        values: Values of make Series from.
        dtype: (Narwhals) dtype. If not provided, the native library
            may auto-infer it from `values`.
        native_namespace: The native library to use for DataFrame creation.

    Returns:
        A new Series

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT, IntoSeriesT
        >>> data = {"a": [1, 2, 3], "b": [4, 5, 6]}

        Let's define a dataframe-agnostic function:

        >>> def agnostic_new_series(df_native: IntoFrameT) -> IntoSeriesT:
        ...     values = [4, 1, 2, 3]
        ...     native_namespace = nw.get_native_namespace(df_native)
        ...     return nw.new_series(
        ...         name="a",
        ...         values=values,
        ...         dtype=nw.Int32,
        ...         native_namespace=native_namespace,
        ...     ).to_native()

        We can then pass any supported eager library, such as pandas / Polars / PyArrow:

        >>> agnostic_new_series(pd.DataFrame(data))
        0    4
        1    1
        2    2
        3    3
        Name: a, dtype: int32
        >>> agnostic_new_series(pl.DataFrame(data))  # doctest: +NORMALIZE_WHITESPACE
        shape: (4,)
        Series: 'a' [i32]
        [
           4
           1
           2
           3
        ]
        >>> agnostic_new_series(pa.table(data))
        <pyarrow.lib.ChunkedArray object at ...>
        [
          [
            4,
            1,
            2,
            3
          ]
        ]
    """
    return _new_series_impl(
        name,
        values,
        dtype,
        native_namespace=native_namespace,
        version=Version.MAIN,
    )


def _new_series_impl(
    name: str,
    values: Any,
    dtype: DType | type[DType] | None = None,
    *,
    native_namespace: ModuleType,
    version: Version,
) -> Series[Any]:
    implementation = Implementation.from_native_namespace(native_namespace)

    if implementation is Implementation.POLARS:
        if dtype:
            from narwhals._polars.utils import (
                narwhals_to_native_dtype as polars_narwhals_to_native_dtype,
            )

            dtype_pl = polars_narwhals_to_native_dtype(dtype, version=version)
        else:
            dtype_pl = None

        native_series = native_namespace.Series(name=name, values=values, dtype=dtype_pl)
    elif implementation in {
        Implementation.PANDAS,
        Implementation.MODIN,
        Implementation.CUDF,
    }:
        if dtype:
            from narwhals._pandas_like.utils import (
                narwhals_to_native_dtype as pandas_like_narwhals_to_native_dtype,
            )

            backend_version = parse_version(native_namespace.__version__)
            dtype = pandas_like_narwhals_to_native_dtype(
                dtype, None, implementation, backend_version, version
            )
        native_series = native_namespace.Series(values, name=name, dtype=dtype)

    elif implementation is Implementation.PYARROW:
        if dtype:
            from narwhals._arrow.utils import (
                narwhals_to_native_dtype as arrow_narwhals_to_native_dtype,
            )

            dtype = arrow_narwhals_to_native_dtype(dtype, version=version)
        native_series = native_namespace.chunked_array([values], type=dtype)

    elif implementation is Implementation.DASK:
        msg = "Dask support in Narwhals is lazy-only, so `new_series` is " "not supported"
        raise NotImplementedError(msg)
    else:  # pragma: no cover
        try:
            # implementation is UNKNOWN, Narwhals extension using this feature should
            # implement `from_dict` function in the top-level namespace.
            native_series = native_namespace.new_series(name, values, dtype)
        except AttributeError as e:
            msg = "Unknown namespace is expected to implement `Series` constructor."
            raise AttributeError(msg) from e
    return from_native(native_series, series_only=True).alias(name)


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

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>> data = {"a": [1, 2, 3], "b": [4, 5, 6]}

        Let's create a new dataframe of the same class as the dataframe we started with, from a dict of new data:

        >>> def agnostic_from_dict(df_native: IntoFrameT) -> IntoFrameT:
        ...     new_data = {"c": [5, 2], "d": [1, 4]}
        ...     native_namespace = nw.get_native_namespace(df_native)
        ...     return nw.from_dict(new_data, native_namespace=native_namespace).to_native()

        Let's see what happens when passing pandas, Polars or PyArrow input:

        >>> agnostic_from_dict(pd.DataFrame(data))
           c  d
        0  5  1
        1  2  4
        >>> agnostic_from_dict(pl.DataFrame(data))
        shape: (2, 2)
        ┌─────┬─────┐
        │ c   ┆ d   │
        │ --- ┆ --- │
        │ i64 ┆ i64 │
        ╞═════╪═════╡
        │ 5   ┆ 1   │
        │ 2   ┆ 4   │
        └─────┴─────┘
        >>> agnostic_from_dict(pa.table(data))
        pyarrow.Table
        c: int64
        d: int64
        ----
        c: [[5,2]]
        d: [[1,4]]
    """
    return _from_dict_impl(
        data,
        schema,
        native_namespace=native_namespace,
        version=Version.MAIN,
    )


def _from_dict_impl(
    data: dict[str, Any],
    schema: dict[str, DType] | Schema | None = None,
    *,
    native_namespace: ModuleType | None = None,
    version: Version,
) -> DataFrame[Any]:
    from narwhals.series import Series
    from narwhals.translate import to_native

    if not data:
        msg = "from_dict cannot be called with empty dictionary"
        raise ValueError(msg)
    if native_namespace is None:
        for val in data.values():
            if isinstance(val, Series):
                native_namespace = val.__native_namespace__()
                break
        else:
            msg = "Calling `from_dict` without `native_namespace` is only supported if all input values are already Narwhals Series"
            raise TypeError(msg)
        data = {key: to_native(value, pass_through=True) for key, value in data.items()}
    implementation = Implementation.from_native_namespace(native_namespace)

    if implementation is Implementation.POLARS:
        if schema:
            from narwhals._polars.utils import (
                narwhals_to_native_dtype as polars_narwhals_to_native_dtype,
            )

            schema_pl = {
                name: polars_narwhals_to_native_dtype(dtype, version=version)
                for name, dtype in schema.items()
            }
        else:
            schema_pl = None

        native_frame = native_namespace.from_dict(data, schema=schema_pl)
    elif implementation in {
        Implementation.PANDAS,
        Implementation.MODIN,
        Implementation.CUDF,
    }:
        aligned_data = {}
        left_most_series = None
        for key, native_series in data.items():
            if isinstance(native_series, native_namespace.Series):
                compliant_series = from_native(
                    native_series, series_only=True
                )._compliant_series
                if left_most_series is None:
                    left_most_series = compliant_series
                    aligned_data[key] = native_series
                else:
                    aligned_data[key] = broadcast_align_and_extract_native(
                        left_most_series, compliant_series
                    )[1]
            else:
                aligned_data[key] = native_series

        native_frame = native_namespace.DataFrame.from_dict(aligned_data)

        if schema:
            from narwhals._pandas_like.utils import (
                narwhals_to_native_dtype as pandas_like_narwhals_to_native_dtype,
            )

            backend_version = parse_version(native_namespace.__version__)
            schema = {
                name: pandas_like_narwhals_to_native_dtype(
                    schema[name], native_type, implementation, backend_version, version
                )
                for name, native_type in native_frame.dtypes.items()
            }
            native_frame = native_frame.astype(schema)

    elif implementation is Implementation.PYARROW:
        if schema:
            from narwhals._arrow.utils import (
                narwhals_to_native_dtype as arrow_narwhals_to_native_dtype,
            )

            schema = native_namespace.schema(
                [
                    (name, arrow_narwhals_to_native_dtype(dtype, version))
                    for name, dtype in schema.items()
                ]
            )
        native_frame = native_namespace.table(data, schema=schema)
    else:  # pragma: no cover
        try:
            # implementation is UNKNOWN, Narwhals extension using this feature should
            # implement `from_dict` function in the top-level namespace.
            native_frame = native_namespace.from_dict(data, schema=schema)
        except AttributeError as e:
            msg = "Unknown namespace is expected to implement `from_dict` function."
            raise AttributeError(msg) from e
    return from_native(native_frame, eager_only=True)


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

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> import numpy as np
        >>> from narwhals.typing import IntoFrameT
        >>> data = {"a": [1, 2], "b": [3, 4]}

        Let's create a new dataframe of the same class as the dataframe we started with, from a NumPy ndarray of new data:

        >>> def agnostic_from_numpy(df_native: IntoFrameT) -> IntoFrameT:
        ...     new_data = np.array([[5, 2, 1], [1, 4, 3]])
        ...     df = nw.from_native(df_native)
        ...     native_namespace = nw.get_native_namespace(df)
        ...     return nw.from_numpy(new_data, native_namespace=native_namespace).to_native()

        Let's see what happens when passing pandas, Polars or PyArrow input:

        >>> agnostic_from_numpy(pd.DataFrame(data))
           column_0  column_1  column_2
        0         5         2         1
        1         1         4         3
        >>> agnostic_from_numpy(pl.DataFrame(data))
        shape: (2, 3)
        ┌──────────┬──────────┬──────────┐
        │ column_0 ┆ column_1 ┆ column_2 │
        │ ---      ┆ ---      ┆ ---      │
        │ i64      ┆ i64      ┆ i64      │
        ╞══════════╪══════════╪══════════╡
        │ 5        ┆ 2        ┆ 1        │
        │ 1        ┆ 4        ┆ 3        │
        └──────────┴──────────┴──────────┘
        >>> agnostic_from_numpy(pa.table(data))
        pyarrow.Table
        column_0: int64
        column_1: int64
        column_2: int64
        ----
        column_0: [[5,1]]
        column_1: [[2,4]]
        column_2: [[1,3]]

        Let's specify the column names:

        >>> def agnostic_from_numpy(df_native: IntoFrameT) -> IntoFrameT:
        ...     new_data = np.array([[5, 2, 1], [1, 4, 3]])
        ...     schema = ["c", "d", "e"]
        ...     df = nw.from_native(df_native)
        ...     native_namespace = nw.get_native_namespace(df)
        ...     return nw.from_numpy(
        ...         new_data, native_namespace=native_namespace, schema=schema
        ...     ).to_native()

        Let's see the modified outputs:

        >>> agnostic_from_numpy(pd.DataFrame(data))
           c  d  e
        0  5  2  1
        1  1  4  3
        >>> agnostic_from_numpy(pl.DataFrame(data))
        shape: (2, 3)
        ┌─────┬─────┬─────┐
        │ c   ┆ d   ┆ e   │
        │ --- ┆ --- ┆ --- │
        │ i64 ┆ i64 ┆ i64 │
        ╞═════╪═════╪═════╡
        │ 5   ┆ 2   ┆ 1   │
        │ 1   ┆ 4   ┆ 3   │
        └─────┴─────┴─────┘
        >>> agnostic_from_numpy(pa.table(data))
        pyarrow.Table
        c: int64
        d: int64
        e: int64
        ----
        c: [[5,1]]
        d: [[2,4]]
        e: [[1,3]]

        Let's modify the function so that it specifies the schema:

        >>> def agnostic_from_numpy(df_native: IntoFrameT) -> IntoFrameT:
        ...     new_data = np.array([[5, 2, 1], [1, 4, 3]])
        ...     schema = {"c": nw.Int16(), "d": nw.Float32(), "e": nw.Int8()}
        ...     df = nw.from_native(df_native)
        ...     native_namespace = nw.get_native_namespace(df)
        ...     return nw.from_numpy(
        ...         new_data, native_namespace=native_namespace, schema=schema
        ...     ).to_native()

        Let's see the outputs:

        >>> agnostic_from_numpy(pd.DataFrame(data))
           c    d  e
        0  5  2.0  1
        1  1  4.0  3
        >>> agnostic_from_numpy(pl.DataFrame(data))
        shape: (2, 3)
        ┌─────┬─────┬─────┐
        │ c   ┆ d   ┆ e   │
        │ --- ┆ --- ┆ --- │
        │ i16 ┆ f32 ┆ i8  │
        ╞═════╪═════╪═════╡
        │ 5   ┆ 2.0 ┆ 1   │
        │ 1   ┆ 4.0 ┆ 3   │
        └─────┴─────┴─────┘
        >>> agnostic_from_numpy(pa.table(data))
        pyarrow.Table
        c: int16
        d: float
        e: int8
        ----
        c: [[5,1]]
        d: [[2,4]]
        e: [[1,3]]
    """
    return _from_numpy_impl(
        data,
        schema,
        native_namespace=native_namespace,
        version=Version.MAIN,
    )


def _from_numpy_impl(
    data: np.ndarray,
    schema: dict[str, DType] | Schema | list[str] | None = None,
    *,
    native_namespace: ModuleType,
    version: Version,
) -> DataFrame[Any]:
    from narwhals.schema import Schema

    if data.ndim != 2:
        msg = "`from_numpy` only accepts 2D numpy arrays"
        raise ValueError(msg)
    implementation = Implementation.from_native_namespace(native_namespace)

    if implementation is Implementation.POLARS:
        if isinstance(schema, (dict, Schema)):
            from narwhals._polars.utils import (
                narwhals_to_native_dtype as polars_narwhals_to_native_dtype,
            )

            schema = {
                name: polars_narwhals_to_native_dtype(dtype, version=version)  # type: ignore[misc]
                for name, dtype in schema.items()
            }
        elif schema is None:
            native_frame = native_namespace.from_numpy(data)
        elif not isinstance(schema, list):
            msg = (
                "`schema` is expected to be one of the following types: "
                "dict[str, DType] | Schema | list[str]. "
                f"Got {type(schema)}."
            )
            raise TypeError(msg)
        native_frame = native_namespace.from_numpy(data, schema=schema)

    elif implementation in {
        Implementation.PANDAS,
        Implementation.MODIN,
        Implementation.CUDF,
    }:
        if isinstance(schema, (dict, Schema)):
            from narwhals._pandas_like.utils import (
                narwhals_to_native_dtype as pandas_like_narwhals_to_native_dtype,
            )

            backend_version = parse_version(native_namespace.__version__)
            schema = {
                name: pandas_like_narwhals_to_native_dtype(
                    schema[name], native_type, implementation, backend_version, version
                )
                for name, native_type in schema.items()
            }
            native_frame = native_namespace.DataFrame(data, columns=schema.keys()).astype(
                schema
            )
        elif isinstance(schema, list):
            native_frame = native_namespace.DataFrame(data, columns=schema)
        elif schema is None:
            native_frame = native_namespace.DataFrame(
                data, columns=["column_" + str(x) for x in range(data.shape[1])]
            )
        else:
            msg = (
                "`schema` is expected to be one of the following types: "
                "dict[str, DType] | Schema | list[str]. "
                f"Got {type(schema)}."
            )
            raise TypeError(msg)

    elif implementation is Implementation.PYARROW:
        pa_arrays = [native_namespace.array(val) for val in data.T]
        if isinstance(schema, (dict, Schema)):
            from narwhals._arrow.utils import (
                narwhals_to_native_dtype as arrow_narwhals_to_native_dtype,
            )

            schema = native_namespace.schema(
                [
                    (name, arrow_narwhals_to_native_dtype(dtype, version))
                    for name, dtype in schema.items()
                ]
            )
            native_frame = native_namespace.Table.from_arrays(pa_arrays, schema=schema)
        elif isinstance(schema, list):
            native_frame = native_namespace.Table.from_arrays(pa_arrays, names=schema)
        elif schema is None:
            native_frame = native_namespace.Table.from_arrays(
                pa_arrays, names=["column_" + str(x) for x in range(data.shape[1])]
            )
        else:
            msg = (
                "`schema` is expected to be one of the following types: "
                "dict[str, DType] | Schema | list[str]. "
                f"Got {type(schema)}."
            )
            raise TypeError(msg)
    else:  # pragma: no cover
        try:
            # implementation is UNKNOWN, Narwhals extension using this feature should
            # implement `from_numpy` function in the top-level namespace.
            native_frame = native_namespace.from_numpy(data, schema=schema)
        except AttributeError as e:
            msg = "Unknown namespace is expected to implement `from_numpy` function."
            raise AttributeError(msg) from e
    return from_native(native_frame, eager_only=True)


def from_arrow(
    native_frame: ArrowStreamExportable, *, native_namespace: ModuleType
) -> DataFrame[Any]:
    """Construct a DataFrame from an object which supports the PyCapsule Interface.

    Arguments:
        native_frame: Object which implements `__arrow_c_stream__`.
        native_namespace: The native library to use for DataFrame creation.

    Returns:
        A new DataFrame.

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>> data = {"a": [1, 2, 3], "b": [4, 5, 6]}

        Let's define a dataframe-agnostic function which creates a PyArrow
        Table.

        >>> def agnostic_to_arrow(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return nw.from_arrow(df, native_namespace=pa).to_native()

        Let's see what happens when passing pandas / Polars input:

        >>> agnostic_to_arrow(pd.DataFrame(data))
        pyarrow.Table
        a: int64
        b: int64
        ----
        a: [[1,2,3]]
        b: [[4,5,6]]
        >>> agnostic_to_arrow(pl.DataFrame(data))
        pyarrow.Table
        a: int64
        b: int64
        ----
        a: [[1,2,3]]
        b: [[4,5,6]]
    """
    if not hasattr(native_frame, "__arrow_c_stream__"):
        msg = f"Given object of type {type(native_frame)} does not support PyCapsule interface"
        raise TypeError(msg)
    implementation = Implementation.from_native_namespace(native_namespace)

    if implementation is Implementation.POLARS and parse_version(
        native_namespace.__version__
    ) >= (1, 3):
        native_frame = native_namespace.DataFrame(native_frame)
    elif implementation in {
        Implementation.PANDAS,
        Implementation.MODIN,
        Implementation.CUDF,
        Implementation.POLARS,
    }:
        # These don't (yet?) support the PyCapsule Interface for import
        # so we go via PyArrow
        try:
            import pyarrow as pa  # ignore-banned-import
        except ModuleNotFoundError as exc:  # pragma: no cover
            msg = f"PyArrow>=14.0.0 is required for `from_arrow` for object of type {native_namespace}"
            raise ModuleNotFoundError(msg) from exc
        if parse_version(pa.__version__) < (14, 0):  # pragma: no cover
            msg = f"PyArrow>=14.0.0 is required for `from_arrow` for object of type {native_namespace}"
            raise ModuleNotFoundError(msg) from None

        tbl = pa.table(native_frame)
        if implementation is Implementation.PANDAS:
            native_frame = tbl.to_pandas()
        elif implementation is Implementation.MODIN:  # pragma: no cover
            from modin.pandas.utils import from_arrow

            native_frame = from_arrow(tbl)
        elif implementation is Implementation.CUDF:  # pragma: no cover
            native_frame = native_namespace.DataFrame.from_arrow(tbl)
        elif implementation is Implementation.POLARS:  # pragma: no cover
            native_frame = native_namespace.from_arrow(tbl)
        else:  # pragma: no cover
            msg = "congratulations, you entered unrecheable code - please report a bug"
            raise AssertionError(msg)
    elif implementation is Implementation.PYARROW:
        native_frame = native_namespace.table(native_frame)
    else:  # pragma: no cover
        try:
            # implementation is UNKNOWN, Narwhals extension using this feature should
            # implement PyCapsule support
            native_frame = native_namespace.DataFrame(native_frame)
        except AttributeError as e:
            msg = "Unknown namespace is expected to implement `DataFrame` class which accepts object which supports PyCapsule Interface."
            raise AttributeError(msg) from e
    return from_native(native_frame, eager_only=True)


def _get_sys_info() -> dict[str, str]:
    """System information.

    Returns system and Python version information

    Copied from sklearn

    Returns:
        Dictionary with system info.
    """
    python = sys.version.replace("\n", " ")

    blob = (
        ("python", python),
        ("executable", sys.executable),
        ("machine", platform.platform()),
    )

    return dict(blob)


def _get_deps_info() -> dict[str, str]:
    """Overview of the installed version of main dependencies.

    This function does not import the modules to collect the version numbers
    but instead relies on standard Python package metadata.

    Returns version information on relevant Python libraries

    This function and show_versions were copied from sklearn and adapted

    Returns:
        Mapping from dependency to version.
    """
    deps = (
        "pandas",
        "polars",
        "cudf",
        "modin",
        "pyarrow",
        "numpy",
    )

    from . import __version__

    deps_info = {
        "narwhals": __version__,
    }

    from importlib.metadata import PackageNotFoundError
    from importlib.metadata import version

    for modname in deps:
        try:
            deps_info[modname] = version(modname)
        except PackageNotFoundError:  # noqa: PERF203
            deps_info[modname] = ""
    return deps_info


def show_versions() -> None:
    """Print useful debugging information.

    Examples:
        >>> from narwhals import show_versions
        >>> show_versions()  # doctest: +SKIP
    """
    sys_info = _get_sys_info()
    deps_info = _get_deps_info()

    print("\nSystem:")  # noqa: T201
    for k, stat in sys_info.items():
        print(f"{k:>10}: {stat}")  # noqa: T201

    print("\nPython dependencies:")  # noqa: T201
    for k, stat in deps_info.items():
        print(f"{k:>13}: {stat}")  # noqa: T201


def get_level(
    obj: DataFrame[Any] | LazyFrame[Any] | Series[IntoSeriesT],
) -> Literal["full", "lazy", "interchange"]:
    """Level of support Narwhals has for current object.

    Arguments:
        obj: Dataframe or Series.

    Returns:
        This can be one of:

            - 'full': full Narwhals API support
            - 'lazy': only lazy operations are supported. This excludes anything
              which involves iterating over rows in Python.
            - 'interchange': only metadata operations are supported (`df.schema`)
    """
    return obj._level


def read_csv(
    source: str,
    *,
    native_namespace: ModuleType,
    **kwargs: Any,
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

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoDataFrame
        >>> from types import ModuleType

        Let's create an agnostic function that reads a csv file with a specified native namespace:

        >>> def agnostic_read_csv(native_namespace: ModuleType) -> IntoDataFrame:
        ...     return nw.read_csv("file.csv", native_namespace=native_namespace).to_native()

        Then we can read the file by passing pandas, Polars or PyArrow namespaces:

        >>> agnostic_read_csv(native_namespace=pd)  # doctest:+SKIP
           a  b
        0  1  4
        1  2  5
        2  3  6
        >>> agnostic_read_csv(native_namespace=pl)  # doctest:+SKIP
        shape: (3, 2)
        ┌─────┬─────┐
        │ a   ┆ b   │
        │ --- ┆ --- │
        │ i64 ┆ i64 │
        ╞═════╪═════╡
        │ 1   ┆ 4   │
        │ 2   ┆ 5   │
        │ 3   ┆ 6   │
        └─────┴─────┘
        >>> agnostic_read_csv(native_namespace=pa)  # doctest:+SKIP
        pyarrow.Table
        a: int64
        b: int64
        ----
        a: [[1,2,3]]
        b: [[4,5,6]]
    """
    return _read_csv_impl(source, native_namespace=native_namespace, **kwargs)


def _read_csv_impl(
    source: str, *, native_namespace: ModuleType, **kwargs: Any
) -> DataFrame[Any]:
    implementation = Implementation.from_native_namespace(native_namespace)
    if implementation in (
        Implementation.POLARS,
        Implementation.PANDAS,
        Implementation.MODIN,
        Implementation.CUDF,
    ):
        native_frame = native_namespace.read_csv(source, **kwargs)
    elif implementation is Implementation.PYARROW:
        from pyarrow import csv  # ignore-banned-import

        native_frame = csv.read_csv(source, **kwargs)
    else:  # pragma: no cover
        try:
            # implementation is UNKNOWN, Narwhals extension using this feature should
            # implement `read_csv` function in the top-level namespace.
            native_frame = native_namespace.read_csv(source=source, **kwargs)
        except AttributeError as e:
            msg = "Unknown namespace is expected to implement `read_csv` function."
            raise AttributeError(msg) from e
    return from_native(native_frame, eager_only=True)


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

    Examples:
        >>> import dask.dataframe as dd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrame
        >>> from types import ModuleType

        Let's create an agnostic function that lazily reads a csv file with a specified native namespace:

        >>> def agnostic_scan_csv(native_namespace: ModuleType) -> IntoFrame:
        ...     return nw.scan_csv("file.csv", native_namespace=native_namespace).to_native()

        Then we can read the file by passing, for example, Polars or Dask namespaces:

        >>> agnostic_scan_csv(native_namespace=pl).collect()  # doctest:+SKIP
        shape: (3, 2)
        ┌─────┬─────┐
        │ a   ┆ b   │
        │ --- ┆ --- │
        │ i64 ┆ i64 │
        ╞═════╪═════╡
        │ 1   ┆ 4   │
        │ 2   ┆ 5   │
        │ 3   ┆ 6   │
        └─────┴─────┘
        >>> agnostic_scan_csv(native_namespace=dd).compute()  # doctest:+SKIP
           a  b
        0  1  4
        1  2  5
        2  3  6
    """
    return _scan_csv_impl(source, native_namespace=native_namespace, **kwargs)


def _scan_csv_impl(
    source: str, *, native_namespace: ModuleType, **kwargs: Any
) -> LazyFrame[Any]:
    implementation = Implementation.from_native_namespace(native_namespace)
    if implementation is Implementation.POLARS:
        native_frame = native_namespace.scan_csv(source, **kwargs)
    elif implementation in (
        Implementation.PANDAS,
        Implementation.MODIN,
        Implementation.CUDF,
        Implementation.DASK,
        Implementation.DUCKDB,
    ):
        native_frame = native_namespace.read_csv(source, **kwargs)
    elif implementation is Implementation.PYARROW:
        from pyarrow import csv  # ignore-banned-import

        native_frame = csv.read_csv(source, **kwargs)
    else:  # pragma: no cover
        try:
            # implementation is UNKNOWN, Narwhals extension using this feature should
            # implement `scan_csv` function in the top-level namespace.
            native_frame = native_namespace.scan_csv(source=source, **kwargs)
        except AttributeError as e:
            msg = "Unknown namespace is expected to implement `scan_csv` function."
            raise AttributeError(msg) from e
    return from_native(native_frame).lazy()


def read_parquet(
    source: str,
    *,
    native_namespace: ModuleType,
    **kwargs: Any,
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

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoDataFrame
        >>> from types import ModuleType

        Let's create an agnostic function that reads a parquet file with a specified native namespace:

        >>> def agnostic_read_parquet(native_namespace: ModuleType) -> IntoDataFrame:
        ...     return nw.read_parquet(
        ...         "file.parquet", native_namespace=native_namespace
        ...     ).to_native()

        Then we can read the file by passing pandas, Polars or PyArrow namespaces:

        >>> agnostic_read_parquet(native_namespace=pd)  # doctest:+SKIP
           a  b
        0  1  4
        1  2  5
        2  3  6
        >>> agnostic_read_parquet(native_namespace=pl)  # doctest:+SKIP
        shape: (3, 2)
        ┌─────┬─────┐
        │ a   ┆ b   │
        │ --- ┆ --- │
        │ i64 ┆ i64 │
        ╞═════╪═════╡
        │ 1   ┆ 4   │
        │ 2   ┆ 5   │
        │ 3   ┆ 6   │
        └─────┴─────┘
        >>> agnostic_read_parquet(native_namespace=pa)  # doctest:+SKIP
        pyarrow.Table
        a: int64
        b: int64
        ----
        a: [[1,2,3]]
        b: [[4,5,6]]
    """
    return _read_parquet_impl(source, native_namespace=native_namespace, **kwargs)


def _read_parquet_impl(
    source: str, *, native_namespace: ModuleType, **kwargs: Any
) -> DataFrame[Any]:
    implementation = Implementation.from_native_namespace(native_namespace)
    if implementation in (
        Implementation.POLARS,
        Implementation.PANDAS,
        Implementation.MODIN,
        Implementation.CUDF,
        Implementation.DUCKDB,
    ):
        native_frame = native_namespace.read_parquet(source, **kwargs)
    elif implementation is Implementation.PYARROW:
        import pyarrow.parquet as pq  # ignore-banned-import

        native_frame = pq.read_table(source, **kwargs)
    else:  # pragma: no cover
        try:
            # implementation is UNKNOWN, Narwhals extension using this feature should
            # implement `read_parquet` function in the top-level namespace.
            native_frame = native_namespace.read_parquet(source=source, **kwargs)
        except AttributeError as e:
            msg = "Unknown namespace is expected to implement `read_parquet` function."
            raise AttributeError(msg) from e
    return from_native(native_frame, eager_only=True)


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

    Examples:
        >>> import dask.dataframe as dd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrame
        >>> from types import ModuleType

        Let's create an agnostic function that lazily reads a parquet file with a specified native namespace:

        >>> def agnostic_scan_parquet(native_namespace: ModuleType) -> IntoFrame:
        ...     return nw.scan_parquet(
        ...         "file.parquet", native_namespace=native_namespace
        ...     ).to_native()

        Then we can read the file by passing, for example, Polars or Dask namespaces:

        >>> agnostic_scan_parquet(native_namespace=pl).collect()  # doctest:+SKIP
        shape: (3, 2)
        ┌─────┬─────┐
        │ a   ┆ b   │
        │ --- ┆ --- │
        │ i64 ┆ i64 │
        ╞═════╪═════╡
        │ 1   ┆ 4   │
        │ 2   ┆ 5   │
        │ 3   ┆ 6   │
        └─────┴─────┘
        >>> agnostic_scan_parquet(native_namespace=dd).compute()  # doctest:+SKIP
           a  b
        0  1  4
        1  2  5
        2  3  6
    """
    return _scan_parquet_impl(source, native_namespace=native_namespace, **kwargs)


def _scan_parquet_impl(
    source: str, *, native_namespace: ModuleType, **kwargs: Any
) -> LazyFrame[Any]:
    implementation = Implementation.from_native_namespace(native_namespace)
    if implementation is Implementation.POLARS:
        native_frame = native_namespace.scan_parquet(source, **kwargs)
    elif implementation in (
        Implementation.PANDAS,
        Implementation.MODIN,
        Implementation.CUDF,
        Implementation.DASK,
        Implementation.DUCKDB,
    ):
        native_frame = native_namespace.read_parquet(source, **kwargs)
    elif implementation is Implementation.PYARROW:
        import pyarrow.parquet as pq  # ignore-banned-import

        native_frame = pq.read_table(source, **kwargs)
    else:  # pragma: no cover
        try:
            # implementation is UNKNOWN, Narwhals extension using this feature should
            # implement `scan_parquet` function in the top-level namespace.
            native_frame = native_namespace.scan_parquet(source=source, **kwargs)
        except AttributeError as e:
            msg = "Unknown namespace is expected to implement `scan_parquet` function."
            raise AttributeError(msg) from e
    return from_native(native_frame).lazy()


def col(*names: str | Iterable[str]) -> Expr:
    """Creates an expression that references one or more columns by their name(s).

    Arguments:
        names: Name(s) of the columns to use.

    Returns:
        A new expression.

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [1, 2], "b": [3, 4]}
        >>> df_pl = pl.DataFrame(data)
        >>> df_pd = pd.DataFrame(data)
        >>> df_pa = pa.table(data)

        We define a dataframe-agnostic function:

        >>> def agnostic_col(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.col("a") * nw.col("b")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_col`:

        >>> agnostic_col(df_pd)
           a
        0  3
        1  8

        >>> agnostic_col(df_pl)
        shape: (2, 1)
        ┌─────┐
        │ a   │
        │ --- │
        │ i64 │
        ╞═════╡
        │ 3   │
        │ 8   │
        └─────┘

        >>> agnostic_col(df_pa)
        pyarrow.Table
        a: int64
        ----
        a: [[3,8]]
    """

    def func(plx: Any) -> Any:
        return plx.col(*flatten(names))

    return Expr(func)


def nth(*indices: int | Sequence[int]) -> Expr:
    """Creates an expression that references one or more columns by their index(es).

    Notes:
        `nth` is not supported for Polars version<1.0.0. Please use
        [`narwhals.col`][] instead.

    Arguments:
        indices: One or more indices representing the columns to retrieve.

    Returns:
        A new expression.

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [1, 2], "b": [3, 4]}
        >>> df_pl = pl.DataFrame(data)
        >>> df_pd = pd.DataFrame(data)
        >>> df_pa = pa.table(data)

        We define a dataframe-agnostic function:

        >>> def agnostic_nth(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.nth(0) * 2).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to `agnostic_nth`:

        >>> agnostic_nth(df_pd)
           a
        0  2
        1  4

        >>> agnostic_nth(df_pl)
        shape: (2, 1)
        ┌─────┐
        │ a   │
        │ --- │
        │ i64 │
        ╞═════╡
        │ 2   │
        │ 4   │
        └─────┘

        >>> agnostic_nth(df_pa)
        pyarrow.Table
        a: int64
        ----
        a: [[2,4]]
    """

    def func(plx: Any) -> Any:
        return plx.nth(*flatten(indices))

    return Expr(func)


# Add underscore so it doesn't conflict with builtin `all`
def all_() -> Expr:
    """Instantiate an expression representing all columns.

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

        >>> def agnostic_all(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.all() * 2).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_all`:

        >>> agnostic_all(df_pd)
           a   b
        0  2   8
        1  4  10
        2  6  12

        >>> agnostic_all(df_pl)
        shape: (3, 2)
        ┌─────┬─────┐
        │ a   ┆ b   │
        │ --- ┆ --- │
        │ i64 ┆ i64 │
        ╞═════╪═════╡
        │ 2   ┆ 8   │
        │ 4   ┆ 10  │
        │ 6   ┆ 12  │
        └─────┴─────┘

        >>> agnostic_all(df_pa)
        pyarrow.Table
        a: int64
        b: int64
        ----
        a: [[2,4,6]]
        b: [[8,10,12]]
    """
    return Expr(lambda plx: plx.all())


# Add underscore so it doesn't conflict with builtin `len`
def len_() -> Expr:
    """Return the number of rows.

    Returns:
        A new expression.

    Examples:
        >>> import polars as pl
        >>> import pandas as pd
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [1, 2], "b": [5, 10]}
        >>> df_pd = pd.DataFrame(data)
        >>> df_pl = pl.DataFrame(data)
        >>> df_pa = pa.table(data)

        Let's define a dataframe-agnostic function:

        >>> def agnostic_len(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.len()).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_len`:

        >>> agnostic_len(df_pd)
           len
        0    2
        >>> agnostic_len(df_pl)
        shape: (1, 1)
        ┌─────┐
        │ len │
        │ --- │
        │ u32 │
        ╞═════╡
        │ 2   │
        └─────┘
        >>> agnostic_len(df_pa)
        pyarrow.Table
        len: int64
        ----
        len: [[2]]
    """

    def func(plx: Any) -> Any:
        return plx.len()

    return Expr(func)


def sum(*columns: str) -> Expr:
    """Sum all values.

    Note:
        Syntactic sugar for ``nw.col(columns).sum()``

    Arguments:
        columns: Name(s) of the columns to use in the aggregation function

    Returns:
        A new expression.

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [1, 2]}
        >>> df_pl = pl.DataFrame(data)
        >>> df_pd = pd.DataFrame(data)
        >>> df_pa = pa.table(data)

        We define a dataframe-agnostic function:

        >>> def agnostic_sum(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.sum("a")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_sum`:

        >>> agnostic_sum(df_pd)
           a
        0  3

        >>> agnostic_sum(df_pl)
        shape: (1, 1)
        ┌─────┐
        │ a   │
        │ --- │
        │ i64 │
        ╞═════╡
        │ 3   │
        └─────┘

        >>> agnostic_sum(df_pa)
        pyarrow.Table
        a: int64
        ----
        a: [[3]]
    """
    return Expr(lambda plx: plx.col(*columns).sum())


def mean(*columns: str) -> Expr:
    """Get the mean value.

    Note:
        Syntactic sugar for ``nw.col(columns).mean()``

    Arguments:
        columns: Name(s) of the columns to use in the aggregation function

    Returns:
        A new expression.

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [1, 8, 3]}
        >>> df_pl = pl.DataFrame(data)
        >>> df_pd = pd.DataFrame(data)
        >>> df_pa = pa.table(data)

        We define a dataframe agnostic function:

        >>> def agnostic_mean(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.mean("a")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_mean`:

        >>> agnostic_mean(df_pd)
             a
        0  4.0

        >>> agnostic_mean(df_pl)
        shape: (1, 1)
        ┌─────┐
        │ a   │
        │ --- │
        │ f64 │
        ╞═════╡
        │ 4.0 │
        └─────┘

        >>> agnostic_mean(df_pa)
        pyarrow.Table
        a: double
        ----
        a: [[4]]
    """
    return Expr(lambda plx: plx.col(*columns).mean())


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

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [4, 5, 2]}
        >>> df_pd = pd.DataFrame(data)
        >>> df_pl = pl.DataFrame(data)
        >>> df_pa = pa.table(data)

        Let's define a dataframe agnostic function:

        >>> def agnostic_median(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.median("a")).to_native()

        We can then pass any supported library such as pandas, Polars, or
        PyArrow to `agnostic_median`:

        >>> agnostic_median(df_pd)
             a
        0  4.0

        >>> agnostic_median(df_pl)
        shape: (1, 1)
        ┌─────┐
        │ a   │
        │ --- │
        │ f64 │
        ╞═════╡
        │ 4.0 │
        └─────┘

        >>> agnostic_median(df_pa)
        pyarrow.Table
        a: double
        ----
        a: [[4]]
    """
    return Expr(lambda plx: plx.col(*columns).median())


def min(*columns: str) -> Expr:
    """Return the minimum value.

    Note:
       Syntactic sugar for ``nw.col(columns).min()``.

    Arguments:
        columns: Name(s) of the columns to use in the aggregation function.

    Returns:
        A new expression.

    Examples:
        >>> import polars as pl
        >>> import pandas as pd
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [1, 2], "b": [5, 10]}
        >>> df_pd = pd.DataFrame(data)
        >>> df_pl = pl.DataFrame(data)
        >>> df_pa = pa.table(data)

        Let's define a dataframe-agnostic function:

        >>> def agnostic_min(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.min("b")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_min`:

        >>> agnostic_min(df_pd)
           b
        0  5

        >>> agnostic_min(df_pl)
        shape: (1, 1)
        ┌─────┐
        │ b   │
        │ --- │
        │ i64 │
        ╞═════╡
        │ 5   │
        └─────┘

        >>> agnostic_min(df_pa)
        pyarrow.Table
        b: int64
        ----
        b: [[5]]
    """
    return Expr(lambda plx: plx.col(*columns).min())


def max(*columns: str) -> Expr:
    """Return the maximum value.

    Note:
       Syntactic sugar for ``nw.col(columns).max()``.

    Arguments:
        columns: Name(s) of the columns to use in the aggregation function.

    Returns:
        A new expression.

    Examples:
        >>> import polars as pl
        >>> import pandas as pd
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [1, 2], "b": [5, 10]}
        >>> df_pd = pd.DataFrame(data)
        >>> df_pl = pl.DataFrame(data)
        >>> df_pa = pa.table(data)

        Let's define a dataframe-agnostic function:

        >>> def agnostic_max(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.max("a")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_max`:

        >>> agnostic_max(df_pd)
           a
        0  2

        >>> agnostic_max(df_pl)
        shape: (1, 1)
        ┌─────┐
        │ a   │
        │ --- │
        │ i64 │
        ╞═════╡
        │ 2   │
        └─────┘

        >>> agnostic_max(df_pa)
        pyarrow.Table
        a: int64
        ----
        a: [[2]]
    """
    return Expr(lambda plx: plx.col(*columns).max())


def sum_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    """Sum all values horizontally across columns.

    Warning:
        Unlike Polars, we support horizontal sum over numeric columns only.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

    Returns:
        A new expression.

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [1, 2, 3], "b": [5, 10, None]}
        >>> df_pl = pl.DataFrame(data)
        >>> df_pd = pd.DataFrame(data)
        >>> df_pa = pa.table(data)

        We define a dataframe-agnostic function:

        >>> def agnostic_sum_horizontal(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.sum_horizontal("a", "b")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to `agnostic_sum_horizontal`:

        >>> agnostic_sum_horizontal(df_pd)
              a
        0   6.0
        1  12.0
        2   3.0

        >>> agnostic_sum_horizontal(df_pl)
        shape: (3, 1)
        ┌─────┐
        │ a   │
        │ --- │
        │ i64 │
        ╞═════╡
        │ 6   │
        │ 12  │
        │ 3   │
        └─────┘

        >>> agnostic_sum_horizontal(df_pa)
        pyarrow.Table
        a: int64
        ----
        a: [[6,12,3]]
    """
    if not exprs:
        msg = "At least one expression must be passed to `sum_horizontal`"
        raise ValueError(msg)
    return Expr(
        lambda plx: plx.sum_horizontal(
            *[extract_compliant(plx, v) for v in flatten(exprs)]
        )
    )


def min_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    """Get the minimum value horizontally across columns.

    Notes:
        We support `min_horizontal` over numeric columns only.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

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
        ...     "a": [1, 8, 3],
        ...     "b": [4, 5, None],
        ...     "c": ["x", "y", "z"],
        ... }

        We define a dataframe-agnostic function that computes the horizontal min of "a"
        and "b" columns:

        >>> def agnostic_min_horizontal(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.min_horizontal("a", "b")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_min_horizontal`:

        >>> agnostic_min_horizontal(pd.DataFrame(data))
             a
        0  1.0
        1  5.0
        2  3.0

        >>> agnostic_min_horizontal(pl.DataFrame(data))
        shape: (3, 1)
        ┌─────┐
        │ a   │
        │ --- │
        │ i64 │
        ╞═════╡
        │ 1   │
        │ 5   │
        │ 3   │
        └─────┘

        >>> agnostic_min_horizontal(pa.table(data))
        pyarrow.Table
        a: int64
        ----
        a: [[1,5,3]]
    """
    if not exprs:
        msg = "At least one expression must be passed to `min_horizontal`"
        raise ValueError(msg)
    return Expr(
        lambda plx: plx.min_horizontal(
            *[extract_compliant(plx, v) for v in flatten(exprs)]
        )
    )


def max_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    """Get the maximum value horizontally across columns.

    Notes:
        We support `max_horizontal` over numeric columns only.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

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
        ...     "a": [1, 8, 3],
        ...     "b": [4, 5, None],
        ...     "c": ["x", "y", "z"],
        ... }

        We define a dataframe-agnostic function that computes the horizontal max of "a"
        and "b" columns:

        >>> def agnostic_max_horizontal(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.max_horizontal("a", "b")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_max_horizontal`:

        >>> agnostic_max_horizontal(pd.DataFrame(data))
             a
        0  4.0
        1  8.0
        2  3.0

        >>> agnostic_max_horizontal(pl.DataFrame(data))
        shape: (3, 1)
        ┌─────┐
        │ a   │
        │ --- │
        │ i64 │
        ╞═════╡
        │ 4   │
        │ 8   │
        │ 3   │
        └─────┘

        >>> agnostic_max_horizontal(pa.table(data))
        pyarrow.Table
        a: int64
        ----
        a: [[4,8,3]]
    """
    if not exprs:
        msg = "At least one expression must be passed to `max_horizontal`"
        raise ValueError(msg)
    return Expr(
        lambda plx: plx.max_horizontal(
            *[extract_compliant(plx, v) for v in flatten(exprs)]
        )
    )


class When:
    def __init__(self, *predicates: IntoExpr | Iterable[IntoExpr]) -> None:
        self._predicates = flatten([predicates])
        if not self._predicates:
            msg = "At least one predicate needs to be provided to `narwhals.when`."
            raise TypeError(msg)

    def _extract_predicates(self, plx: Any) -> Any:
        return [extract_compliant(plx, v) for v in self._predicates]

    def then(self, value: Any) -> Then:
        return Then(
            lambda plx: plx.when(*self._extract_predicates(plx)).then(
                extract_compliant(plx, value)
            )
        )


class Then(Expr):
    def otherwise(self, value: Any) -> Expr:
        return Expr(
            lambda plx: self._to_compliant_expr(plx).otherwise(
                extract_compliant(plx, value)
            )
        )


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

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [1, 2, 3], "b": [5, 10, 15]}
        >>> df_pl = pl.DataFrame(data)
        >>> df_pd = pd.DataFrame(data)
        >>> df_pa = pa.table(data)

        We define a dataframe-agnostic function:

        >>> def agnostic_when_then_otherwise(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.with_columns(
        ...         nw.when(nw.col("a") < 3).then(5).otherwise(6).alias("a_when")
        ...     ).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_when_then_otherwise`:

        >>> agnostic_when_then_otherwise(df_pd)
           a   b  a_when
        0  1   5       5
        1  2  10       5
        2  3  15       6

        >>> agnostic_when_then_otherwise(df_pl)
        shape: (3, 3)
        ┌─────┬─────┬────────┐
        │ a   ┆ b   ┆ a_when │
        │ --- ┆ --- ┆ ---    │
        │ i64 ┆ i64 ┆ i32    │
        ╞═════╪═════╪════════╡
        │ 1   ┆ 5   ┆ 5      │
        │ 2   ┆ 10  ┆ 5      │
        │ 3   ┆ 15  ┆ 6      │
        └─────┴─────┴────────┘

        >>> agnostic_when_then_otherwise(df_pa)
        pyarrow.Table
        a: int64
        b: int64
        a_when: int64
        ----
        a: [[1,2,3]]
        b: [[5,10,15]]
        a_when: [[5,5,6]]
    """
    return When(*predicates)


def all_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    r"""Compute the bitwise AND horizontally across columns.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

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
        ...     "a": [False, False, True, True, False, None],
        ...     "b": [False, True, True, None, None, None],
        ... }
        >>> df_pl = pl.DataFrame(data)
        >>> df_pd = pd.DataFrame(data).convert_dtypes(dtype_backend="pyarrow")
        >>> df_pa = pa.table(data)

        We define a dataframe-agnostic function:

        >>> def agnostic_all_horizontal(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select("a", "b", all=nw.all_horizontal("a", "b")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_all_horizontal`:

        >>> agnostic_all_horizontal(df_pd)
               a      b    all
        0  False  False  False
        1  False   True  False
        2   True   True   True
        3   True   <NA>   <NA>
        4  False   <NA>  False
        5   <NA>   <NA>   <NA>

        >>> agnostic_all_horizontal(df_pl)
        shape: (6, 3)
        ┌───────┬───────┬───────┐
        │ a     ┆ b     ┆ all   │
        │ ---   ┆ ---   ┆ ---   │
        │ bool  ┆ bool  ┆ bool  │
        ╞═══════╪═══════╪═══════╡
        │ false ┆ false ┆ false │
        │ false ┆ true  ┆ false │
        │ true  ┆ true  ┆ true  │
        │ true  ┆ null  ┆ null  │
        │ false ┆ null  ┆ false │
        │ null  ┆ null  ┆ null  │
        └───────┴───────┴───────┘

        >>> agnostic_all_horizontal(df_pa)
        pyarrow.Table
        a: bool
        b: bool
        all: bool
        ----
        a: [[false,false,true,true,false,null]]
        b: [[false,true,true,null,null,null]]
        all: [[false,false,true,null,false,null]]
    """
    if not exprs:
        msg = "At least one expression must be passed to `all_horizontal`"
        raise ValueError(msg)
    return Expr(
        lambda plx: plx.all_horizontal(
            *[extract_compliant(plx, v) for v in flatten(exprs)]
        )
    )


def lit(value: Any, dtype: DType | type[DType] | None = None) -> Expr:
    """Return an expression representing a literal value.

    Arguments:
        value: The value to use as literal.
        dtype: The data type of the literal value. If not provided, the data type will
            be inferred.

    Returns:
        A new expression.

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {"a": [1, 2]}
        >>> df_pl = pl.DataFrame(data)
        >>> df_pd = pd.DataFrame(data)
        >>> df_pa = pa.table(data)

        We define a dataframe-agnostic function:

        >>> def agnostic_lit(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.with_columns(nw.lit(3)).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_lit`:

        >>> agnostic_lit(df_pd)
           a  literal
        0  1        3
        1  2        3

        >>> agnostic_lit(df_pl)
        shape: (2, 2)
        ┌─────┬─────────┐
        │ a   ┆ literal │
        │ --- ┆ ---     │
        │ i64 ┆ i32     │
        ╞═════╪═════════╡
        │ 1   ┆ 3       │
        │ 2   ┆ 3       │
        └─────┴─────────┘

        >>> agnostic_lit(df_pa)
        pyarrow.Table
        a: int64
        literal: int64
        ----
        a: [[1,2]]
        literal: [[3,3]]
    """
    if is_numpy_array(value):
        msg = (
            "numpy arrays are not supported as literal values. "
            "Consider using `with_columns` to create a new column from the array."
        )
        raise ValueError(msg)

    if isinstance(value, (list, tuple)):
        msg = f"Nested datatypes are not supported yet. Got {value}"
        raise NotImplementedError(msg)

    return Expr(lambda plx: plx.lit(value, dtype))


def any_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    r"""Compute the bitwise OR horizontally across columns.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

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
        ...     "a": [False, False, True, True, False, None],
        ...     "b": [False, True, True, None, None, None],
        ... }
        >>> df_pl = pl.DataFrame(data)
        >>> df_pd = pd.DataFrame(data).convert_dtypes(dtype_backend="pyarrow")
        >>> df_pa = pa.table(data)

        We define a dataframe-agnostic function:

        >>> def agnostic_any_horizontal(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select("a", "b", any=nw.any_horizontal("a", "b")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_any_horizontal`:

        >>> agnostic_any_horizontal(df_pd)
               a      b    any
        0  False  False  False
        1  False   True   True
        2   True   True   True
        3   True   <NA>   True
        4  False   <NA>   <NA>
        5   <NA>   <NA>   <NA>

        >>> agnostic_any_horizontal(df_pl)
        shape: (6, 3)
        ┌───────┬───────┬───────┐
        │ a     ┆ b     ┆ any   │
        │ ---   ┆ ---   ┆ ---   │
        │ bool  ┆ bool  ┆ bool  │
        ╞═══════╪═══════╪═══════╡
        │ false ┆ false ┆ false │
        │ false ┆ true  ┆ true  │
        │ true  ┆ true  ┆ true  │
        │ true  ┆ null  ┆ true  │
        │ false ┆ null  ┆ null  │
        │ null  ┆ null  ┆ null  │
        └───────┴───────┴───────┘

        >>> agnostic_any_horizontal(df_pa)
        pyarrow.Table
        a: bool
        b: bool
        any: bool
        ----
        a: [[false,false,true,true,false,null]]
        b: [[false,true,true,null,null,null]]
        any: [[false,true,true,true,null,null]]
    """
    if not exprs:
        msg = "At least one expression must be passed to `any_horizontal`"
        raise ValueError(msg)
    return Expr(
        lambda plx: plx.any_horizontal(
            *[extract_compliant(plx, v) for v in flatten(exprs)]
        )
    )


def mean_horizontal(*exprs: IntoExpr | Iterable[IntoExpr]) -> Expr:
    """Compute the mean of all values horizontally across columns.

    Arguments:
        exprs: Name(s) of the columns to use in the aggregation function. Accepts
            expression input.

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
        ...     "a": [1, 8, 3],
        ...     "b": [4, 5, None],
        ...     "c": ["x", "y", "z"],
        ... }
        >>> df_pl = pl.DataFrame(data)
        >>> df_pd = pd.DataFrame(data)
        >>> df_pa = pa.table(data)

        We define a dataframe-agnostic function that computes the horizontal mean of "a"
        and "b" columns:

        >>> def agnostic_mean_horizontal(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(nw.mean_horizontal("a", "b")).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow to
        `agnostic_mean_horizontal`:

        >>> agnostic_mean_horizontal(df_pd)
             a
        0  2.5
        1  6.5
        2  3.0

        >>> agnostic_mean_horizontal(df_pl)
        shape: (3, 1)
        ┌─────┐
        │ a   │
        │ --- │
        │ f64 │
        ╞═════╡
        │ 2.5 │
        │ 6.5 │
        │ 3.0 │
        └─────┘

        >>> agnostic_mean_horizontal(df_pa)
        pyarrow.Table
        a: double
        ----
        a: [[2.5,6.5,3]]
    """
    if not exprs:
        msg = "At least one expression must be passed to `mean_horizontal`"
        raise ValueError(msg)
    return Expr(
        lambda plx: plx.mean_horizontal(
            *[extract_compliant(plx, v) for v in flatten(exprs)]
        )
    )


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

    Examples:
        >>> import pandas as pd
        >>> import polars as pl
        >>> import pyarrow as pa
        >>> import narwhals as nw
        >>> from narwhals.typing import IntoFrameT
        >>>
        >>> data = {
        ...     "a": [1, 2, 3],
        ...     "b": ["dogs", "cats", None],
        ...     "c": ["play", "swim", "walk"],
        ... }

        We define a dataframe-agnostic function that computes the horizontal string
        concatenation of different columns

        >>> def agnostic_concat_str(df_native: IntoFrameT) -> IntoFrameT:
        ...     df = nw.from_native(df_native)
        ...     return df.select(
        ...         nw.concat_str(
        ...             [
        ...                 nw.col("a") * 2,
        ...                 nw.col("b"),
        ...                 nw.col("c"),
        ...             ],
        ...             separator=" ",
        ...         ).alias("full_sentence")
        ...     ).to_native()

        We can pass any supported library such as Pandas, Polars, or PyArrow
        to `agnostic_concat_str`:

        >>> agnostic_concat_str(pd.DataFrame(data))
          full_sentence
        0   2 dogs play
        1   4 cats swim
        2          None

        >>> agnostic_concat_str(pl.DataFrame(data))
        shape: (3, 1)
        ┌───────────────┐
        │ full_sentence │
        │ ---           │
        │ str           │
        ╞═══════════════╡
        │ 2 dogs play   │
        │ 4 cats swim   │
        │ null          │
        └───────────────┘

        >>> agnostic_concat_str(pa.table(data))
        pyarrow.Table
        full_sentence: string
        ----
        full_sentence: [["2 dogs play","4 cats swim",null]]
    """
    return Expr(
        lambda plx: plx.concat_str(
            [extract_compliant(plx, v) for v in flatten([exprs])],
            *[extract_compliant(plx, v) for v in more_exprs],
            separator=separator,
            ignore_nulls=ignore_nulls,
        )
    )
