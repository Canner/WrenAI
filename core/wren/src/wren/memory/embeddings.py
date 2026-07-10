"""Embedding providers for Wren Memory.

The default provider calls the Volcengine Ark (火山方舟) embedding API, which is
OpenAI-compatible and reached through the ``openai`` SDK pointed at the Ark
``base_url``. A deterministic :class:`FakeEmbedding` is provided for tests so
the storage/search layer can be exercised without network access.

Configuration (environment variables):
  - ``VOLC_ARK_API_KEY``      - Ark API key (required for :class:`VolcArkEmbedding`)
  - ``VOLC_ARK_BASE_URL``     - Ark base URL (default: ark.cn-beijing.volces.com/api/v3)
  - ``WREN_EMBEDDING_MODEL``  - model name (default: doubao-embedding-text-240715)
  - ``WREN_EMBEDDING_BATCH_SIZE`` - texts per API call (default: 16)
"""

from __future__ import annotations

import hashlib
import os
from abc import ABC, abstractmethod
from collections.abc import Sequence

_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
_DEFAULT_MODEL = os.getenv("WREN_EMBEDDING_MODEL", "doubao-embedding-text-240715")
_DEFAULT_BATCH_SIZE = int(os.getenv("WREN_EMBEDDING_BATCH_SIZE", "10"))


class EmbeddingProvider(ABC):
    """Abstract embedding provider.

    Implementations return one float vector per input text. The vector
    dimension is exposed via :attr:`dim` so stores can size their index at
    creation time.
    """

    name: str

    @property
    @abstractmethod
    def dim(self) -> int:
        """Vector dimension produced by this provider."""

    @abstractmethod
    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        """Return one embedding vector per input text, in order."""


class VolcArkEmbedding(EmbeddingProvider):
    """Volcengine Ark (火山方舟) embedding via the OpenAI-compatible SDK.

    The Ark embedding endpoint mirrors the OpenAI ``/embeddings`` schema, so
    the ``openai`` client is reused with a custom ``base_url``. Input is split
    into batches of ``WREN_EMBEDDING_BATCH_SIZE`` to stay under the API's
    per-call input limit; the SDK retries transient failures internally.
    """

    name = "volc-ark"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        batch_size: int | None = None,
    ) -> None:
        from openai import OpenAI  # noqa: PLC0415 - lazy: keep CLI startup light

        resolved_key = api_key or os.environ.get("VOLC_ARK_API_KEY")
        if not resolved_key:
            raise RuntimeError(
                "VOLC_ARK_API_KEY is not set. Export it as your Volcengine Ark "
                "API key (or pass api_key=... explicitly)."
            )
        self._model = model or _DEFAULT_MODEL
        self._batch_size = batch_size or _DEFAULT_BATCH_SIZE
        self._client = OpenAI(
            api_key=resolved_key,
            base_url=base_url
            or os.environ.get("VOLC_ARK_BASE_URL", _DEFAULT_BASE_URL),
        )
        self._dim: int | None = None

    @property
    def dim(self) -> int:
        # The Ark API does not expose dimension out-of-band; probe once and
        # cache. This also validates credentials/base_url on first use.
        if self._dim is None:
            self._dim = len(self.embed_texts(["probe"])[0])
        return self._dim

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        results: list[list[float]] = []
        size = self._batch_size
        for start in range(0, len(texts), size):
            batch = list(texts[start : start + size])
            resp = self._client.embeddings.create(model=self._model, input=batch)
            # Ark guarantees one entry per input, ordered by index.
            ordered = sorted(resp.data, key=lambda d: d.index)
            results.extend(d.embedding for d in ordered)
            if self._dim is None and ordered:
                self._dim = len(ordered[0].embedding)
        return results


class FakeEmbedding(EmbeddingProvider):
    """Deterministic, network-free embedding for tests.

    Vectors are derived from a SHA-256 of the text, so the same input always
    yields the same vector. This is not semantically meaningful - it exists so
    the Qdrant store/recall plumbing can be tested without hitting the Ark API.
    """

    name = "fake"

    def __init__(self, dim: int = 8) -> None:
        self._dim = dim

    @property
    def dim(self) -> int:
        return self._dim

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for t in texts:
            digest = hashlib.sha256(t.encode("utf-8")).digest()
            # Map bytes to [-1, 1], cycling through the digest to fill `dim`.
            vec = [(digest[i % len(digest)] / 255.0) * 2 - 1 for i in range(self._dim)]
            out.append(vec)
        return out


def get_default_embedding() -> EmbeddingProvider:
    """Return the default embedding provider, selected by WREN_EMBEDDING_PROVIDER.

    - ``fake``: deterministic, network-free FakeEmbedding (dev/debug, no API key)
    - anything else / unset: VolcArkEmbedding (Volcengine Ark API)
    """
    provider = os.getenv("WREN_EMBEDDING_PROVIDER", "").strip().lower()
    if provider == "fake":
        return FakeEmbedding()
    return VolcArkEmbedding()


__all__ = ["EmbeddingProvider", "VolcArkEmbedding", "FakeEmbedding", "get_default_embedding"]
