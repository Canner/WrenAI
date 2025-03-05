from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals._arrow.series import ArrowSeries


class ArrowSeriesCatNamespace:
    def __init__(self: Self, series: ArrowSeries) -> None:
        self._compliant_series = series

    def get_categories(self: Self) -> ArrowSeries:
        import pyarrow as pa

        ca = self._compliant_series._native_series
        out = pa.chunked_array(
            [pa.concat_arrays(x.dictionary for x in ca.chunks).unique()]
        )
        return self._compliant_series._from_native_series(out)
