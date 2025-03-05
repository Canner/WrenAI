import functools
import hashlib
import inspect
import json
import logging
from abc import ABC, abstractmethod
from typing import Any, Optional

from pydantic import BaseModel, GetCoreSchemaHandler
from pydantic_core import CoreSchema, core_schema

logger = logging.getLogger(__name__)


class CacheInterface(ABC):
    """Abstract base class defining the interface for cache implementations.

    This class provides a standard interface that all cache implementations must follow.
    It supports basic cache operations like get, set and key checking.
    """

    @abstractmethod
    def get(self, key: str) -> Any:
        """Retrieve a value from the cache by key.

        Args:
            key: The key to look up in the cache.

        Returns:
            The cached value associated with the key.
        """
        pass

    @abstractmethod
    def set(self, key: str, value) -> None:
        """Store a value in the cache with the given key.

        Args:
            key: The key to store the value under.
            value: The value to cache.
        """
        pass

    @abstractmethod
    def has_key(self, key: str) -> bool:
        """Check if a key exists in the cache.

        Args:
            key: The key to check for.

        Returns:
            True if the key exists in the cache, False otherwise.
        """
        pass

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        """
        Define how Pydantic generates a schema for BaseRagasEmbeddings.
        """
        return core_schema.no_info_after_validator_function(
            cls,
            core_schema.is_instance_schema(cls),  # The validator function
        )


class DiskCacheBackend(CacheInterface):
    """A cache implementation that stores data on disk using the diskcache library.

    This cache backend persists data to disk, allowing it to survive between program runs.
    It implements the CacheInterface for use with Ragas caching functionality.

    Args:
        cache_dir (str, optional): Directory where cache files will be stored. Defaults to ".cache".
    """

    def __init__(self, cache_dir: str = ".cache"):
        try:
            from diskcache import Cache
        except ImportError:
            raise ImportError(
                "For using the diskcache backend, please install it with `pip install diskcache`."
            )

        self.cache = Cache(cache_dir)

    def get(self, key: str) -> Any:
        """Retrieve a value from the disk cache by key.

        Args:
            key: The key to look up in the cache.

        Returns:
            The cached value associated with the key, or None if not found.
        """
        return self.cache.get(key)

    def set(self, key: str, value) -> None:
        """Store a value in the disk cache with the given key.

        Args:
            key: The key to store the value under.
            value: The value to cache.
        """
        self.cache.set(key, value)

    def has_key(self, key: str) -> bool:
        """Check if a key exists in the disk cache.

        Args:
            key: The key to check for.

        Returns:
            True if the key exists in the cache, False otherwise.
        """
        return key in self.cache

    def __del__(self):
        """Cleanup method to properly close the cache when the object is destroyed."""
        if hasattr(self, "cache"):
            self.cache.close()

    def __repr__(self):
        """Return string representation of the cache object.

        Returns:
            String showing the cache directory location.
        """
        return f"DiskCacheBackend(cache_dir={self.cache.directory})"


def _make_hashable(o):
    if isinstance(o, (tuple, list)):
        return tuple(_make_hashable(e) for e in o)
    elif isinstance(o, dict):
        return tuple(sorted((k, _make_hashable(v)) for k, v in o.items()))
    elif isinstance(o, set):
        return tuple(sorted(_make_hashable(e) for e in o))
    elif isinstance(o, BaseModel):
        return _make_hashable(o.model_dump())
    else:
        return o


EXCLUDE_KEYS = ["callbacks"]


def _generate_cache_key(func, args, kwargs):
    if inspect.ismethod(func):
        args = args[1:]

    filtered_kwargs = {k: v for k, v in kwargs.items() if k not in EXCLUDE_KEYS}

    key_data = {
        "function": func.__qualname__,
        "args": _make_hashable(args),
        "kwargs": _make_hashable(filtered_kwargs),
    }

    key_string = json.dumps(key_data, sort_keys=True, default=str)
    cache_key = hashlib.sha256(key_string.encode("utf-8")).hexdigest()
    return cache_key


def cacher(cache_backend: Optional[CacheInterface] = None):
    """Decorator that adds caching functionality to a function.

    This decorator can be applied to both synchronous and asynchronous functions to cache their results.
    If no cache backend is provided, the original function is returned unchanged.

    Args:
        cache_backend (Optional[CacheInterface]): The cache backend to use for storing results.
            If None, caching is disabled.

    Returns:
        Callable: A decorated function that implements caching behavior.
    """

    def decorator(func):
        if cache_backend is None:
            return func

        # hack to make pyright happy
        backend: CacheInterface = cache_backend

        is_async = inspect.iscoroutinefunction(func)

        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            cache_key = _generate_cache_key(func, args, kwargs)

            if backend.has_key(cache_key):
                logger.debug(f"Cache hit for {cache_key}")
                return backend.get(cache_key)

            result = await func(*args, **kwargs)
            backend.set(cache_key, result)
            return result

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            cache_key = _generate_cache_key(func, args, kwargs)

            if backend.has_key(cache_key):
                logger.debug(f"Cache hit for {cache_key}")
                return backend.get(cache_key)

            result = func(*args, **kwargs)
            backend.set(cache_key, result)
            return result

        return async_wrapper if is_async else sync_wrapper

    return decorator
