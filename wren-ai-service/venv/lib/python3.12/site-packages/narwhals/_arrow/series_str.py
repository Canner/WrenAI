from __future__ import annotations

from typing import TYPE_CHECKING

from narwhals._arrow.utils import parse_datetime_format

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals._arrow.series import ArrowSeries


class ArrowSeriesStringNamespace:
    def __init__(self: Self, series: ArrowSeries) -> None:
        self._compliant_series = series

    def len_chars(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.utf8_length(self._compliant_series._native_series)
        )

    def replace(
        self: Self, pattern: str, value: str, *, literal: bool, n: int
    ) -> ArrowSeries:
        import pyarrow.compute as pc

        method = "replace_substring" if literal else "replace_substring_regex"
        return self._compliant_series._from_native_series(
            getattr(pc, method)(
                self._compliant_series._native_series,
                pattern=pattern,
                replacement=value,
                max_replacements=n,
            )
        )

    def replace_all(
        self: Self, pattern: str, value: str, *, literal: bool
    ) -> ArrowSeries:
        return self.replace(pattern, value, literal=literal, n=-1)

    def strip_chars(self: Self, characters: str | None) -> ArrowSeries:
        import pyarrow.compute as pc

        whitespace = " \t\n\r\v\f"
        return self._compliant_series._from_native_series(
            pc.utf8_trim(
                self._compliant_series._native_series,
                characters or whitespace,
            )
        )

    def starts_with(self: Self, prefix: str) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.equal(self.slice(0, len(prefix))._native_series, prefix)
        )

    def ends_with(self: Self, suffix: str) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.equal(self.slice(-len(suffix), None)._native_series, suffix)
        )

    def contains(self: Self, pattern: str, *, literal: bool) -> ArrowSeries:
        import pyarrow.compute as pc

        check_func = pc.match_substring if literal else pc.match_substring_regex
        return self._compliant_series._from_native_series(
            check_func(self._compliant_series._native_series, pattern)
        )

    def slice(self: Self, offset: int, length: int | None) -> ArrowSeries:
        import pyarrow.compute as pc

        stop = offset + length if length is not None else None
        return self._compliant_series._from_native_series(
            pc.utf8_slice_codeunits(
                self._compliant_series._native_series, start=offset, stop=stop
            ),
        )

    def to_datetime(self: Self, format: str | None) -> ArrowSeries:  # noqa: A002
        import pyarrow.compute as pc

        if format is None:
            format = parse_datetime_format(self._compliant_series._native_series)

        return self._compliant_series._from_native_series(
            pc.strptime(self._compliant_series._native_series, format=format, unit="us")
        )

    def to_uppercase(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.utf8_upper(self._compliant_series._native_series),
        )

    def to_lowercase(self: Self) -> ArrowSeries:
        import pyarrow.compute as pc

        return self._compliant_series._from_native_series(
            pc.utf8_lower(self._compliant_series._native_series),
        )
