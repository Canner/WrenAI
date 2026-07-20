"""Embedding function abstraction for Wren Memory.

The sentence-transformer loads from the local HF cache before falling back to
an online-capable load. Model construction is single-flighted per process.
"""

from __future__ import annotations

import contextlib
import os
import threading

_DEFAULT_MODEL = os.getenv(
    "WREN_EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2"
)
_DEFAULT_DIM = 384


def _disable_transformers_progress_bar() -> None:
    # Imported lazily: transformers ships with the optional `memory` extra,
    # so this module must stay importable when that extra is not installed.
    from transformers.utils import logging as transformers_logging  # noqa: PLC0415

    transformers_logging.disable_progress_bar()


_local_first_embedding_cls = None
_local_first_embedding_cls_lock = threading.Lock()
_model_cache_lock = threading.Lock()
_model_cache: tuple[tuple[str, str, bool], object] | None = None


def _get_local_first_embedding_class():
    """Build the adapter lazily so importing this module needs no memory extra."""
    global _local_first_embedding_cls
    with _local_first_embedding_cls_lock:
        if _local_first_embedding_cls is not None:
            return _local_first_embedding_cls

        import lancedb.embeddings.sentence_transformers as lancedb_st  # noqa: PLC0415

        class LocalFirstSentenceTransformerEmbeddings(
            lancedb_st.SentenceTransformerEmbeddings
        ):
            """Sentence-transformers embedding function with local-first loading."""

            def get_embedding_model(self):
                global _model_cache
                key = (self.name, self.device, self.trust_remote_code)

                with _model_cache_lock:
                    if _model_cache is not None and _model_cache[0] == key:
                        return _model_cache[1]

                    import sentence_transformers  # noqa: PLC0415

                    try:
                        model = sentence_transformers.SentenceTransformer(
                            self.name,
                            device=self.device,
                            trust_remote_code=self.trust_remote_code,
                            local_files_only=True,
                        )
                    except OSError:
                        model = sentence_transformers.SentenceTransformer(
                            self.name,
                            device=self.device,
                            trust_remote_code=self.trust_remote_code,
                        )
                    _model_cache = (key, model)
                    return model

        _local_first_embedding_cls = LocalFirstSentenceTransformerEmbeddings
        return _local_first_embedding_cls


def get_embedding_function(model_name: str = _DEFAULT_MODEL):
    """Return a LanceDB sentence-transformers embedding function.

    The returned object implements ``compute_source_embeddings(texts)``
    and ``compute_query_embeddings(query)`` used by :class:`MemoryStore`.

    The adapter is instantiated directly, without mutating LanceDB's registry.
    """
    _disable_transformers_progress_bar()

    local_first_cls = _get_local_first_embedding_class()
    return local_first_cls.create(name=model_name)


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
