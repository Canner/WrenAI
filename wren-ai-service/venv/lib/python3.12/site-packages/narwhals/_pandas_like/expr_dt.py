from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Literal

from narwhals._expression_parsing import reuse_series_namespace_implementation

if TYPE_CHECKING:
    from narwhals._pandas_like.expr import PandasLikeExpr


class PandasLikeExprDateTimeNamespace:
    def __init__(self, expr: PandasLikeExpr) -> None:
        self._compliant_expr = expr

    def date(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(self._compliant_expr, "dt", "date")

    def year(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(self._compliant_expr, "dt", "year")

    def month(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(self._compliant_expr, "dt", "month")

    def day(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(self._compliant_expr, "dt", "day")

    def hour(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(self._compliant_expr, "dt", "hour")

    def minute(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(self._compliant_expr, "dt", "minute")

    def second(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(self._compliant_expr, "dt", "second")

    def millisecond(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "millisecond"
        )

    def microsecond(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "microsecond"
        )

    def nanosecond(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "nanosecond"
        )

    def ordinal_day(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "ordinal_day"
        )

    def weekday(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "weekday"
        )

    def total_minutes(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "total_minutes"
        )

    def total_seconds(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "total_seconds"
        )

    def total_milliseconds(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "total_milliseconds"
        )

    def total_microseconds(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "total_microseconds"
        )

    def total_nanoseconds(self) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "total_nanoseconds"
        )

    def to_string(self, format: str) -> PandasLikeExpr:  # noqa: A002
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "to_string", format=format
        )

    def replace_time_zone(self, time_zone: str | None) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "replace_time_zone", time_zone=time_zone
        )

    def convert_time_zone(self, time_zone: str) -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "convert_time_zone", time_zone=time_zone
        )

    def timestamp(self, time_unit: Literal["ns", "us", "ms"] = "us") -> PandasLikeExpr:
        return reuse_series_namespace_implementation(
            self._compliant_expr, "dt", "timestamp", time_unit=time_unit
        )
