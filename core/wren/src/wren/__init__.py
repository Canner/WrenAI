"""Wren — semantic SQL layer for 20+ data sources."""

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _pkg_version

from wren.engine import WrenEngine
from wren.model.data_source import DataSource
from wren.model.error import WrenError

try:
    __version__ = _pkg_version("wrenai")
except PackageNotFoundError:  # editable install without metadata, dev checkouts
    __version__ = "0.0.0+unknown"

__all__ = ["WrenEngine", "DataSource", "WrenError", "__version__"]
