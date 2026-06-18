"""Embedding function abstraction for Wren Memory.

Uses LanceDB's embedding registry with sentence-transformers (local, no API key).
"""

from __future__ import annotations

import contextlib
import os

from transformers.utils import logging as transformers_logging

_DEFAULT_MODEL = os.getenv(
    "WREN_EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2"
)
_DEFAULT_DIM = 384


def _disable_transformers_progress_bar() -> None:
    transformers_logging.disable_progress_bar()


def get_embedding_function(model_name: str = _DEFAULT_MODEL):
    """Return a LanceDB sentence-transformers embedding function.

    The returned object implements ``compute_source_embeddings(texts)``
    and ``compute_query_embeddings(query)`` used by :class:`MemoryStore`.
    """
    _disable_transformers_progress_bar()

    import lancedb.embeddings  # noqa: PLC0415

    registry = lancedb.embeddings.get_registry()
    return registry.get("sentence-transformers").create(name=model_name)


@contextlib.contextmanager
def suppress_stderr():
    """Temporarily redirect stderr to /dev/null.

    Suppresses noisy native output (progress bars, load reports) from
    sentence-transformers / candle during model loading.
    """
    old_fd = os.dup(2)
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 2)
    os.close(devnull)
    try:
        yield
    finally:
        os.dup2(old_fd, 2)
        os.close(old_fd)


def warm_up(embed_fn):
    """Trigger model loading silently and return the vector dimension."""
    _disable_transformers_progress_bar()
    with suppress_stderr():
        probe = embed_fn.compute_source_embeddings(["probe"])
    return len(probe[0])


def default_dimension() -> int:
    """Return the vector dimension for the default model."""
    return _DEFAULT_DIM
