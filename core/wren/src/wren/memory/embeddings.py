"""
Uses LanceDB's embedding registry with sentence-transformers (local, no API key).
"""

from transformers.utils import logging as transformers_logging

transformers_logging.disable_progress_bar()

from lancedb.embeddings import get_registry


# Register the sentence-transformers embedding function so LanceDB can use it.
try:
    registry = get_registry()
    # The "sentence-transformers" embedding function is registered by LanceDB
    # when sentence_transformers is importable.
    _SENTENCE_TRANSFORMERS_AVAILABLE = "sentence-transformers" in registry
except Exception:
    _SENTENCE_TRANSFORMERS_AVAILABLE = False


def get_embedding_function():
    """
    Return a LanceDB-compatible embedding function for sentence-transformers.

    Returns:
        A callable that accepts a batch of strings and returns a list of embeddings.
        Each embedding is a list of floats (1024-dimensional for the default
        all-MiniLM-L6-v2 model).

    Raises:
        ImportError: If sentence-transformers or lancedb is not installed.
    """
    if not _SENTENCE_TRANSFORMERS_AVAILABLE:
        raise ImportError(
            "sentence-transformers not available. Install with: pip install 'wrenai[memory]'"
        )
    registry = get_registry()
    return registry.get("sentence-transformers").create()
