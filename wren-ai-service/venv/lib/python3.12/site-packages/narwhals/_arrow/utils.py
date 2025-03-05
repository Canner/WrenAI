from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING
from typing import Any
from typing import Sequence
from typing import overload

from narwhals.utils import import_dtypes_module
from narwhals.utils import isinstance_or_issubclass

if TYPE_CHECKING:
    import numpy as np
    import pyarrow as pa

    from narwhals._arrow.series import ArrowSeries
    from narwhals.dtypes import DType
    from narwhals.utils import Version


@lru_cache(maxsize=16)
def native_to_narwhals_dtype(dtype: pa.DataType, version: Version) -> DType:
    import pyarrow as pa

    dtypes = import_dtypes_module(version)
    if pa.types.is_int64(dtype):
        return dtypes.Int64()
    if pa.types.is_int32(dtype):
        return dtypes.Int32()
    if pa.types.is_int16(dtype):
        return dtypes.Int16()
    if pa.types.is_int8(dtype):
        return dtypes.Int8()
    if pa.types.is_uint64(dtype):
        return dtypes.UInt64()
    if pa.types.is_uint32(dtype):
        return dtypes.UInt32()
    if pa.types.is_uint16(dtype):
        return dtypes.UInt16()
    if pa.types.is_uint8(dtype):
        return dtypes.UInt8()
    if pa.types.is_boolean(dtype):
        return dtypes.Boolean()
    if pa.types.is_float64(dtype):
        return dtypes.Float64()
    if pa.types.is_float32(dtype):
        return dtypes.Float32()
    # bug in coverage? it shows `31->exit` (where `31` is currently the line number of
    # the next line), even though both when the if condition is true and false are covered
    if (  # pragma: no cover
        pa.types.is_string(dtype)
        or pa.types.is_large_string(dtype)
        or getattr(pa.types, "is_string_view", lambda _: False)(dtype)
    ):
        return dtypes.String()
    if pa.types.is_date32(dtype):
        return dtypes.Date()
    if pa.types.is_timestamp(dtype):
        return dtypes.Datetime(time_unit=dtype.unit, time_zone=dtype.tz)
    if pa.types.is_duration(dtype):
        return dtypes.Duration(time_unit=dtype.unit)
    if pa.types.is_dictionary(dtype):
        return dtypes.Categorical()
    if pa.types.is_struct(dtype):
        return dtypes.Struct(
            [
                dtypes.Field(
                    dtype.field(i).name,
                    native_to_narwhals_dtype(dtype.field(i).type, version),
                )
                for i in range(dtype.num_fields)
            ]
        )

    if pa.types.is_list(dtype) or pa.types.is_large_list(dtype):
        return dtypes.List(native_to_narwhals_dtype(dtype.value_type, version))
    if pa.types.is_fixed_size_list(dtype):
        return dtypes.Array(
            native_to_narwhals_dtype(dtype.value_type, version), dtype.list_size
        )
    if pa.types.is_decimal(dtype):
        return dtypes.Decimal()
    return dtypes.Unknown()  # pragma: no cover


def narwhals_to_native_dtype(dtype: DType | type[DType], version: Version) -> pa.DataType:
    import pyarrow as pa

    dtypes = import_dtypes_module(version)
    if isinstance_or_issubclass(dtype, dtypes.Float64):
        return pa.float64()
    if isinstance_or_issubclass(dtype, dtypes.Float32):
        return pa.float32()
    if isinstance_or_issubclass(dtype, dtypes.Int64):
        return pa.int64()
    if isinstance_or_issubclass(dtype, dtypes.Int32):
        return pa.int32()
    if isinstance_or_issubclass(dtype, dtypes.Int16):
        return pa.int16()
    if isinstance_or_issubclass(dtype, dtypes.Int8):
        return pa.int8()
    if isinstance_or_issubclass(dtype, dtypes.UInt64):
        return pa.uint64()
    if isinstance_or_issubclass(dtype, dtypes.UInt32):
        return pa.uint32()
    if isinstance_or_issubclass(dtype, dtypes.UInt16):
        return pa.uint16()
    if isinstance_or_issubclass(dtype, dtypes.UInt8):
        return pa.uint8()
    if isinstance_or_issubclass(dtype, dtypes.String):
        return pa.string()
    if isinstance_or_issubclass(dtype, dtypes.Boolean):
        return pa.bool_()
    if isinstance_or_issubclass(dtype, dtypes.Categorical):
        return pa.dictionary(pa.uint32(), pa.string())
    if isinstance_or_issubclass(dtype, dtypes.Datetime):
        time_unit = getattr(dtype, "time_unit", "us")
        time_zone = getattr(dtype, "time_zone", None)
        return pa.timestamp(time_unit, tz=time_zone)
    if isinstance_or_issubclass(dtype, dtypes.Duration):
        time_unit = getattr(dtype, "time_unit", "us")
        return pa.duration(time_unit)
    if isinstance_or_issubclass(dtype, dtypes.Date):
        return pa.date32()
    if isinstance_or_issubclass(dtype, dtypes.List):
        return pa.list_(
            value_type=narwhals_to_native_dtype(
                dtype.inner,  # type: ignore[union-attr]
                version=version,
            )
        )
    if isinstance_or_issubclass(dtype, dtypes.Struct):
        return pa.struct(
            [
                (
                    field.name,
                    narwhals_to_native_dtype(
                        field.dtype,
                        version=version,
                    ),
                )
                for field in dtype.fields  # type: ignore[union-attr]
            ]
        )
    if isinstance_or_issubclass(dtype, dtypes.Array):  # pragma: no cover
        msg = "Converting to Array dtype is not supported yet"
        return NotImplementedError(msg)
    msg = f"Unknown dtype: {dtype}"  # pragma: no cover
    raise AssertionError(msg)


def broadcast_and_extract_native(
    lhs: ArrowSeries, rhs: Any, backend_version: tuple[int, ...]
) -> tuple[pa.ChunkedArray, Any]:
    """Validate RHS of binary operation.

    If the comparison isn't supported, return `NotImplemented` so that the
    "right-hand-side" operation (e.g. `__radd__`) can be tried.

    If RHS is length 1, return the scalar value, so that the underlying
    library can broadcast it.
    """
    from narwhals._arrow.dataframe import ArrowDataFrame
    from narwhals._arrow.series import ArrowSeries

    if rhs is None:
        import pyarrow as pa

        return lhs._native_series, pa.scalar(None, type=lhs._native_series.type)

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

    if isinstance(rhs, ArrowDataFrame):
        return NotImplemented  # type: ignore[no-any-return]

    if isinstance(rhs, ArrowSeries):
        if len(rhs) == 1:
            # broadcast
            return lhs._native_series, rhs[0]
        if len(lhs) == 1:
            # broadcast
            import numpy as np  # ignore-banned-import
            import pyarrow as pa

            fill_value = lhs[0]
            if backend_version < (13,) and hasattr(fill_value, "as_py"):
                fill_value = fill_value.as_py()
            left_result = pa.chunked_array(
                [
                    pa.array(
                        np.full(shape=rhs.len(), fill_value=fill_value),
                        type=lhs._native_series.type,
                    )
                ]
            )
            return left_result, rhs._native_series
        return lhs._native_series, rhs._native_series
    return lhs._native_series, rhs


def validate_dataframe_comparand(
    length: int, other: Any, backend_version: tuple[int, ...]
) -> Any:
    """Validate RHS of binary operation.

    If the comparison isn't supported, return `NotImplemented` so that the
    "right-hand-side" operation (e.g. `__radd__`) can be tried.
    """
    from narwhals._arrow.series import ArrowSeries

    if isinstance(other, ArrowSeries):
        if len(other) == 1:
            import numpy as np  # ignore-banned-import
            import pyarrow as pa

            value = other._native_series[0]
            if backend_version < (13,) and hasattr(value, "as_py"):
                value = value.as_py()
            return pa.array(np.full(shape=length, fill_value=value))
        return other._native_series

    from narwhals._arrow.dataframe import ArrowDataFrame  # pragma: no cover

    if isinstance(other, ArrowDataFrame):  # pragma: no cover
        return NotImplemented

    msg = "Please report a bug"  # pragma: no cover
    raise AssertionError(msg)


def horizontal_concat(dfs: list[pa.Table]) -> pa.Table:
    """Concatenate (native) DataFrames horizontally.

    Should be in namespace.
    """
    import pyarrow as pa

    names = [name for df in dfs for name in df.column_names]

    if len(set(names)) < len(names):  # pragma: no cover
        msg = "Expected unique column names"
        raise ValueError(msg)

    arrays = [a for df in dfs for a in df]
    return pa.Table.from_arrays(arrays, names=names)


def vertical_concat(dfs: list[pa.Table]) -> pa.Table:
    """Concatenate (native) DataFrames vertically.

    Should be in namespace.
    """
    cols_0 = dfs[0].column_names
    for i, df in enumerate(dfs[1:], start=1):
        cols_current = df.column_names
        if cols_current != cols_0:
            msg = (
                "unable to vstack, column names don't match:\n"
                f"   - dataframe 0: {cols_0}\n"
                f"   - dataframe {i}: {cols_current}\n"
            )
            raise TypeError(msg)

    import pyarrow as pa

    return pa.concat_tables(dfs)


def diagonal_concat(dfs: list[pa.Table], backend_version: tuple[int, ...]) -> pa.Table:
    """Concatenate (native) DataFrames diagonally.

    Should be in namespace.
    """
    import pyarrow as pa

    kwargs = (
        {"promote": True}
        if backend_version < (14, 0, 0)
        else {"promote_options": "default"}  # type: ignore[dict-item]
    )
    return pa.concat_tables(dfs, **kwargs)


def floordiv_compat(left: Any, right: Any) -> Any:
    # The following lines are adapted from pandas' pyarrow implementation.
    # Ref: https://github.com/pandas-dev/pandas/blob/262fcfbffcee5c3116e86a951d8b693f90411e68/pandas/core/arrays/arrow/array.py#L124-L154
    import pyarrow as pa
    import pyarrow.compute as pc

    if isinstance(left, (int, float)):
        left = pa.scalar(left)

    if isinstance(right, (int, float)):
        right = pa.scalar(right)

    if pa.types.is_integer(left.type) and pa.types.is_integer(right.type):
        divided = pc.divide_checked(left, right)
        if pa.types.is_signed_integer(divided.type):
            # GH 56676
            has_remainder = pc.not_equal(pc.multiply(divided, right), left)
            has_one_negative_operand = pc.less(
                pc.bit_wise_xor(left, right),
                pa.scalar(0, type=divided.type),
            )
            result = pc.if_else(
                pc.and_(
                    has_remainder,
                    has_one_negative_operand,
                ),
                # GH: 55561 ruff: ignore
                pc.subtract(divided, pa.scalar(1, type=divided.type)),
                divided,
            )
        else:
            result = divided  # pragma: no cover
        result = result.cast(left.type)
    else:
        divided = pc.divide(left, right)
        result = pc.floor(divided)
    return result


def cast_for_truediv(
    arrow_array: pa.ChunkedArray | pa.Scalar, pa_object: pa.ChunkedArray | pa.Scalar
) -> tuple[pa.ChunkedArray | pa.Scalar, pa.ChunkedArray | pa.Scalar]:
    # Lifted from:
    # https://github.com/pandas-dev/pandas/blob/262fcfbffcee5c3116e86a951d8b693f90411e68/pandas/core/arrays/arrow/array.py#L108-L122
    import pyarrow as pa
    import pyarrow.compute as pc

    # Ensure int / int -> float mirroring Python/Numpy behavior
    # as pc.divide_checked(int, int) -> int
    if pa.types.is_integer(arrow_array.type) and pa.types.is_integer(pa_object.type):
        # GH: 56645.  # noqa: ERA001
        # https://github.com/apache/arrow/issues/35563
        return pc.cast(arrow_array, pa.float64(), safe=False), pc.cast(
            pa_object, pa.float64(), safe=False
        )

    return arrow_array, pa_object


def broadcast_series(series: Sequence[ArrowSeries]) -> list[Any]:
    lengths = [len(s) for s in series]
    max_length = max(lengths)
    fast_path = all(_len == max_length for _len in lengths)

    if fast_path:
        return [s._native_series for s in series]

    import pyarrow as pa

    is_max_length_gt_1 = max_length > 1
    reshaped = []
    for s, length in zip(series, lengths):
        s_native = s._native_series
        if is_max_length_gt_1 and length == 1:
            value = s_native[0]
            if s._backend_version < (13,) and hasattr(value, "as_py"):
                value = value.as_py()
            reshaped.append(pa.array([value] * max_length, type=s_native.type))
        else:
            reshaped.append(s_native)

    return reshaped


@overload
def convert_slice_to_nparray(num_rows: int, rows_slice: slice) -> np.ndarray: ...


@overload
def convert_slice_to_nparray(num_rows: int, rows_slice: int) -> int: ...


@overload
def convert_slice_to_nparray(
    num_rows: int, rows_slice: Sequence[int]
) -> Sequence[int]: ...


def convert_slice_to_nparray(
    num_rows: int, rows_slice: slice | int | Sequence[int]
) -> np.ndarray | int | Sequence[int]:
    if isinstance(rows_slice, slice):
        import numpy as np  # ignore-banned-import

        return np.arange(num_rows)[rows_slice]
    else:
        return rows_slice


def select_rows(table: pa.Table, rows: Any) -> pa.Table:
    if isinstance(rows, slice) and rows == slice(None):
        selected_rows = table
    elif isinstance(rows, Sequence) and not rows:
        selected_rows = table.slice(0, 0)
    else:
        range_ = convert_slice_to_nparray(num_rows=len(table), rows_slice=rows)
        selected_rows = table.take(range_)
    return selected_rows


def convert_str_slice_to_int_slice(
    str_slice: slice, columns: list[str]
) -> tuple[int | None, int | None, int | None]:
    start = columns.index(str_slice.start) if str_slice.start is not None else None
    stop = columns.index(str_slice.stop) + 1 if str_slice.stop is not None else None
    step = str_slice.step
    return (start, stop, step)


# Regex for date, time, separator and timezone components
DATE_RE = r"(?P<date>\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{8})"
SEP_RE = r"(?P<sep>\s|T)"
TIME_RE = r"(?P<time>\d{2}:\d{2}(?::\d{2})?|\d{6}?)"  # \s*(?P<period>[AP]M)?)?
HMS_RE = r"^(?P<hms>\d{2}:\d{2}:\d{2})$"
HM_RE = r"^(?P<hm>\d{2}:\d{2})$"
HMS_RE_NO_SEP = r"^(?P<hms_no_sep>\d{6})$"
TZ_RE = r"(?P<tz>Z|[+-]\d{2}:?\d{2})"  # Matches 'Z', '+02:00', '+0200', '+02', etc.
FULL_RE = rf"{DATE_RE}{SEP_RE}?{TIME_RE}?{TZ_RE}?$"

# Separate regexes for different date formats
YMD_RE = r"^(?P<year>(?:[12][0-9])?[0-9]{2})(?P<sep1>[-/.])(?P<month>0[1-9]|1[0-2])(?P<sep2>[-/.])(?P<day>0[1-9]|[12][0-9]|3[01])$"
DMY_RE = r"^(?P<day>0[1-9]|[12][0-9]|3[01])(?P<sep1>[-/.])(?P<month>0[1-9]|1[0-2])(?P<sep2>[-/.])(?P<year>(?:[12][0-9])?[0-9]{2})$"
MDY_RE = r"^(?P<month>0[1-9]|1[0-2])(?P<sep1>[-/.])(?P<day>0[1-9]|[12][0-9]|3[01])(?P<sep2>[-/.])(?P<year>(?:[12][0-9])?[0-9]{2})$"
YMD_RE_NO_SEP = r"^(?P<year>(?:[12][0-9])?[0-9]{2})(?P<month>0[1-9]|1[0-2])(?P<day>0[1-9]|[12][0-9]|3[01])$"

DATE_FORMATS = (
    (YMD_RE_NO_SEP, "%Y%m%d"),
    (YMD_RE, "%Y-%m-%d"),
    (DMY_RE, "%d-%m-%Y"),
    (MDY_RE, "%m-%d-%Y"),
)
TIME_FORMATS = ((HMS_RE, "%H:%M:%S"), (HM_RE, "%H:%M"), (HMS_RE_NO_SEP, "%H%M%S"))


def parse_datetime_format(arr: pa.StringArray) -> str:
    """Try to infer datetime format from StringArray."""
    import pyarrow as pa
    import pyarrow.compute as pc

    matches = pa.concat_arrays(  # converts from ChunkedArray to StructArray
        pc.extract_regex(pc.drop_null(arr).slice(0, 10), pattern=FULL_RE).chunks
    )

    if not pc.all(matches.is_valid()).as_py():
        msg = (
            "Unable to infer datetime format, provided format is not supported. "
            "Please report a bug to https://github.com/narwhals-dev/narwhals/issues"
        )
        raise NotImplementedError(msg)

    dates = matches.field("date")
    separators = matches.field("sep")
    times = matches.field("time")
    tz = matches.field("tz")

    # separators and time zones must be unique
    if pc.count(pc.unique(separators)).as_py() > 1:
        msg = "Found multiple separator values while inferring datetime format."
        raise ValueError(msg)

    if pc.count(pc.unique(tz)).as_py() > 1:
        msg = "Found multiple timezone values while inferring datetime format."
        raise ValueError(msg)

    date_value = _parse_date_format(dates)
    time_value = _parse_time_format(times)

    sep_value = separators[0].as_py()
    tz_value = "%z" if tz[0].as_py() else ""

    return f"{date_value}{sep_value}{time_value}{tz_value}"


def _parse_date_format(arr: pa.Array) -> str:
    import pyarrow.compute as pc

    for date_rgx, date_fmt in DATE_FORMATS:
        matches = pc.extract_regex(arr, pattern=date_rgx)
        if date_fmt == "%Y%m%d" and pc.all(matches.is_valid()).as_py():
            return date_fmt
        elif (
            pc.all(matches.is_valid()).as_py()
            and pc.count(pc.unique(sep1 := matches.field("sep1"))).as_py() == 1
            and pc.count(pc.unique(sep2 := matches.field("sep2"))).as_py() == 1
            and (date_sep_value := sep1[0].as_py()) == sep2[0].as_py()
        ):
            return date_fmt.replace("-", date_sep_value)

    msg = (
        "Unable to infer datetime format. "
        "Please report a bug to https://github.com/narwhals-dev/narwhals/issues"
    )
    raise ValueError(msg)


def _parse_time_format(arr: pa.Array) -> str:
    import pyarrow.compute as pc

    for time_rgx, time_fmt in TIME_FORMATS:
        matches = pc.extract_regex(arr, pattern=time_rgx)
        if pc.all(matches.is_valid()).as_py():
            return time_fmt
    return ""


def pad_series(
    series: ArrowSeries, *, window_size: int, center: bool
) -> tuple[ArrowSeries, int]:
    """Pad series with None values on the left and/or right side, depending on the specified parameters.

    Arguments:
        series: The input ArrowSeries to be padded.
        window_size: The desired size of the window.
        center: Specifies whether to center the padding or not.

    Returns:
        A tuple containing the padded ArrowSeries and the offset value.
    """
    import pyarrow as pa  # ignore-banned-import

    if center:
        offset_left = window_size // 2
        offset_right = offset_left - (
            window_size % 2 == 0
        )  # subtract one if window_size is even

        native_series = series._native_series

        pad_left = pa.array([None] * offset_left, type=native_series.type)
        pad_right = pa.array([None] * offset_right, type=native_series.type)
        padded_arr = series._from_native_series(
            pa.concat_arrays([pad_left, *native_series.chunks, pad_right])
        )
        offset = offset_left + offset_right
    else:
        padded_arr = series
        offset = 0

    return padded_arr, offset
