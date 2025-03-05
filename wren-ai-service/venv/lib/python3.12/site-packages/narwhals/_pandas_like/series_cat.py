from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from narwhals._pandas_like.series import PandasLikeSeries


class PandasLikeSeriesCatNamespace:
    def __init__(self, series: PandasLikeSeries) -> None:
        self._compliant_series = series

    def get_categories(self) -> PandasLikeSeries:
        s = self._compliant_series._native_series
        return self._compliant_series._from_native_series(
            s.__class__(s.cat.categories, name=s.name)
        )
