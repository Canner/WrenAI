from typing import Any, Dict, List, Optional, Sequence

try:
    from typing import override
except ImportError:
    override = lambda x: x  # noqa E731

from hamilton.caching.cache_key import decode_key

from .base import MetadataStore, ResultStore, StoredResult
from .file import FileResultStore
from .sqlite import SQLiteMetadataStore


class InMemoryMetadataStore(MetadataStore):
    def __init__(self) -> None:
        self._data_versions: Dict[str, str] = {}  # {cache_key: data_version}
        self._cache_keys_by_run: Dict[str, List[str]] = {}  # {run_id: [cache_key]}
        self._run_ids: List[str] = []

    @override
    def __len__(self) -> int:
        """Number of unique ``cache_key`` values."""
        return len(self._data_versions.keys())

    @override
    def exists(self, cache_key: str) -> bool:
        """Indicate if ``cache_key`` exists and it can retrieve a ``data_version``."""
        return cache_key in self._data_versions.keys()

    @override
    def initialize(self, run_id: str) -> None:
        """Set up and log the beginning of the run."""
        self._cache_keys_by_run[run_id] = []
        self._run_ids.append(run_id)

    @override
    def set(self, cache_key: str, data_version: str, run_id: str, **kwargs) -> Optional[Any]:
        """Set the ``data_version`` for ``cache_key`` and associate it with the ``run_id``."""
        self._data_versions[cache_key] = data_version
        self._cache_keys_by_run[run_id].append(cache_key)

    @override
    def get(self, cache_key: str) -> Optional[str]:
        """Retrieve the ``data_version`` for ``cache_key``."""
        return self._data_versions.get(cache_key, None)

    @override
    def delete(self, cache_key: str) -> None:
        """Delete the ``data_version`` for ``cache_key``."""
        del self._data_versions[cache_key]

    @override
    def delete_all(self) -> None:
        """Delete all stored metadata."""
        self._data_versions.clear()

    def persist_to(self, metadata_store: Optional[MetadataStore] = None) -> None:
        """Persist in-memory metadata using another MetadataStore implementation.

        :param metadata_store: MetadataStore implementation to use for persistence.
            If None, a SQLiteMetadataStore is created with the default path "./.hamilton_cache".

        .. code-block:: python

            from hamilton import driver
            from hamilton.caching.stores.sqlite import SQLiteMetadataStore
            from hamilton.caching.stores.memory import InMemoryMetadataStore
            import my_dataflow

            dr = (
              driver.Builder()
              .with_modules(my_dataflow)
              .with_cache(metadata_store=InMemoryMetadataStore())
              .build()
            )

            # execute the Driver several time. This will populate the in-memory metadata store
            dr.execute(...)

            # persist to disk in-memory metadata
            dr.cache.metadata_store.persist_to(SQLiteMetadataStore(path="./.hamilton_cache"))

        """
        if metadata_store is None:
            metadata_store = SQLiteMetadataStore(path="./.hamilton_cache")

        for run_id in self._run_ids:
            metadata_store.initialize(run_id)

        for run_id, cache_keys in self._cache_keys_by_run.items():
            for cache_key in cache_keys:
                data_version = self._data_versions[cache_key]
                metadata_store.set(
                    cache_key=cache_key,
                    data_version=data_version,
                    run_id=run_id,
                )

    @classmethod
    def load_from(cls, metadata_store: MetadataStore) -> "InMemoryMetadataStore":
        """Load in-memory metadata from another MetadataStore instance.

        :param metadata_store: MetadataStore instance to load from.
        :return: InMemoryMetadataStore copy of the ``metadata_store``.

        .. code-block:: python

            from hamilton import driver
            from hamilton.caching.stores.sqlite import SQLiteMetadataStore
            from hamilton.caching.stores.memory import InMemoryMetadataStore
            import my_dataflow

            sqlite_metadata_store = SQLiteMetadataStore(path="./.hamilton_cache")
            in_memory_metadata_store = InMemoryMetadataStore.load_from(sqlite_metadata_store)

            # create the Driver with the in-memory metadata store
            dr = (
              driver.Builder()
              .with_modules(my_dataflow)
              .with_cache(metadata_store=in_memory_metadata_store)
              .build()
            )

        """
        in_memory_metadata_store = InMemoryMetadataStore()

        for run_id in metadata_store.get_run_ids():
            in_memory_metadata_store.initialize(run_id)

            for node_metadata in metadata_store.get_run(run_id):
                in_memory_metadata_store.set(
                    cache_key=node_metadata["cache_key"],
                    data_version=node_metadata["data_version"],
                    run_id=run_id,
                )

        return in_memory_metadata_store

    @override
    def get_run_ids(self) -> List[str]:
        """Return a list of all ``run_id`` values stored."""
        return self._run_ids

    @override
    def get_run(self, run_id: str) -> List[Dict[str, str]]:
        """Return a list of node metadata associated with a run."""
        if self._cache_keys_by_run.get(run_id, None) is None:
            raise IndexError(f"Run ID not found: {run_id}")

        nodes_metadata = []
        for cache_key in self._cache_keys_by_run[run_id]:
            decoded_key = decode_key(cache_key)
            nodes_metadata.append(
                dict(
                    cache_key=cache_key,
                    data_version=self._data_versions[cache_key],
                    node_name=decoded_key["node_name"],
                    code_version=decoded_key["code_version"],
                    dependencies_data_versions=decoded_key["dependencies_data_versions"],
                )
            )

        return nodes_metadata


class InMemoryResultStore(ResultStore):
    def __init__(self, persist_on_exit: bool = False) -> None:
        self._results: Dict[str, StoredResult] = {}  # {data_version: result}

    @override
    def exists(self, data_version: str) -> bool:
        return data_version in self._results.keys()

    # TODO handle materialization
    @override
    def set(self, data_version: str, result: Any, **kwargs) -> None:
        self._results[data_version] = StoredResult.new(value=result)

    @override
    def get(self, data_version: str) -> Optional[Any]:
        stored_result = self._results.get(data_version, None)
        if stored_result is None:
            return None

        return stored_result.value

    @override
    def delete(self, data_version: str) -> None:
        del self._results[data_version]

    @override
    def delete_all(self) -> None:
        self._results.clear()

    def delete_expired(self) -> None:
        to_delete = [
            data_version
            for data_version, stored_result in self._results.items()
            if stored_result.expired
        ]

        # first collect keys then delete because you can delete from dictionary
        # as you iterate through it
        for data_version in to_delete:
            self.delete(data_version)

    def persist_to(self, result_store: Optional[ResultStore] = None) -> None:
        """Persist in-memory results using another ``ResultStore`` implementation.

        :param result_store: ResultStore implementation to use for persistence.
            If None, a FileResultStore is created with the default path "./.hamilton_cache".
        """
        if result_store is None:
            result_store = FileResultStore(path="./.hamilton_cache")

        for data_version, stored_result in self._results.items():
            result_store.set(data_version, stored_result.value)

    @classmethod
    def load_from(
        cls,
        result_store: ResultStore,
        metadata_store: Optional[MetadataStore] = None,
        data_versions: Optional[Sequence[str]] = None,
    ) -> "InMemoryResultStore":
        """Load in-memory results from another ResultStore instance.

        Since result stores do not store an index of their keys, you must provide a
        ``MetadataStore`` instance or a list of ``data_version`` for which results
        should be loaded in memory.

        :param result_store: ``ResultStore`` instance to load results from.
        :param metadata_store: ``MetadataStore`` instance from which all ``data_version`` are retrieved.
        :return: InMemoryResultStore copy of the ``result_store``.

        .. code-block:: python

            from hamilton import driver
            from hamilton.caching.stores.sqlite import SQLiteMetadataStore
            from hamilton.caching.stores.memory import InMemoryMetadataStore
            import my_dataflow

            sqlite_metadata_store = SQLiteMetadataStore(path="./.hamilton_cache")
            in_memory_metadata_store = InMemoryMetadataStore.load_from(sqlite_metadata_store)

            # create the Driver with the in-memory metadata store
            dr = (
              driver.Builder()
              .with_modules(my_dataflow)
              .with_cache(metadata_store=in_memory_metadata_store)
              .build()
            )


        """
        if metadata_store is None and data_versions is None:
            raise ValueError(
                "A `metadata_store` or `data_versions` must be provided to load results."
            )

        in_memory_result_store = InMemoryResultStore()

        data_versions_to_retrieve = set()
        if data_versions is not None:
            data_versions_to_retrieve.update(data_versions)

        if metadata_store is not None:
            for run_id in metadata_store.get_run_ids():
                for node_metadata in metadata_store.get_run(run_id):
                    data_versions_to_retrieve.add(node_metadata["data_version"])

        for data_version in data_versions_to_retrieve:
            # TODO disambiguate "result is None" from the sentinel value when `data_version`
            # is not found in `result_store`.
            result = result_store.get(data_version)
            in_memory_result_store.set(data_version, result)

        return in_memory_result_store
