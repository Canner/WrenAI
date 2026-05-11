"""Direct Python subscope for memory operations.

Exposed as ``toolkit.memory``. Operations raise ``MemoryNotEnabledError``
when memory is disabled — distinct error model from LLM tools, which
silently filter out memory tools when disabled.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from wren_pydantic.exceptions import MemoryNotEnabledError

if TYPE_CHECKING:
    from wren.memory.store import MemoryStore

    from wren_pydantic._toolkit import WrenToolkit


class _MemoryAPI:
    """Thin wrapper around ``wren.memory.MemoryStore`` bound to a toolkit."""

    def __init__(self, toolkit: WrenToolkit):
        self._toolkit = toolkit

    def fetch(
        self,
        question: str,
        *,
        limit: int = 5,
        item_type: str | None = None,
        model: str | None = None,
        threshold: int | None = None,
    ) -> dict[str, Any]:
        """Return schema/business context relevant to *question*."""
        store = self._store()
        manifest = self._toolkit._mdl_source.load_manifest()
        kwargs: dict[str, Any] = {
            "query": question,
            "manifest": manifest,
            "limit": limit,
        }
        if item_type is not None:
            kwargs["item_type"] = item_type
        if model is not None:
            kwargs["model_name"] = model
        if threshold is not None:
            kwargs["threshold"] = threshold
        return store.get_context(**kwargs)

    def recall(
        self,
        question: str,
        *,
        limit: int = 3,
    ) -> list[dict[str, Any]]:
        """Return up to *limit* past NL→SQL pairs similar to *question*."""
        store = self._store()
        return store.recall_queries(query=question, limit=limit)

    def store(
        self,
        nl: str,
        sql: str,
        *,
        tags: list[str] | None = None,
    ) -> None:
        """Persist a confirmed NL→SQL pair for future recall.

        Tags are joined with commas before storage; Core's MemoryStore stores
        them as an opaque string. Tags must therefore not contain commas
        themselves — a tag like ``"revenue, Q1"`` would be silently split into
        two tags on any future consumer that splits on the separator. We
        reject such inputs early with ``ValueError`` rather than corrupt
        the round-trip.
        Empty/None tags map to no tag.
        """
        if tags:
            for tag in tags:
                if "," in tag:
                    raise ValueError(
                        f"tag {tag!r} contains a comma; commas are reserved as the "
                        "separator for the underlying storage format. "
                        "Replace commas with dashes or spaces."
                    )
        store = self._store()
        tag_str = ",".join(tags) if tags else None
        store.store_query(nl_query=nl, sql_query=sql, tags=tag_str)

    def _store(self) -> MemoryStore:
        if not self._toolkit._memory.enabled:
            raise MemoryNotEnabledError(
                "memory is not enabled for this toolkit. "
                "Run `wren memory index` in your project to enable it."
            )
        if self._toolkit._memory_store_cache is None:
            self._toolkit._memory_store_cache = self._toolkit._memory.open()
        return self._toolkit._memory_store_cache
