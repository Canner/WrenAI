from __future__ import annotations

import re
import warnings
from functools import lru_cache
from typing import TYPE_CHECKING
from typing import Any
from typing import Iterable
from typing import Literal
from typing import Sequence
from typing import TypeVar

from narwhals._arrow.utils import (
    narwhals_to_native_dtype as arrow_narwhals_to_native_dtype,
)
from narwhals._arrow.utils import (
    native_to_narwhals_dtype as arrow_native_to_narwhals_dtype,
)
from narwhals.exceptions import ColumnNotFoundError
from narwhals.utils import Implementation
from narwhals.utils import import_dtypes_module
from narwhals.utils import isinstance_or_issubclass

T = TypeVar("T")

if TYPE_CHECKING:
    from narwhals._pandas_like.dataframe import PandasLikeDataFrame
    from narwhals._pandas_like.expr import PandasLikeExpr
    from narwhals._pandas_like.series import PandasLikeSeries
    from narwhals.dtypes import DType
    from narwhals.utils import Version

    ExprT = TypeVar("ExprT", bound=PandasLikeExpr)
    import pandas as pd


PANDAS_LIKE_IMPLEMENTATION = {
    Implementation.PANDAS,
    Implementation.CUDF,
    Implementation.MODIN,
}
PD_DATETIME_RGX = r"""^
    datetime64\[
        (?P<time_unit>s|ms|us|ns)                 # Match time unit: s, ms, us, or ns
        (?:,                                      # Begin non-capturing group for optional timezone
            \s*                                   # Optional whitespace after comma
            (?P<time_zone>                        # Start named group for timezone
                [a-zA-Z\/]+                       # Match timezone name, e.g., UTC, America/New_York
                (?:[+-]\d{2}:\d{2})?              # Optional offset in format +HH:MM or -HH:MM
                |                                 # OR
                pytz\.FixedOffset\(\d+\)          # Match pytz.FixedOffset with integer offset in parentheses
            )                                     # End time_zone group
        )?                                        # End optional timezone group
    \]                                            # Closing bracket for datetime64
$"""
PATTERN_PD_DATETIME = re.compile(PD_DATETIME_RGX, re.VERBOSE)
PA_DATETIME_RGX = r"""^
    timestamp\[
        (?P<time_unit>s|ms|us|ns)                 # Match time unit: s, ms, us, or ns
        (?:,                                      # Begin non-capturing group for optional timezone
            \s?tz=                                # Match "tz=" prefix
            (?P<time_zone>                        # Start named group for timezone
                [a-zA-Z\/]*                       # Match timezone name (e.g., UTC, America/New_York)
                (?:                               # Begin optional non-capturing group for offset
                    [+-]\d{2}:\d{2}               # Match offset in format +HH:MM or -HH:MM
                )?                                # End optional offset group
            )                                     # End time_zone group
        )?                                        # End optional timezone group
    \]                                            # Closing bracket for timestamp
    \[pyarrow\]                                   # Literal string "[pyarrow]"
$"""
PATTERN_PA_DATETIME = re.compile(PA_DATETIME_RGX, re.VERBOSE)
PD_DURATION_RGX = r"""^
    timedelta64\[
        (?P<time_unit>s|ms|us|ns)                 # Match time unit: s, ms, us, or ns
    \]                                            # Closing bracket for timedelta64
$"""

PATTERN_PD_DURATION = re.compile(PD_DURATION_RGX, re.VERBOSE)
PA_DURATION_RGX = r"""^
    duration\[
        (?P<time_unit>s|ms|us|ns)                 # Match time unit: s, ms, us, or ns
    \]                                            # Closing bracket for duration
    \[pyarrow\]                                   # Literal string "[pyarrow]"
$"""
PATTERN_PA_DURATION = re.compile(PA_DURATION_RGX, re.VERBOSE)


def broadcast_align_and_extract_native(
    lhs: PandasLikeSeries, rhs: Any
) -> tuple[pd.Series, Any]:
    """Validate RHS of binary operation.

    If the comparison isn't supported, return `NotImplemented` so that the
    "right-hand-side" operation (e.g. `__radd__`) can be tried.

    If RHS is length 1, return the scalar value, so that the underlying
    library can broadcast it.
    """
    from narwhals._pandas_like.dataframe import PandasLikeDataFrame
    from narwhals._pandas_like.series import PandasLikeSeries

    # If `rhs` is the output of an expression evaluation, then it is
    # a list of Series. So, we verify that that list is of length-1,
    # and take the first (and only) element.
    if isinstance(rhs, list):
        if len(rhs) > 1:
            if hasattr(rhs[0], "__narwhals_expr__") or hasattr(
                rhs[0], "__narwhals_series__"
            ):
                # e.g. `plx.all() + plx.all()`
                msg = "Multi-output expressions (e.g. `nw.all()` or `nw.col('a', 'b')`) are not supported in this context"
                raise ValueError(msg)
            msg = f"Expected scalar value, Series, or Expr, got list of : {type(rhs[0])}"
            raise ValueError(msg)
        rhs = rhs[0]

    lhs_index = lhs._native_series.index

    if isinstance(rhs, PandasLikeDataFrame):
        return NotImplemented  # type: ignore[no-any-return]

    if isinstance(rhs, PandasLikeSeries):
        rhs_index = rhs._native_series.index
        if rhs.len() == 1:
            # broadcast
            s = rhs._native_series
            return (
                lhs._native_series,
                s.__class__(s.iloc[0], index=lhs_index, dtype=s.dtype),
            )
        if lhs.len() == 1:
            # broadcast
            s = lhs._native_series
            return (
                s.__class__(s.iloc[0], index=rhs_index, dtype=s.dtype, name=s.name),
                rhs._native_series,
            )
        if rhs._native_series.index is not lhs_index:
            return (
                lhs._native_series,
                set_index(
                    rhs._native_series,
                    lhs_index,
                    implementation=rhs._implementation,
                    backend_version=rhs._backend_version,
                ),
            )
        return (lhs._native_series, rhs._native_series)

    # `rhs` must be scalar, so just leave it as-is
    return lhs._native_series, rhs


def validate_dataframe_comparand(index: Any, other: Any) -> Any:
    """Validate RHS of binary operation.

    If the comparison isn't supported, return `NotImplemented` so that the
    "right-hand-side" operation (e.g. `__radd__`) can be tried.
    """
    from narwhals._pandas_like.dataframe import PandasLikeDataFrame
    from narwhals._pandas_like.series import PandasLikeSeries

    if isinstance(other, PandasLikeDataFrame):
        return NotImplemented
    if isinstance(other, PandasLikeSeries):
        if other.len() == 1:
            # broadcast
            s = other._native_series
            return s.__class__(s.iloc[0], index=index, dtype=s.dtype, name=s.name)
        if other._native_series.index is not index:
            return set_index(
                other._native_series,
                index,
                implementation=other._implementation,
                backend_version=other._backend_version,
            )
        return other._native_series
    msg = "Please report a bug"  # pragma: no cover
    raise AssertionError(msg)


def create_compliant_series(
    iterable: Any,
    index: Any = None,
    *,
    implementation: Implementation,
    backend_version: tuple[int, ...],
    version: Version,
) -> PandasLikeSeries:
    from narwhals._pandas_like.series import PandasLikeSeries

    if implementation in PANDAS_LIKE_IMPLEMENTATION:
        series = implementation.to_native_namespace().Series(
            iterable, index=index, name=""
        )
        return PandasLikeSeries(
            series,
            implementation=implementation,
            backend_version=backend_version,
            version=version,
        )
    else:  # pragma: no cover
        msg = f"Expected pandas-like implementation ({PANDAS_LIKE_IMPLEMENTATION}), found {implementation}"
        raise TypeError(msg)


def horizontal_concat(
    dfs: list[Any], *, implementation: Implementation, backend_version: tuple[int, ...]
) -> Any:
    """Concatenate (native) DataFrames horizontally.

    Should be in namespace.
    """
    if implementation is Implementation.CUDF:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message="The behavior of array concatenation with empty entries is deprecated",
                category=FutureWarning,
            )
            return implementation.to_native_namespace().concat(dfs, axis=1)

    if implementation.is_pandas_like():
        extra_kwargs = (
            {"copy": False}
            if implementation is Implementation.PANDAS and backend_version < (3,)
            else {}
        )
        return implementation.to_native_namespace().concat(dfs, axis=1, **extra_kwargs)

    else:  # pragma: no cover
        msg = f"Expected pandas-like implementation ({PANDAS_LIKE_IMPLEMENTATION}), found {implementation}"
        raise TypeError(msg)


def vertical_concat(
    dfs: list[Any], *, implementation: Implementation, backend_version: tuple[int, ...]
) -> Any:
    """Concatenate (native) DataFrames vertically.

    Should be in namespace.
    """
    if not dfs:
        msg = "No dataframes to concatenate"  # pragma: no cover
        raise AssertionError(msg)
    cols_0 = dfs[0].columns
    for i, df in enumerate(dfs[1:], start=1):
        cols_current = df.columns
        if not ((len(cols_current) == len(cols_0)) and (cols_current == cols_0).all()):
            msg = (
                "unable to vstack, column names don't match:\n"
                f"   - dataframe 0: {cols_0.to_list()}\n"
                f"   - dataframe {i}: {cols_current.to_list()}\n"
            )
            raise TypeError(msg)

    if implementation in PANDAS_LIKE_IMPLEMENTATION:
        extra_kwargs = (
            {"copy": False}
            if implementation is Implementation.PANDAS and backend_version < (3,)
            else {}
        )
        return implementation.to_native_namespace().concat(dfs, axis=0, **extra_kwargs)

    else:  # pragma: no cover
        msg = f"Expected pandas-like implementation ({PANDAS_LIKE_IMPLEMENTATION}), found {implementation}"
        raise TypeError(msg)


def diagonal_concat(
    dfs: list[Any], *, implementation: Implementation, backend_version: tuple[int, ...]
) -> Any:
    """Concatenate (native) DataFrames diagonally.

    Should be in namespace.
    """
    if not dfs:
        msg = "No dataframes to concatenate"  # pragma: no cover
        raise AssertionError(msg)

    if implementation in PANDAS_LIKE_IMPLEMENTATION:
        extra_kwargs = (
            {"copy": False, "sort": False}
            if implementation is Implementation.PANDAS and backend_version < (1,)
            else {"copy": False}
            if implementation is Implementation.PANDAS and backend_version < (3,)
            else {}
        )
        return implementation.to_native_namespace().concat(dfs, axis=0, **extra_kwargs)

    else:  # pragma: no cover
        msg = f"Expected pandas-like implementation ({PANDAS_LIKE_IMPLEMENTATION}), found {implementation}"
        raise TypeError(msg)


def native_series_from_iterable(
    data: Iterable[Any],
    name: str,
    index: Any,
    implementation: Implementation,
) -> Any:
    """Return native series."""
    if implementation in PANDAS_LIKE_IMPLEMENTATION:
        extra_kwargs = {"copy": False} if implementation is Implementation.PANDAS else {}
        if len(index) == 0:
            index = None
        return implementation.to_native_namespace().Series(
            data, name=name, index=index, **extra_kwargs
        )

    else:  # pragma: no cover
        msg = f"Expected pandas-like implementation ({PANDAS_LIKE_IMPLEMENTATION}), found {implementation}"
        raise TypeError(msg)


def set_index(
    obj: T,
    index: Any,
    *,
    implementation: Implementation,
    backend_version: tuple[int, ...],
) -> T:
    """Wrapper around pandas' set_axis to set object index.

    We can set `copy` / `inplace` based on implementation/version.
    """
    if implementation is Implementation.CUDF:  # pragma: no cover
        obj = obj.copy(deep=False)  # type: ignore[attr-defined]
        obj.index = index  # type: ignore[attr-defined]
        return obj
    if implementation is Implementation.PANDAS and (
        backend_version < (1,)
    ):  # pragma: no cover
        kwargs = {"inplace": False}
    else:
        kwargs = {}
    if implementation is Implementation.PANDAS and (
        (1, 5) <= backend_version < (3,)
    ):  # pragma: no cover
        kwargs["copy"] = False
    else:  # pragma: no cover
        pass
    return obj.set_axis(index, axis=0, **kwargs)  # type: ignore[attr-defined, no-any-return]


def set_columns(
    obj: T,
    columns: list[str],
    *,
    implementation: Implementation,
    backend_version: tuple[int, ...],
) -> T:
    """Wrapper around pandas' set_axis to set object columns.

    We can set `copy` / `inplace` based on implementation/version.
    """
    if implementation is Implementation.CUDF:  # pragma: no cover
        obj = obj.copy(deep=False)  # type: ignore[attr-defined]
        obj.columns = columns  # type: ignore[attr-defined]
        return obj
    if implementation is Implementation.PANDAS and (
        backend_version < (1,)
    ):  # pragma: no cover
        kwargs = {"inplace": False}
    else:
        kwargs = {}
    if implementation is Implementation.PANDAS and (
        (1, 5) <= backend_version < (3,)
    ):  # pragma: no cover
        kwargs["copy"] = False
    else:  # pragma: no cover
        pass
    return obj.set_axis(columns, axis=1, **kwargs)  # type: ignore[attr-defined, no-any-return]


def rename(
    obj: T,
    *args: Any,
    implementation: Implementation,
    backend_version: tuple[int, ...],
    **kwargs: Any,
) -> T:
    """Wrapper around pandas' rename so that we can set `copy` based on implementation/version."""
    if implementation is Implementation.PANDAS and (
        backend_version >= (3,)
    ):  # pragma: no cover
        return obj.rename(*args, **kwargs)  # type: ignore[attr-defined, no-any-return]
    return obj.rename(*args, **kwargs, copy=False)  # type: ignore[attr-defined, no-any-return]


@lru_cache(maxsize=16)
def non_object_native_to_narwhals_dtype(
    dtype: str, version: Version, _implementation: Implementation
) -> DType:
    dtypes = import_dtypes_module(version)
    if dtype in {"int64", "Int64", "Int64[pyarrow]", "int64[pyarrow]"}:
        return dtypes.Int64()
    if dtype in {"int32", "Int32", "Int32[pyarrow]", "int32[pyarrow]"}:
        return dtypes.Int32()
    if dtype in {"int16", "Int16", "Int16[pyarrow]", "int16[pyarrow]"}:
        return dtypes.Int16()
    if dtype in {"int8", "Int8", "Int8[pyarrow]", "int8[pyarrow]"}:
        return dtypes.Int8()
    if dtype in {"uint64", "UInt64", "UInt64[pyarrow]", "uint64[pyarrow]"}:
        return dtypes.UInt64()
    if dtype in {"uint32", "UInt32", "UInt32[pyarrow]", "uint32[pyarrow]"}:
        return dtypes.UInt32()
    if dtype in {"uint16", "UInt16", "UInt16[pyarrow]", "uint16[pyarrow]"}:
        return dtypes.UInt16()
    if dtype in {"uint8", "UInt8", "UInt8[pyarrow]", "uint8[pyarrow]"}:
        return dtypes.UInt8()
    if dtype in {
        "float64",
        "Float64",
        "Float64[pyarrow]",
        "float64[pyarrow]",
        "double[pyarrow]",
    }:
        return dtypes.Float64()
    if dtype in {
        "float32",
        "Float32",
        "Float32[pyarrow]",
        "float32[pyarrow]",
        "float[pyarrow]",
    }:
        return dtypes.Float32()
    if dtype in {"string", "string[python]", "string[pyarrow]", "large_string[pyarrow]"}:
        return dtypes.String()
    if dtype in {"bool", "boolean", "boolean[pyarrow]", "bool[pyarrow]"}:
        return dtypes.Boolean()
    if dtype == "category" or dtype.startswith("dictionary<"):
        return dtypes.Categorical()
    if (match_ := PATTERN_PD_DATETIME.match(dtype)) or (
        match_ := PATTERN_PA_DATETIME.match(dtype)
    ):
        dt_time_unit: Literal["us", "ns", "ms", "s"] = match_.group("time_unit")  # type: ignore[assignment]
        dt_time_zone: str | None = match_.group("time_zone")
        return dtypes.Datetime(dt_time_unit, dt_time_zone)
    if (match_ := PATTERN_PD_DURATION.match(dtype)) or (
        match_ := PATTERN_PA_DURATION.match(dtype)
    ):
        du_time_unit: Literal["us", "ns", "ms", "s"] = match_.group("time_unit")  # type: ignore[assignment]
        return dtypes.Duration(du_time_unit)
    if dtype == "date32[day][pyarrow]":
        return dtypes.Date()
    if dtype.startswith("decimal") and dtype.endswith("[pyarrow]"):
        return dtypes.Decimal()
    return dtypes.Unknown()  # pragma: no cover


def native_to_narwhals_dtype(
    native_column: Any, version: Version, implementation: Implementation
) -> DType:
    dtype = str(native_column.dtype)

    dtypes = import_dtypes_module(version)

    if dtype.startswith(("large_list", "list", "struct", "fixed_size_list")):
        if implementation is Implementation.CUDF:
            return arrow_native_to_narwhals_dtype(native_column.dtype.to_arrow(), version)
        return arrow_native_to_narwhals_dtype(native_column.dtype.pyarrow_dtype, version)
    if dtype != "object":
        return non_object_native_to_narwhals_dtype(dtype, version, implementation)
    if implementation is Implementation.DASK:
        # Dask columns are lazy, so we can't inspect values.
        # The most useful assumption is probably String
        return dtypes.String()
    if implementation is Implementation.PANDAS:  # pragma: no cover
        # This is the most efficient implementation for pandas,
        # and doesn't require the interchange protocol
        import pandas as pd

        dtype = pd.api.types.infer_dtype(native_column, skipna=True)
        if dtype == "string":
            return dtypes.String()
        return dtypes.Object()
    else:  # pragma: no cover
        df = native_column.to_frame()
        if hasattr(df, "__dataframe__"):
            from narwhals._interchange.dataframe import (
                map_interchange_dtype_to_narwhals_dtype,
            )

            try:
                return map_interchange_dtype_to_narwhals_dtype(
                    df.__dataframe__().get_column(0).dtype, version
                )
            except Exception:  # noqa: BLE001, S110
                pass
    return dtypes.Unknown()  # pragma: no cover


def get_dtype_backend(dtype: Any, implementation: Implementation) -> str:
    if implementation in [Implementation.PANDAS, Implementation.MODIN]:
        import pandas as pd

        if hasattr(pd, "ArrowDtype") and isinstance(dtype, pd.ArrowDtype):
            return "pyarrow-nullable"

        try:
            if isinstance(dtype, pd.core.dtypes.dtypes.BaseMaskedDtype):
                return "pandas-nullable"
        except AttributeError:  # pragma: no cover
            # defensive check for old pandas versions
            pass
        return "numpy"
    else:  # pragma: no cover
        return "numpy"


def narwhals_to_native_dtype(  # noqa: PLR0915
    dtype: DType | type[DType],
    starting_dtype: Any,
    implementation: Implementation,
    backend_version: tuple[int, ...],
    version: Version,
) -> Any:
    dtype_backend = get_dtype_backend(starting_dtype, implementation)
    dtypes = import_dtypes_module(version)
    if isinstance_or_issubclass(dtype, dtypes.Float64):
        if dtype_backend == "pyarrow-nullable":
            return "Float64[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "Float64"
        else:
            return "float64"
    if isinstance_or_issubclass(dtype, dtypes.Float32):
        if dtype_backend == "pyarrow-nullable":
            return "Float32[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "Float32"
        else:
            return "float32"
    if isinstance_or_issubclass(dtype, dtypes.Int64):
        if dtype_backend == "pyarrow-nullable":
            return "Int64[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "Int64"
        else:
            return "int64"
    if isinstance_or_issubclass(dtype, dtypes.Int32):
        if dtype_backend == "pyarrow-nullable":
            return "Int32[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "Int32"
        else:
            return "int32"
    if isinstance_or_issubclass(dtype, dtypes.Int16):
        if dtype_backend == "pyarrow-nullable":
            return "Int16[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "Int16"
        else:
            return "int16"
    if isinstance_or_issubclass(dtype, dtypes.Int8):
        if dtype_backend == "pyarrow-nullable":
            return "Int8[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "Int8"
        else:
            return "int8"
    if isinstance_or_issubclass(dtype, dtypes.UInt64):
        if dtype_backend == "pyarrow-nullable":
            return "UInt64[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "UInt64"
        else:
            return "uint64"
    if isinstance_or_issubclass(dtype, dtypes.UInt32):
        if dtype_backend == "pyarrow-nullable":
            return "UInt32[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "UInt32"
        else:
            return "uint32"
    if isinstance_or_issubclass(dtype, dtypes.UInt16):
        if dtype_backend == "pyarrow-nullable":
            return "UInt16[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "UInt16"
        else:
            return "uint16"
    if isinstance_or_issubclass(dtype, dtypes.UInt8):
        if dtype_backend == "pyarrow-nullable":
            return "UInt8[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "UInt8"
        else:
            return "uint8"
    if isinstance_or_issubclass(dtype, dtypes.String):
        if dtype_backend == "pyarrow-nullable":
            return "string[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "string"
        else:
            return str
    if isinstance_or_issubclass(dtype, dtypes.Boolean):
        if dtype_backend == "pyarrow-nullable":
            return "boolean[pyarrow]"
        if dtype_backend == "pandas-nullable":
            return "boolean"
        else:
            return "bool"
    if isinstance_or_issubclass(dtype, dtypes.Categorical):
        # TODO(Unassigned): is there no pyarrow-backed categorical?
        # or at least, convert_dtypes(dtype_backend='pyarrow') doesn't
        # convert to it?
        return "category"
    if isinstance_or_issubclass(dtype, dtypes.Datetime):
        dt_time_unit = getattr(dtype, "time_unit", "us")
        dt_time_zone = getattr(dtype, "time_zone", None)

        # Pandas does not support "ms" or "us" time units before version 2.0
        # Let's overwrite with "ns"
        if implementation is Implementation.PANDAS and backend_version < (
            2,
        ):  # pragma: no cover
            dt_time_unit = "ns"

        if dtype_backend == "pyarrow-nullable":
            tz_part = f", tz={dt_time_zone}" if dt_time_zone else ""
            return f"timestamp[{dt_time_unit}{tz_part}][pyarrow]"
        else:
            tz_part = f", {dt_time_zone}" if dt_time_zone else ""
            return f"datetime64[{dt_time_unit}{tz_part}]"
    if isinstance_or_issubclass(dtype, dtypes.Duration):
        du_time_unit = getattr(dtype, "time_unit", "us")
        if implementation is Implementation.PANDAS and backend_version < (
            2,
        ):  # pragma: no cover
            dt_time_unit = "ns"
        return (
            f"duration[{du_time_unit}][pyarrow]"
            if dtype_backend == "pyarrow-nullable"
            else f"timedelta64[{du_time_unit}]"
        )
    if isinstance_or_issubclass(dtype, dtypes.Date):
        try:
            import pyarrow as pa  # ignore-banned-import
        except ModuleNotFoundError:  # pragma: no cover
            msg = "PyArrow>=11.0.0 is required for `Date` dtype."
        return "date32[pyarrow]"
    if isinstance_or_issubclass(dtype, dtypes.Enum):
        msg = "Converting to Enum is not (yet) supported"
        raise NotImplementedError(msg)
    if isinstance_or_issubclass(dtype, dtypes.List):
        if implementation is Implementation.PANDAS and backend_version >= (2, 2):
            try:
                import pandas as pd
                import pyarrow as pa  # ignore-banned-import
            except ImportError as exc:  # pragma: no cover
                msg = f"Unable to convert to {dtype} to to the following exception: {exc.msg}"
                raise ImportError(msg) from exc

            return pd.ArrowDtype(
                pa.list_(
                    value_type=arrow_narwhals_to_native_dtype(
                        dtype.inner,  # type: ignore[union-attr]
                        version=version,
                    )
                )
            )
        else:  # pragma: no cover
            msg = (
                "Converting to List dtype is not supported for implementation "
                f"{implementation} and version {version}."
            )
            return NotImplementedError(msg)
    if isinstance_or_issubclass(dtype, dtypes.Struct):
        if implementation is Implementation.PANDAS and backend_version >= (2, 2):
            try:
                import pandas as pd
                import pyarrow as pa  # ignore-banned-import
            except ImportError as exc:  # pragma: no cover
                msg = f"Unable to convert to {dtype} to to the following exception: {exc.msg}"
                raise ImportError(msg) from exc

            return pd.ArrowDtype(
                pa.struct(
                    [
                        (
                            field.name,
                            arrow_narwhals_to_native_dtype(
                                field.dtype,
                                version=version,
                            ),
                        )
                        for field in dtype.fields  # type: ignore[union-attr]
                    ]
                )
            )
        else:  # pragma: no cover
            msg = (
                "Converting to Struct dtype is not supported for implementation "
                f"{implementation} and version {version}."
            )
            return NotImplementedError(msg)
    if isinstance_or_issubclass(dtype, dtypes.Array):  # pragma: no cover
        msg = "Converting to Array dtype is not supported yet"
        return NotImplementedError(msg)
    msg = f"Unknown dtype: {dtype}"  # pragma: no cover
    raise AssertionError(msg)


def broadcast_series(series: Sequence[PandasLikeSeries]) -> list[Any]:
    native_namespace = series[0].__native_namespace__()

    lengths = [len(s) for s in series]
    max_length = max(lengths)

    idx = series[lengths.index(max_length)]._native_series.index
    reindexed = []
    max_length_gt_1 = max_length > 1
    for s, length in zip(series, lengths):
        s_native = s._native_series
        if max_length_gt_1 and length == 1:
            reindexed.append(
                native_namespace.Series(
                    [s_native.iloc[0]] * max_length,
                    index=idx,
                    name=s_native.name,
                    dtype=s_native.dtype,
                )
            )

        elif s_native.index is not idx:
            reindexed.append(
                set_index(
                    s_native,
                    idx,
                    implementation=s._implementation,
                    backend_version=s._backend_version,
                )
            )
        else:
            reindexed.append(s_native)
    return reindexed


def to_datetime(implementation: Implementation) -> Any:
    if implementation in PANDAS_LIKE_IMPLEMENTATION:
        return implementation.to_native_namespace().to_datetime

    else:  # pragma: no cover
        msg = f"Expected pandas-like implementation ({PANDAS_LIKE_IMPLEMENTATION}), found {implementation}"
        raise TypeError(msg)


def int_dtype_mapper(dtype: Any) -> str:
    if "pyarrow" in str(dtype):
        return "Int64[pyarrow]"
    if str(dtype).lower() != str(dtype):  # pragma: no cover
        return "Int64"
    return "int64"


def convert_str_slice_to_int_slice(
    str_slice: slice, columns: pd.Index
) -> tuple[int | None, int | None, int | None]:
    start = columns.get_loc(str_slice.start) if str_slice.start is not None else None
    stop = columns.get_loc(str_slice.stop) + 1 if str_slice.stop is not None else None
    step = str_slice.step
    return (start, stop, step)


def calculate_timestamp_datetime(
    s: pd.Series, original_time_unit: str, time_unit: str
) -> pd.Series:
    if original_time_unit == "ns":
        if time_unit == "ns":
            result = s
        elif time_unit == "us":
            result = s // 1_000
        else:
            result = s // 1_000_000
    elif original_time_unit == "us":
        if time_unit == "ns":
            result = s * 1_000
        elif time_unit == "us":
            result = s
        else:
            result = s // 1_000
    elif original_time_unit == "ms":
        if time_unit == "ns":
            result = s * 1_000_000
        elif time_unit == "us":
            result = s * 1_000
        else:
            result = s
    elif original_time_unit == "s":
        if time_unit == "ns":
            result = s * 1_000_000_000
        elif time_unit == "us":
            result = s * 1_000_000
        else:
            result = s * 1_000
    else:  # pragma: no cover
        msg = f"unexpected time unit {original_time_unit}, please report a bug at https://github.com/narwhals-dev/narwhals"
        raise AssertionError(msg)
    return result


def calculate_timestamp_date(s: pd.Series, time_unit: str) -> pd.Series:
    s = s * 86_400  # number of seconds in a day
    if time_unit == "ns":
        result = s * 1_000_000_000
    elif time_unit == "us":
        result = s * 1_000_000
    else:
        result = s * 1_000
    return result


def select_columns_by_name(
    df: T,
    column_names: Sequence[str],
    backend_version: tuple[int, ...],
    implementation: Implementation,
) -> T:
    """Select columns by name.

    Prefer this over `df.loc[:, column_names]` as it's
    generally more performant.
    """
    if (df.columns.dtype.kind == "b") or (  # type: ignore[attr-defined]
        implementation is Implementation.PANDAS and backend_version < (1, 5)
    ):
        # See https://github.com/narwhals-dev/narwhals/issues/1349#issuecomment-2470118122
        # for why we need this
        available_columns = df.columns.tolist()  # type: ignore[attr-defined]
        missing_columns = [x for x in column_names if x not in available_columns]
        if missing_columns:  # pragma: no cover
            raise ColumnNotFoundError.from_missing_and_available_column_names(
                missing_columns, available_columns
            )
        return df.loc[:, column_names]  # type: ignore[no-any-return, attr-defined]
    try:
        return df[column_names]  # type: ignore[no-any-return, index]
    except KeyError as e:
        available_columns = df.columns.tolist()  # type: ignore[attr-defined]
        missing_columns = [x for x in column_names if x not in available_columns]
        raise ColumnNotFoundError.from_missing_and_available_column_names(
            missing_columns, available_columns
        ) from e


def pivot_table(
    df: PandasLikeDataFrame,
    values: list[str],
    index: list[str],
    columns: list[str],
    aggregate_function: str | None,
) -> Any:
    dtypes = import_dtypes_module(df._version)
    if df._implementation is Implementation.CUDF:
        if any(
            x == dtypes.Categorical
            for x in df.select(*[*values, *index, *columns]).schema.values()
        ):
            msg = "`pivot` with Categoricals is not implemented for cuDF backend"
            raise NotImplementedError(msg)
        # cuDF doesn't support `observed` argument
        result = df._native_frame.pivot_table(
            values=values,
            index=index,
            columns=columns,
            aggfunc=aggregate_function,
            margins=False,
        )
    else:
        result = df._native_frame.pivot_table(
            values=values,
            index=index,
            columns=columns,
            aggfunc=aggregate_function,
            margins=False,
            observed=True,
        )
    return result
