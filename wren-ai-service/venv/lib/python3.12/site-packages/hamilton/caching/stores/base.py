import abc
import pickle
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Sequence, Tuple, Type

from hamilton.htypes import custom_subclass_check
from hamilton.io.data_adapters import DataLoader, DataSaver
from hamilton.registry import LOADER_REGISTRY, SAVER_REGISTRY


class ResultRetrievalError(Exception):
    """Raised by the SmartCacheAdapter when ResultStore.get() fails."""


# TODO Currently, this check is done when data needs to be saved.
# Ideally, it would be done earlier in the caching lifecycle.
def search_data_adapter_registry(
    name: str, type_: type
) -> Tuple[Type[DataSaver], Type[DataLoader]]:
    """Find pair of DataSaver and DataLoader registered with `name` and supporting `type_`"""
    if name not in SAVER_REGISTRY or name not in LOADER_REGISTRY:
        raise KeyError(
            f"{name} isn't associated to both a DataLoader and a DataSaver. "
            "Default saver/loader pairs include `json`, `file`, `pickle`, `parquet`, `csv`, "
            "`feather`, `orc`, `excel`. More pairs may be available through plugins."
        )

    try:
        saver_cls = next(
            saver_cls
            for saver_cls in SAVER_REGISTRY[name]
            if any(
                custom_subclass_check(type_, applicable_type)
                for applicable_type in saver_cls.applicable_types()
            )
        )
    except StopIteration as e:
        raise KeyError(f"{name} doesn't have any DataSaver supporting type {type_}") from e

    try:
        loader_cls = next(
            loader_cls
            for loader_cls in LOADER_REGISTRY[name]
            if any(
                custom_subclass_check(type_, applicable_type)
                for applicable_type in loader_cls.applicable_types()
            )
        )
    except StopIteration as e:
        raise KeyError(f"{name} doesn't have any DataLoader supporting type {type_}") from e

    return saver_cls, loader_cls


class ResultStore(abc.ABC):
    @abc.abstractmethod
    def set(self, data_version: str, result: Any, **kwargs) -> None:
        """Store ``result`` keyed by ``data_version``."""

    @abc.abstractmethod
    def get(self, data_version: str, **kwargs) -> Optional[Any]:
        """Try to retrieve ``result`` keyed by ``data_version``.
        If retrieval misses, return ``None``.
        """

    @abc.abstractmethod
    def delete(self, data_version: str) -> None:
        """Delete ``result`` keyed by ``data_version``."""

    @abc.abstractmethod
    def delete_all(self) -> None:
        """Delete all stored results."""

    @abc.abstractmethod
    def exists(self, data_version: str) -> bool:
        """boolean check if a ``result`` is found for ``data_version``
        If True, ``.get()`` should successfully retrieve the ``result``.
        """


class MetadataStore(abc.ABC):
    @abc.abstractmethod
    def __len__(self) -> int:
        """Return the number of cache_keys in the metadata store"""

    @abc.abstractmethod
    def initialize(self, run_id: str) -> None:
        """Setup the metadata store and log the start of the run"""

    @abc.abstractmethod
    def set(self, cache_key: str, data_version: str, **kwargs) -> Optional[Any]:
        """Store the mapping ``cache_key -> data_version``.
        Can include other metadata (e.g., node name, run id, code version) depending
        on the implementation.
        """

    @abc.abstractmethod
    def get(self, cache_key: str, **kwargs) -> Optional[str]:
        """Try to retrieve ``data_version`` keyed by ``cache_key``.
        If retrieval misses return ``None``.
        """

    @abc.abstractmethod
    def delete(self, cache_key: str) -> None:
        """Delete ``data_version`` keyed by ``cache_key``."""

    @abc.abstractmethod
    def delete_all(self) -> None:
        """Delete all stored metadata."""

    @abc.abstractmethod
    def exists(self, cache_key: str) -> bool:
        """boolean check if a ``data_version`` is found for ``cache_key``
        If True, ``.get()`` should successfully retrieve the ``data_version``.
        """

    @abc.abstractmethod
    def get_run_ids(self) -> Sequence[str]:
        """Return a list of run ids, sorted from oldest to newest start time.
        A ``run_id`` is registered when the metadata_store ``.initialize()`` is called.
        """

    @abc.abstractmethod
    def get_run(self, run_id: str) -> Sequence[dict]:
        """Return a list of node metadata associated with a run.

        For each node, the metadata should include ``cache_key`` (created or used)
        and ``data_version``. These values allow to manually query the MetadataStore
        or ResultStore.

        Decoding the ``cache_key`` gives the ``node_name``, ``code_version``, and
        ``dependencies_data_versions``. Individual implementations may add more
        information or decode the ``cache_key`` before returning metadata.
        """

    @property
    def size(self) -> int:
        """Number of unique entries (i.e., cache_keys) in the metadata_store"""
        return self.__len__()

    @property
    def last_run_id(self) -> str:
        """Return"""
        return self.get_run_ids()[-1]

    def get_last_run(self) -> Any:
        """Return the metadata from the last started run."""
        return self.get_run(self.last_run_id)


# TODO refactor the association between StoredResult, MetadataStore, and ResultStore
# to load data using the `DataLoader` class and kwargs instead of pickling the instantiated
# DataLoader object. This would be safer across Hamilton versions.
class StoredResult:
    def __init__(
        self,
        value: Any,
        expires_at=None,
        saver=None,
        loader=None,
    ):
        self.value = value
        self.expires_at = expires_at
        self.saver = saver
        self.loader = loader

    @classmethod
    def new(
        cls,
        value: Any,
        expires_in: Optional[timedelta] = None,
        saver: Optional[DataSaver] = None,
        loader: Optional[DataLoader] = None,
    ) -> "StoredResult":
        if expires_in is not None and not isinstance(expires_in, timedelta):
            expires_in = timedelta(seconds=expires_in)

        # != operator on boolean is XOR
        if bool(saver is not None) != bool(loader is not None):
            raise ValueError(
                "Must pass both `saver` and `loader` or neither. Currently received: "
                f"`saver`: `{saver}`; `loader`: `{loader}`"
            )

        return cls(
            value=value,
            expires_at=(datetime.now(tz=timezone.utc) + expires_in) if expires_in else None,
            saver=saver,
            loader=loader,
        )

    @property
    def expired(self) -> bool:
        return self.expires_at is not None and datetime.now(tz=timezone.utc) >= self.expires_at

    @property
    def expires_in(self) -> int:
        if self.expires_at:
            return int(self.expires_at.timestamp() - datetime.now(tz=timezone.utc).timestamp())

        return -1

    def save(self) -> bytes:
        """Receives pickleable data or DataLoader to use to load the real data"""
        if self.saver is not None:
            self.saver.save_data(data=self.value)
            to_pickle = self.loader
        else:
            to_pickle = self.value

        return pickle.dumps(to_pickle)

    @classmethod
    def load(cls, raw: bytes) -> "StoredResult":
        """Reads the raw bytes from disk and sets `StoredResult.data`"""
        loaded = pickle.loads(raw)
        if isinstance(loaded, DataLoader):
            loader = loaded
            result, metadata = loader.load_data(None)
        else:
            loader = None
            result = loaded

        return StoredResult.new(value=result)
