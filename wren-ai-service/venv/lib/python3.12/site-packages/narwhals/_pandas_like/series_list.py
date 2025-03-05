from __future__ import annotations

from typing import TYPE_CHECKING

from narwhals._pandas_like.utils import narwhals_to_native_dtype
from narwhals._pandas_like.utils import rename
from narwhals._pandas_like.utils import set_index
from narwhals.utils import Implementation
from narwhals.utils import import_dtypes_module

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals._pandas_like.series import PandasLikeSeries


class PandasLikeSeriesListNamespace:
    def __init__(self, series: PandasLikeSeries) -> None:
        self._compliant_series = series

    def len(self: Self) -> PandasLikeSeries:
        native_series = self._compliant_series._native_series
        native_result = native_series.list.len()

        if (
            self._compliant_series._implementation is Implementation.PANDAS
            and self._compliant_series._backend_version < (3, 0)
        ):  # pragma: no cover
            native_result = set_index(
                rename(
                    native_result,
                    native_series.name,
                    implementation=self._compliant_series._implementation,
                    backend_version=self._compliant_series._backend_version,
                ),
                index=native_series.index,
                implementation=self._compliant_series._implementation,
                backend_version=self._compliant_series._backend_version,
            )
        dtype = narwhals_to_native_dtype(
            dtype=import_dtypes_module(self._compliant_series._version).UInt32(),
            starting_dtype=native_result.dtype,
            implementation=self._compliant_series._implementation,
            backend_version=self._compliant_series._backend_version,
            version=self._compliant_series._version,
        )
        return self._compliant_series._from_native_series(native_result.astype(dtype))
