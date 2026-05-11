"""Memory providers resolve where the long-lived context store lives.

v0.1 ships:
  - ``LocalLanceDBMemoryProvider``: opens a ``MemoryStore`` against a local
    ``.wren/memory/`` directory.
  - ``NoopMemoryProvider``: signals that memory is disabled. Direct API calls
    raise ``MemoryNotEnabledError``; LLM-facing tools are filtered out.

Auto-selection is performed by ``WrenToolkit.from_project`` based on whether
``<project>/.wren/memory/`` exists.
"""

from pathlib import Path

from wren.memory.store import MemoryStore

from wren_pydantic.exceptions import MemoryNotEnabledError


class LocalLanceDBMemoryProvider:
    """Lazily opens a local LanceDB-backed ``MemoryStore`` on first use."""

    enabled = True

    def __init__(self, *, memory_path: Path):
        self._memory_path = memory_path

    def open(self) -> MemoryStore:
        return MemoryStore(path=self._memory_path)


class NoopMemoryProvider:
    """Inert provider used when no ``.wren/memory/`` exists in the project."""

    enabled = False

    def open(self) -> MemoryStore:
        raise MemoryNotEnabledError(
            "memory is not enabled for this toolkit. "
            "Run `wren memory index` in your project to enable it."
        )
