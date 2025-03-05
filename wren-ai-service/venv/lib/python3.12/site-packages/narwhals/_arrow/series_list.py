from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals._arrow.series import ArrowSeries


class ArrowSeriesListNamespace:
    def __init__(self: Self, series: ArrowSeries) -> None:
        self._arrow_series = series

    def len(self: Self) -> ArrowSeries:
        import pyarrow as pa
        import pyarrow.compute as pc

        return self._arrow_series._from_native_series(
            pc.cast(pc.list_value_length(self._arrow_series._native_series), pa.uint32())
        )
