from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Literal

from narwhals._arrow.utils import floordiv_compat
from narwhals.utils import import_dtypes_module

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals._arrow.series import ArrowSeries


class ArrowSeriesDateTimeNamespace:
    def __init__(self: Self, series: ArrowSeries) -> None:
        self._compliant_series = series

    def to_string(self: Self, format: str) -> ArrowSeries:  # noqa: A002
        import pyarrow.compute as pc

        # PyArrow differs from other libraries in that %S also prints out
        # the fractional part of the second...:'(
        # https://arrow.apache.org/docs/python/generated/pyarrow.compute.strftime.html
        format = format.replace("%S.%f", "%S").replace("%S%.f", "%S")
        return self._compliant_series._from_native_series(
            pc.strftime(self._compliant_series._native_series, format)
        )

    def replace_time_zone(self: Self, time_zone: str | None) -> ArrowSeries:
        import pyarrow.compute as pc

        if time_zone is not None:
            result = pc.assume_timezone(
                pc.local_timestamp(self._compliant_series._native_series), time_zone
            )
        else:
            result = pc.local_timestamp(self._compliant_series._native_series)
        return self._compliant_series._from_native_series(result)

    def convert_time_zone(self: Self, time_zone: str) -> ArrowSeries:
        import pyarrow as pa

        if self._compliant_series.dtype.time_zone is None:  # type: ignore[attr-defined]
            result = self.replace_time_zone("UTC")._native_series.cast(
                pa.timestamp(self._compliant_series._native_series.type.unit, time_zone)
            )
        else:
            result = self._compliant_series._native_series.cast(
                pa.timestamp(self._compliant_series._native_series.type.unit, time_zone)
            )

        return self._compliant_series._from_native_series(result)

    def timestamp(self: Self, time_unit: Literal["ns", "us", "ms"] = "us") -> ArrowSeries:
        import pyarrow as pa
        import pyarrow.compute as pc

        s = self._compliant_series._native_series
        dtype = self._compliant_series.dtype
        dtypes = import_dtypes_module(self._compliant_series._version)
        if dtype == dtypes.Datetime:
            unit = dtype.time_unit  # type: ignore[attr-defined]
            s_cast = s.cast(pa.int64())
            if unit == "ns":
                if time_unit == "ns":
                    result = s_cast
                elif time_unit == "us":
                    result = floordiv_compat(s_cast, 1_000)
                else:
                    result = floordiv_compat(s_cast, 1_000_000)
            elif unit == "us":
                if time_unit == "ns":
                    result = pc.multiply(s_cast, 1_000)
                elif time_unit == "us":
                    result = s_cast
                else:
                    result = floordiv_compat(s_cast, 1_000)
            elif unit == "ms":
                if time_unit == "ns":
                    result = pc.multiply(s_cast, 1_000_000)
                elif time_unit == "us":
                    result = pc.multiply(s_cast, 1_000)
                else:
                    result = s_cast
            elif unit == "s":
                if time_unit == "ns":
                    result = pc.multiply(s_cast, 1_000_000_000)
                elif time_unit == "us":
                    result = pc.multiply(s_cast, 1_000_000)
                else:
                    result = pc.multiply(s_cast, 1_000)
            else:  # pragma: no cover
                msg = f"unexpected time unit {unit}, please report an issue at https://github.com/narwhals-dev/narwhals"
                raise AssertionError(msg)
        elif dtype == dtypes.Date:
            time_s = pc.multiply(s.cast(pa.int32()), 86400)
            if time_unit == "ns":
                result = pc.multiply(time_s, 1_000_000_000)
            elif time_unit == "us":
                result = pc.multiply(time_s, 1_000_000)
            else:
                result = pc.multiply(time_s, 1_000)
        else:
            msg = "Input should be either of Date or Datetime type"
            raise TypeError(msg)
        return self._compliant_series._from_native_series(result)

    def date(self: Self) -> ArrowSeries:
        import pyarrow as pa

        return self._compliant_series._from_native_series(
            self._compliant_series._native_series.cast(pa.date32())
        )

    def year(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.year(self._compliant_series._native_series)
        )

    def month(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.month(self._compliant_series._native_series)
        )

    def day(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.day(self._compliant_series._native_series)
        )

    def hour(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.hour(self._compliant_series._native_series)
        )

    def minute(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.minute(self._compliant_series._native_series)
        )

    def second(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.second(self._compliant_series._native_series)
        )

    def millisecond(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.millisecond(self._compliant_series._native_series)
        )

    def microsecond(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        arr = self._compliant_series._native_series
        result = pc.add(pc.multiply(pc.millisecond(arr), 1000), pc.microsecond(arr))

        return self._compliant_series._from_native_series(result)

    def nanosecond(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        arr = self._compliant_series._native_series
        result = pc.add(
            pc.multiply(self.microsecond()._native_series, 1000), pc.nanosecond(arr)
        )
        return self._compliant_series._from_native_series(result)

    def ordinal_day(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.day_of_year(self._compliant_series._native_series)
        )

    def weekday(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.day_of_week(self._compliant_series._native_series, count_from_zero=False)
        )

    def total_minutes(self: Self) -> ArrowSeries:
        import pyarrow as pa
        import pyarrow.compute as pc

        arr = self._compliant_series._native_series
        unit = arr.type.unit

        unit_to_minutes_factor = {
            "s": 60,  # seconds
            "ms": 60 * 1e3,  # milli
            "us": 60 * 1e6,  # micro
            "ns": 60 * 1e9,  # nano
        }

        factor = pa.scalar(unit_to_minutes_factor[unit], type=pa.int64())
        return self._compliant_series._from_native_series(
            pc.cast(pc.divide(arr, factor), pa.int64())
        )

    def total_seconds(self: Self) -> ArrowSeries:
        import pyarrow as pa
        import pyarrow.compute as pc

        arr = self._compliant_series._native_series
        unit = arr.type.unit

        unit_to_seconds_factor = {
            "s": 1,  # seconds
            "ms": 1e3,  # milli
            "us": 1e6,  # micro
            "ns": 1e9,  # nano
        }
        factor = pa.scalar(unit_to_seconds_factor[unit], type=pa.int64())

        return self._compliant_series._from_native_series(
            pc.cast(pc.divide(arr, factor), pa.int64())
        )

    def total_milliseconds(self: Self) -> ArrowSeries:
        import pyarrow as pa
        import pyarrow.compute as pc

        arr = self._compliant_series._native_series
        unit = arr.type.unit

        unit_to_milli_factor = {
            "s": 1e3,  # seconds
            "ms": 1,  # milli
            "us": 1e3,  # micro
            "ns": 1e6,  # nano
        }

        factor = pa.scalar(unit_to_milli_factor[unit], type=pa.int64())

        if unit == "s":
            return self._compliant_series._from_native_series(
                pc.cast(pc.multiply(arr, factor), pa.int64())
            )

        return self._compliant_series._from_native_series(
            pc.cast(pc.divide(arr, factor), pa.int64())
        )

    def total_microseconds(self: Self) -> ArrowSeries:
        import pyarrow as pa
        import pyarrow.compute as pc

        arr = self._compliant_series._native_series
        unit = arr.type.unit

        unit_to_micro_factor = {
            "s": 1e6,  # seconds
            "ms": 1e3,  # milli
            "us": 1,  # micro
            "ns": 1e3,  # nano
        }

        factor = pa.scalar(unit_to_micro_factor[unit], type=pa.int64())

        if unit in {"s", "ms"}:
            return self._compliant_series._from_native_series(
                pc.cast(pc.multiply(arr, factor), pa.int64())
            )
        return self._compliant_series._from_native_series(
            pc.cast(pc.divide(arr, factor), pa.int64())
        )

    def total_nanoseconds(self: Self) -> ArrowSeries:
        import pyarrow as pa
        import pyarrow.compute as pc

        arr = self._compliant_series._native_series
        unit = arr.type.unit

        unit_to_nano_factor = {
            "s": 1e9,  # seconds
            "ms": 1e6,  # milli
            "us": 1e3,  # micro
            "ns": 1,  # nano
        }

        factor = pa.scalar(unit_to_nano_factor[unit], type=pa.int64())

        return self._compliant_series._from_native_series(
            pc.cast(pc.multiply(arr, factor), pa.int64())
        )
