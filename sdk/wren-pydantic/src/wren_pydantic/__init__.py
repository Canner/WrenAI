"""wren-pydantic: Pydantic AI integration for Wren AI Core."""

from __future__ import annotations

from wren_pydantic._toolkit import WrenToolkit
from wren_pydantic.exceptions import MemoryNotEnabledError, WrenToolkitInitError

__version__ = "0.2.0"

__all__ = [
    "MemoryNotEnabledError",
    "WrenToolkit",
    "WrenToolkitInitError",
    "__version__",
]
