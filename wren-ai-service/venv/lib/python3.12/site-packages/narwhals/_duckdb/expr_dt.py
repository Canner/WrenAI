from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from narwhals._duckdb.expr import DuckDBExpr


class DuckDBExprDateTimeNamespace:
    def __init__(self, expr: DuckDBExpr) -> None:
        self._compliant_expr = expr

    def year(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("year", _input),
            "year",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def month(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("month", _input),
            "month",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def day(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("day", _input),
            "day",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def hour(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("hour", _input),
            "hour",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def minute(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("minute", _input),
            "minute",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def second(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("second", _input),
            "second",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def millisecond(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("millisecond", _input)
            - FunctionExpression("second", _input) * 1_000,
            "millisecond",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def microsecond(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("microsecond", _input)
            - FunctionExpression("second", _input) * 1_000_000,
            "microsecond",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def nanosecond(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("nanosecond", _input)
            - FunctionExpression("second", _input) * 1_000_000_000,
            "nanosecond",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def to_string(self, format: str) -> DuckDBExpr:  # noqa: A002
        from duckdb import ConstantExpression
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression(
                "strftime", _input, ConstantExpression(format)
            ),
            "to_string",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def weekday(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("isodow", _input),
            "weekday",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def ordinal_day(self) -> DuckDBExpr:
        from duckdb import FunctionExpression

        return self._compliant_expr._from_call(
            lambda _input: FunctionExpression("dayofyear", _input),
            "ordinal_day",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def date(self) -> DuckDBExpr:
        return self._compliant_expr._from_call(
            lambda _input: _input.cast("date"),
            "date",
            returns_scalar=self._compliant_expr._returns_scalar,
        )
