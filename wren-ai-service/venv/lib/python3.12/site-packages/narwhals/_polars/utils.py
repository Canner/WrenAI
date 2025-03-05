from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING
from typing import Any
from typing import Literal
from typing import TypeVar
from typing import overload

from narwhals.utils import import_dtypes_module

if TYPE_CHECKING:
    import polars as pl

    from narwhals._polars.dataframe import PolarsDataFrame
    from narwhals._polars.dataframe import PolarsLazyFrame
    from narwhals._polars.expr import PolarsExpr
    from narwhals._polars.series import PolarsSeries
    from narwhals.dtypes import DType
    from narwhals.utils import Version

    T = TypeVar("T")


@overload
def extract_native(obj: PolarsDataFrame) -> pl.DataFrame: ...


@overload
def extract_native(obj: PolarsLazyFrame) -> pl.LazyFrame: ...


@overload
def extract_native(obj: PolarsSeries) -> pl.Series: ...


@overload
def extract_native(obj: PolarsExpr) -> pl.Expr: ...


@overload
def extract_native(obj: T) -> T: ...


def extract_native(
    obj: PolarsDataFrame | PolarsLazyFrame | PolarsSeries | PolarsExpr | T,
) -> pl.DataFrame | pl.LazyFrame | pl.Series | pl.Expr | T:
    from narwhals._polars.dataframe import PolarsDataFrame
    from narwhals._polars.dataframe import PolarsLazyFrame
    from narwhals._polars.expr import PolarsExpr
    from narwhals._polars.series import PolarsSeries

    if isinstance(obj, (PolarsDataFrame, PolarsLazyFrame)):
        return obj._native_frame
    if isinstance(obj, PolarsSeries):
        return obj._native_series
    if isinstance(obj, PolarsExpr):
        return obj._native_expr
    return obj


def extract_args_kwargs(args: Any, kwargs: Any) -> tuple[list[Any], dict[str, Any]]:
    return [extract_native(arg) for arg in args], {
        k: extract_native(v) for k, v in kwargs.items()
    }


@lru_cache(maxsize=16)
def native_to_narwhals_dtype(
    dtype: pl.DataType,
    version: Version,
    backend_version: tuple[int, ...],
) -> DType:
    import polars as pl

    dtypes = import_dtypes_module(version)
    if dtype == pl.Float64:
        return dtypes.Float64()
    if dtype == pl.Float32:
        return dtypes.Float32()
    if dtype == getattr(pl, "Int128", None):  # type: ignore[operator]  # pragma: no cover
        # Not available for Polars pre 1.8.0
        return dtypes.Int128()
    if dtype == pl.Int64:
        return dtypes.Int64()
    if dtype == pl.Int32:
        return dtypes.Int32()
    if dtype == pl.Int16:
        return dtypes.Int16()
    if dtype == pl.Int8:
        return dtypes.Int8()
    if dtype == getattr(pl, "UInt128", None):  # type: ignore[operator]  # pragma: no cover
        # Not available for Polars pre 1.8.0
        return dtypes.UInt128()
    if dtype == pl.UInt64:
        return dtypes.UInt64()
    if dtype == pl.UInt32:
        return dtypes.UInt32()
    if dtype == pl.UInt16:
        return dtypes.UInt16()
    if dtype == pl.UInt8:
        return dtypes.UInt8()
    if dtype == pl.String:
        return dtypes.String()
    if dtype == pl.Boolean:
        return dtypes.Boolean()
    if dtype == pl.Object:
        return dtypes.Object()
    if dtype == pl.Categorical:
        return dtypes.Categorical()
    if dtype == pl.Enum:
        return dtypes.Enum()
    if dtype == pl.Date:
        return dtypes.Date()
    if dtype == pl.Datetime:
        dt_time_unit: Literal["us", "ns", "ms"] = getattr(dtype, "time_unit", "us")
        dt_time_zone = getattr(dtype, "time_zone", None)
        return dtypes.Datetime(time_unit=dt_time_unit, time_zone=dt_time_zone)
    if dtype == pl.Duration:
        du_time_unit: Literal["us", "ns", "ms"] = getattr(dtype, "time_unit", "us")
        return dtypes.Duration(time_unit=du_time_unit)
    if dtype == pl.Struct:
        return dtypes.Struct(
            [
                dtypes.Field(
                    field_name,
                    native_to_narwhals_dtype(field_type, version, backend_version),
                )
                for field_name, field_type in dtype  # type: ignore[attr-defined]
            ]
        )
    if dtype == pl.List:
        return dtypes.List(
            native_to_narwhals_dtype(dtype.inner, version, backend_version)  # type: ignore[attr-defined]
        )
    if dtype == pl.Array:
        if backend_version < (0, 20, 30):  # pragma: no cover
            return dtypes.Array(
                native_to_narwhals_dtype(dtype.inner, version, backend_version),  # type: ignore[attr-defined]
                dtype.width,  # type: ignore[attr-defined]
            )
        else:
            return dtypes.Array(
                native_to_narwhals_dtype(dtype.inner, version, backend_version),  # type: ignore[attr-defined]
                dtype.size,  # type: ignore[attr-defined]
            )
    if dtype == pl.Decimal:
        return dtypes.Decimal()
    return dtypes.Unknown()


def narwhals_to_native_dtype(dtype: DType | type[DType], version: Version) -> pl.DataType:
    import polars as pl

    dtypes = import_dtypes_module(version)

    if dtype == dtypes.Float64:
        return pl.Float64()
    if dtype == dtypes.Float32:
        return pl.Float32()
    if dtype == dtypes.Int64:
        return pl.Int64()
    if dtype == dtypes.Int32:
        return pl.Int32()
    if dtype == dtypes.Int16:
        return pl.Int16()
    if dtype == dtypes.Int8:
        return pl.Int8()
    if dtype == dtypes.UInt64:
        return pl.UInt64()
    if dtype == dtypes.UInt32:
        return pl.UInt32()
    if dtype == dtypes.UInt16:
        return pl.UInt16()
    if dtype == dtypes.UInt8:
        return pl.UInt8()
    if dtype == dtypes.String:
        return pl.String()
    if dtype == dtypes.Boolean:
        return pl.Boolean()
    if dtype == dtypes.Object:  # pragma: no cover
        return pl.Object()
    if dtype == dtypes.Categorical:
        return pl.Categorical()
    if dtype == dtypes.Enum:
        msg = "Converting to Enum is not (yet) supported"
        raise NotImplementedError(msg)
    if dtype == dtypes.Date:
        return pl.Date()
    if dtype == dtypes.Datetime or isinstance(dtype, dtypes.Datetime):
        dt_time_unit: Literal["ms", "us", "ns"] = getattr(dtype, "time_unit", "us")
        dt_time_zone = getattr(dtype, "time_zone", None)
        return pl.Datetime(dt_time_unit, dt_time_zone)
    if dtype == dtypes.Duration or isinstance(dtype, dtypes.Duration):
        du_time_unit: Literal["us", "ns", "ms"] = getattr(dtype, "time_unit", "us")
        return pl.Duration(time_unit=du_time_unit)
    if dtype == dtypes.List:
        return pl.List(narwhals_to_native_dtype(dtype.inner, version))  # type: ignore[union-attr]
    if dtype == dtypes.Struct:
        return pl.Struct(
            fields=[
                pl.Field(
                    name=field.name,
                    dtype=narwhals_to_native_dtype(field.dtype, version),
                )
                for field in dtype.fields  # type: ignore[union-attr]
            ]
        )
    if dtype == dtypes.Array:  # pragma: no cover
        msg = "Converting to Array dtype is not supported yet"
        raise NotImplementedError(msg)
    return pl.Unknown()  # pragma: no cover


def convert_str_slice_to_int_slice(
    str_slice: slice, columns: list[str]
) -> tuple[int | None, int | None, int | None]:  # pragma: no cover
    start = columns.index(str_slice.start) if str_slice.start is not None else None
    stop = columns.index(str_slice.stop) + 1 if str_slice.stop is not None else None
    step = str_slice.step
    return (start, stop, step)
