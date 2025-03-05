from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any

from narwhals._ibis.dataframe import native_to_narwhals_dtype
from narwhals.dependencies import get_ibis

if TYPE_CHECKING:
    from types import ModuleType

    from narwhals.utils import Version


class IbisInterchangeSeries:
    def __init__(self, df: Any, version: Version) -> None:
        self._native_series = df
        self._version = version

    def __narwhals_series__(self) -> Any:
        return self

    def __native_namespace__(self) -> ModuleType:
        return get_ibis()  # type: ignore[no-any-return]

    def __getattr__(self, attr: str) -> Any:
        if attr == "dtype":
            return native_to_narwhals_dtype(self._native_series.type(), self._version)
        msg = (
            f"Attribute {attr} is not supported for metadata-only dataframes.\n\n"
            "If you would like to see this kind of object better supported in "
            "Narwhals, please open a feature request "
            "at https://github.com/narwhals-dev/narwhals/issues."
        )
        raise NotImplementedError(msg)
