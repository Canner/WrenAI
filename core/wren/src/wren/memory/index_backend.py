"""Pluggable NL->SQL recall backends over ``knowledge/sql/*.md``.

The markdown files are the source of truth. A backend is just a query interface
over them:

- ``GrepIndex`` - dependency-free token/substring search. The default when the
  ``memory`` extra is absent; ``knowledge/sql/`` *is* the index (nothing to build).
- ``QdrantIndex`` - semantic search via the ``memory`` extra (qdrant-client +
  openai -> Volcengine Ark embeddings), with Qdrant as a derived index.

Backend selection: ``WREN_MEMORY_BACKEND=grep|qdrant`` forces a choice;
otherwise Qdrant is used when its extra is importable and ``QDRANT_URL`` is
set, else Grep.
"""

from __future__ import annotations

import os
import re
from abc import ABC, abstractmethod
from importlib.util import find_spec
from pathlib import Path

from wren.memory.markdown import load_query_pairs

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall((text or "").lower()) if len(t) >= 2}


def _pair_to_result(pair: dict, *, score: int | None = None) -> dict:
    """Shape a knowledge/sql pair like a recall row (parity with Qdrant)."""
    tags = pair.get("tags")
    row = {
        "nl_query": pair["nl"],
        "sql_query": pair["sql"],
        "datasource": pair.get("datasource", ""),
        "tags": ",".join(tags) if isinstance(tags, list) else (tags or ""),
        "path": pair.get("path"),
    }
    if score is not None:
        row["score"] = score
    return row


class MemoryIndex(ABC):
    """Recall interface over knowledge/sql/. Implementations never persist the
    markdown - they only build/search a (possibly derived) index over it."""

    name: str

    @abstractmethod
    def rebuild(self) -> dict:
        """(Re)build the index from knowledge/sql/. Returns a small summary."""

    @abstractmethod
    def search(
        self, query: str, *, limit: int = 3, datasource: str | None = None
    ) -> list[dict]:
        """Return up to *limit* NL->SQL pairs relevant to *query*."""

    @abstractmethod
    def reset(self) -> None:
        """Drop any derived index. The markdown source is never touched."""

    @abstractmethod
    def status(self) -> dict:
        """Return backend + size info."""


class GrepIndex(MemoryIndex):
    """Dependency-free recall: token-overlap + substring over knowledge/sql/."""

    name = "grep"

    def __init__(self, project_path: Path):
        self._project = project_path

    def rebuild(self) -> dict:
        # The markdown is the index - nothing to build.
        return {"backend": self.name, "pairs": len(load_query_pairs(self._project))}

    def reset(self) -> None:
        return  # no derived index to drop

    def status(self) -> dict:
        return {"backend": self.name, "pairs": len(load_query_pairs(self._project))}

    def search(
        self, query: str, *, limit: int = 3, datasource: str | None = None
    ) -> list[dict]:
        q_tokens = _tokens(query)
        q_lower = query.strip().lower()
        scored: list[tuple[int, dict]] = []
        for pair in load_query_pairs(self._project):
            if datasource and pair.get("datasource") != datasource:
                continue
            score = len(q_tokens & (_tokens(pair["nl"]) | _tokens(pair["sql"])))
            if q_lower and q_lower in pair["nl"].lower():
                score += 5  # whole-query substring match in the NL ranks highest
            if score > 0:
                scored.append((score, pair))
        # Highest score first; stable tie-break by NL for determinism.
        scored.sort(key=lambda s: (-s[0], s[1]["nl"]))
        return [_pair_to_result(p, score=score) for score, p in scored[:limit]]


class QdrantIndex(MemoryIndex):
    """Semantic recall via the ``memory`` extra; Qdrant is a derived index."""

    name = "qdrant"

    def __init__(
        self,
        project_path: Path,
        *,
        url: str | None = None,
        api_key: str | None = None,
        embedding=None,
        collection_prefix: str | None = None,
    ):
        from wren.memory.store import MemoryStore  # noqa: PLC0415

        self._project = project_path
        self._store = MemoryStore(
            url=url,
            api_key=api_key,
            embedding=embedding,
            collection_prefix=collection_prefix,
        )

    @property
    def store(self):
        return self._store

    def rebuild(self) -> dict:
        pairs = load_query_pairs(self._project)
        if not pairs:
            return {"backend": self.name, "loaded": 0, "updated": 0}
        res = self._store.load_queries(pairs, upsert=True)
        return {"backend": self.name, **res}

    def reset(self) -> None:
        self._store.reset()

    def status(self) -> dict:
        return {"backend": self.name, **self._store.status()}

    def search(
        self, query: str, *, limit: int = 3, datasource: str | None = None
    ) -> list[dict]:
        return self._store.recall_queries(query, limit=limit, datasource=datasource)


def _extra_available() -> bool:
    return bool(find_spec("qdrant_client")) and bool(find_spec("openai"))


def _qdrant_available() -> bool:
    """Qdrant is usable only with both the extra and a server URL."""
    return _extra_available() and bool(os.environ.get("QDRANT_URL"))


def resolve_backend(env: str | None = None) -> str:
    """Return the backend that will actually be used.

    Honors an explicit ``WREN_MEMORY_BACKEND=grep|qdrant`` (or *env*) override,
    else auto-detects. ``qdrant`` is downgraded to ``grep`` whenever its extra
    is unavailable or ``QDRANT_URL`` is unset - so the result always reflects
    what ``get_index`` will build.
    """
    choice = (
        (env if env is not None else os.environ.get("WREN_MEMORY_BACKEND", ""))
        .strip()
        .lower()
    )
    if choice == "grep":
        return "grep"
    # explicit "qdrant", an unrecognized value, or empty -> prefer qdrant when
    # its extra is importable and a server URL is configured, otherwise grep.
    return "qdrant" if _qdrant_available() else "grep"


def get_index(
    project_path: Path,
    *,
    backend: str | None = None,
    url: str | None = None,
    api_key: str | None = None,
    embedding=None,
    collection_prefix: str | None = None,
) -> MemoryIndex:
    """Construct the resolved MemoryIndex for *project_path*.

    An explicit *backend* is normalized (``" Qdrant "`` -> ``qdrant``); an
    unrecognized value falls back to auto-detection. Qdrant downgrades to
    GrepIndex when its extra is missing or ``QDRANT_URL`` is unset.
    """
    name = (backend or "").strip().lower()
    if name not in {"grep", "qdrant"}:
        name = resolve_backend()
    if name == "qdrant" and _qdrant_available():
        return QdrantIndex(
            project_path,
            url=url,
            api_key=api_key,
            embedding=embedding,
            collection_prefix=collection_prefix,
        )
    return GrepIndex(project_path)
