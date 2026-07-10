"""Memory providers resolve where the long-lived context store lives.

This fork points memory at a remote Qdrant server with Volcengine Ark
embeddings:
  - ``QdrantMemoryProvider``: opens a ``MemoryStore`` against ``$QDRANT_URL``
    (embeddings via ``$VOLC_ARK_API_KEY``).
  - ``NoopMemoryProvider``: signals that memory is disabled. Direct API calls
    raise ``MemoryNotEnabledError``; LLM-facing tools are filtered out.

Auto-selection is performed by ``WrenToolkit.from_project`` based on whether
``QDRANT_URL`` is set.
"""

from wren.memory.store import MemoryStore

from wren_pydantic.exceptions import MemoryNotEnabledError


class QdrantMemoryProvider:
    """Lazily opens a Qdrant-backed ``MemoryStore`` on first use."""

    enabled = True

    def __init__(self, *, url: str | None = None, api_key: str | None = None):
        self._url = url
        self._api_key = api_key

    def open(self) -> MemoryStore:
        return MemoryStore(url=self._url, api_key=self._api_key)


class NoopMemoryProvider:
    """Inert provider used when ``QDRANT_URL`` is not configured."""

    enabled = False

    def open(self) -> MemoryStore:
        raise MemoryNotEnabledError(
            "memory is not enabled for this toolkit. "
            "Set QDRANT_URL (and VOLC_ARK_API_KEY), then run `wren memory index`."
        )
