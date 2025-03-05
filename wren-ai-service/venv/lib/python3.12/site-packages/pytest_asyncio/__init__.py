"""The main point for importing pytest-asyncio items."""

from ._version import version as __version__  # noqa
from .plugin import fixture, is_async_test

__all__ = ("fixture", "is_async_test")
