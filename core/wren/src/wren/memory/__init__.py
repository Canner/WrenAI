"""Wren Memory — LanceDB-backed schema and query memory.

Public API for programmatic use::

    from wren.memory import WrenMemory

    mem = WrenMemory()
    mem.index_manifest(manifest_dict)
    ctx = mem.get_context(manifest_dict, "customer orders")
"""

from __future__ import annotations

from pathlib import Path


class WrenMemory:
    """High-level memory API for Wren Engine.

    Parameters
    ----------
    path:
        LanceDB storage directory.  Defaults to ``~/.wren/memory/``.
    """

    def __init__(self, path: str | Path | None = None):
        from wren.memory.store import MemoryStore  # noqa: PLC0415

        self._store = MemoryStore(path=path)

    def index_manifest(
        self,
        manifest: dict,
        *,
        replace: bool = True,
        seed_queries: bool = True,
    ) -> dict:
        """Index MDL schema into LanceDB.

        Returns {"schema_items": int, "seed_queries": int}.
        """
        return self._store.index_schema(
            manifest, replace=replace, seed_queries=seed_queries
        )

    @staticmethod
    def describe_schema(manifest: dict) -> str:
        """Return the full schema as structured plain text."""
        from wren.memory.schema_indexer import describe_schema  # noqa: PLC0415

        return describe_schema(manifest)

    def get_context(
        self,
        manifest: dict,
        query: str,
        *,
        limit: int = 5,
        item_type: str | None = None,
        model_name: str | None = None,
        threshold: int | None = None,
    ) -> dict:
        """Return schema context using the best strategy for the schema size.

        Small schemas (below *threshold* chars) are returned as full plain
        text.  Large schemas use embedding search with optional filters.
        See :data:`~wren.memory.schema_indexer.SCHEMA_DESCRIBE_THRESHOLD`.
        """
        kwargs: dict = {
            "limit": limit,
            "item_type": item_type,
            "model_name": model_name,
        }
        if threshold is not None:
            kwargs["threshold"] = threshold
        return self._store.get_context(manifest, query, **kwargs)

    def store_query(
        self,
        nl_query: str,
        sql_query: str,
        *,
        datasource: str | None = None,
        tags: str | None = None,
    ) -> None:
        """Store a NL→SQL pair for future few-shot retrieval."""
        self._store.store_query(nl_query, sql_query, datasource=datasource, tags=tags)

    def recall_queries(
        self,
        query: str,
        *,
        limit: int = 3,
        datasource: str | None = None,
    ) -> list[dict]:
        """Search past NL→SQL pairs by semantic similarity."""
        return self._store.recall_queries(query, limit=limit, datasource=datasource)

    def schema_is_current(self, manifest: dict) -> bool:
        """Check if the indexed schema matches the given manifest."""
        return self._store.schema_is_current(manifest)

    def status(self) -> dict:
        """Return index statistics (path, table row counts)."""
        return self._store.status()

    def reset(self) -> None:
        """Drop all memory tables."""
        self._store.reset()


__all__ = ["WrenMemory"]
