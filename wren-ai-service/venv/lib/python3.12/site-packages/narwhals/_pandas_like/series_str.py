from __future__ import annotations

from typing import TYPE_CHECKING

from narwhals._pandas_like.utils import to_datetime

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals._pandas_like.series import PandasLikeSeries


class PandasLikeSeriesStringNamespace:
    def __init__(self, series: PandasLikeSeries) -> None:
        self._compliant_series = series

    def len_chars(self) -> PandasLikeSeries:
        return self._compliant_series._from_native_series(
            self._compliant_series._native_series.str.len()
        )

    def replace(
        self, pattern: str, value: str, *, literal: bool = False, n: int = 1
    ) -> PandasLikeSeries:
        return self._compliant_series._from_native_series(
            self._compliant_series._native_series.str.replace(
                pat=pattern, repl=value, n=n, regex=not literal
            ),
        )

    def replace_all(
        self, pattern: str, value: str, *, literal: bool = False
    ) -> PandasLikeSeries:
        return self.replace(pattern, value, literal=literal, n=-1)

    def strip_chars(self, characters: str | None) -> PandasLikeSeries:
        return self._compliant_series._from_native_series(
            self._compliant_series._native_series.str.strip(characters),
        )

    def starts_with(self, prefix: str) -> PandasLikeSeries:
        return self._compliant_series._from_native_series(
            self._compliant_series._native_series.str.startswith(prefix),
        )

    def ends_with(self, suffix: str) -> PandasLikeSeries:
        return self._compliant_series._from_native_series(
            self._compliant_series._native_series.str.endswith(suffix),
        )

    def contains(self, pattern: str, *, literal: bool = False) -> PandasLikeSeries:
        return self._compliant_series._from_native_series(
            self._compliant_series._native_series.str.contains(
                pat=pattern, regex=not literal
            )
        )

    def slice(self, offset: int, length: int | None = None) -> PandasLikeSeries:
        stop = offset + length if length else None
        return self._compliant_series._from_native_series(
            self._compliant_series._native_series.str.slice(start=offset, stop=stop),
        )

    def to_datetime(self: Self, format: str | None) -> PandasLikeSeries:  # noqa: A002
        return self._compliant_series._from_native_series(
            to_datetime(self._compliant_series._implementation)(
                self._compliant_series._native_series, format=format
            )
        )

    def to_uppercase(self) -> PandasLikeSeries:
        return self._compliant_series._from_native_series(
            self._compliant_series._native_series.str.upper(),
        )

    def to_lowercase(self) -> PandasLikeSeries:
        return self._compliant_series._from_native_series(
            self._compliant_series._native_series.str.lower(),
        )
