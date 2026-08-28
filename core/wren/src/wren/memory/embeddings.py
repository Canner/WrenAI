"""Embedding function abstraction for Wren Memory.

Two interchangeable backends produce the same vectors:

- ``sentence-transformers`` — the original backend, via the ``memory`` extra.
- ``onnx`` — torch-free, via the ``memory-onnx`` extra. Runs the *same*
  weights through onnxruntime, reproducing the sentence-transformers pipeline
  (tokenize, encode, attention-masked mean pooling) so existing LanceDB
  tables stay valid.

``WREN_EMBEDDING_BACKEND=onnx|sentence-transformers`` forces a choice;
otherwise onnx is preferred when importable. Either backend loads from the
local HF cache before falling back to an online-capable load, and model
construction is single-flighted per process.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import threading
from importlib.util import find_spec
from pathlib import Path

_DEFAULT_MODEL = os.getenv(
    "WREN_EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2"
)
_DEFAULT_DIM = 384
_DEFAULT_MAX_SEQ_LENGTH = 128

ONNX_BACKEND = "onnx"
SENTENCE_TRANSFORMERS_BACKEND = "sentence-transformers"


def _disable_transformers_progress_bar() -> None:
    # Imported lazily: transformers ships with the optional `memory` extra,
    # so this module must stay importable when that extra is not installed.
    # The onnx backend does not depend on transformers at all, and this call
    # only silences a progress bar, so its absence is not an error.
    try:
        from transformers.utils import (  # noqa: PLC0415
            logging as transformers_logging,
        )
    except ImportError:
        return

    transformers_logging.disable_progress_bar()


_local_first_embedding_cls = None
_local_first_embedding_cls_lock = threading.Lock()
_model_cache_lock = threading.Lock()
_model_cache: tuple[tuple[str, str, bool], object] | None = None
_onnx_runtime_cache_lock = threading.Lock()
_onnx_runtime_cache: tuple[tuple[str, str], tuple] | None = None


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


def _onnx_available() -> bool:
    return bool(find_spec("onnxruntime")) and bool(find_spec("tokenizers"))


def _sentence_transformers_available() -> bool:
    return bool(find_spec("sentence_transformers"))


def embedding_backend_available() -> bool:
    """True when at least one embedding backend is importable."""
    return _onnx_available() or _sentence_transformers_available()


def resolve_embedding_backend(env: str | None = None) -> str:
    """Return the embedding backend that will actually be used.

    Honors an explicit ``WREN_EMBEDDING_BACKEND=onnx|sentence-transformers``
    (or *env*), else auto-detects. A requested backend whose extra is missing
    falls back to the other one rather than failing: both produce the same
    vectors, so the fallback is invisible to an existing store.
    """
    choice = (
        (env if env is not None else os.environ.get("WREN_EMBEDDING_BACKEND", ""))
        .strip()
        .lower()
    )
    if choice == SENTENCE_TRANSFORMERS_BACKEND and _sentence_transformers_available():
        return SENTENCE_TRANSFORMERS_BACKEND
    if choice == ONNX_BACKEND and _onnx_available():
        return ONNX_BACKEND

    resolved = ONNX_BACKEND if _onnx_available() else SENTENCE_TRANSFORMERS_BACKEND
    if choice in (ONNX_BACKEND, SENTENCE_TRANSFORMERS_BACKEND):
        # Falling back keeps the process running, but someone who asked for
        # onnx specifically to avoid torch should not have to infer from a
        # slow cold start that they did not get it.
        logging.getLogger(__name__).warning(
            "WREN_EMBEDDING_BACKEND=%s was requested but its extra is not "
            "installed; using %s instead. Install wren[%s] to get it.",
            choice,
            resolved,
            "memory-onnx" if choice == ONNX_BACKEND else "memory",
        )
    return resolved


def _resolve_repo_id(model_name: str) -> str:
    """Expand a bare sentence-transformers model name into its HF repo id."""
    return model_name if "/" in model_name else f"sentence-transformers/{model_name}"


def _hf_file(repo_id: str, filename: str) -> str:
    """Resolve *filename* from the local HF cache, then fall back online.

    Mirrors the local-first loading of the sentence-transformers backend: a
    cache miss under ``local_files_only`` raises ``LocalEntryNotFoundError``,
    which is an ``OSError``.
    """
    from huggingface_hub import hf_hub_download  # noqa: PLC0415

    try:
        return hf_hub_download(repo_id, filename, local_files_only=True)
    except OSError:
        return hf_hub_download(repo_id, filename)


def _read_json(repo_id: str, filename: str) -> dict | None:
    """Read a small JSON config from the model repo, or None when absent."""
    try:
        return json.loads(Path(_hf_file(repo_id, filename)).read_text(encoding="utf-8"))
    except OSError:
        return None


def _max_seq_length(repo_id: str) -> int:
    config = _read_json(repo_id, "sentence_bert_config.json") or {}
    value = config.get("max_seq_length")
    return value if isinstance(value, int) and value > 0 else _DEFAULT_MAX_SEQ_LENGTH


def _require_mean_pooling(repo_id: str) -> None:
    """Reject models this backend would silently embed the wrong way.

    Only mean pooling is implemented here. A CLS- or max-pooled model would
    still produce a 384-vector, so without this check it would be indexed
    with quietly wrong vectors instead of failing.
    """
    config = _read_json(repo_id, "1_Pooling/config.json")
    if config is None or config.get("pooling_mode_mean_tokens"):
        return
    active = sorted(
        key.removeprefix("pooling_mode_")
        for key, value in config.items()
        if key.startswith("pooling_mode_") and value
    )
    raise ValueError(
        f"The onnx embedding backend implements mean pooling, but '{repo_id}' "
        f"pools with {active or ['an unrecognized mode']}. Set "
        "WREN_EMBEDDING_BACKEND=sentence-transformers to use this model."
    )


class OnnxEmbeddings:
    """Torch-free embedding function backed by onnxruntime.

    Reproduces the sentence-transformers pipeline for mean-pooling models:
    tokenize to the model's ``max_seq_length``, run the encoder, then average
    the token vectors under the attention mask. The weights are the ONNX
    export published in the same HF repo as the torch weights, so vectors
    match the sentence-transformers backend to float32 rounding and existing
    LanceDB tables stay valid.

    Implements the ``compute_source_embeddings`` / ``compute_query_embeddings``
    pair that :class:`~wren.memory.store.MemoryStore` calls.
    """

    def __init__(self, name: str = _DEFAULT_MODEL):
        self.name = name
        self._repo_id = _resolve_repo_id(name)

    @classmethod
    def create(cls, name: str = _DEFAULT_MODEL, **_kwargs) -> OnnxEmbeddings:
        """Match the ``create`` factory of the sentence-transformers adapter."""
        return cls(name)

    def _runtime(self):
        """Build the tokenizer and session once, single-flighted per process."""
        global _onnx_runtime_cache
        onnx_file = os.getenv("WREN_ONNX_MODEL_FILE", "onnx/model.onnx")
        key = (self._repo_id, onnx_file)

        with _onnx_runtime_cache_lock:
            if _onnx_runtime_cache is not None and _onnx_runtime_cache[0] == key:
                return _onnx_runtime_cache[1]

            import onnxruntime  # noqa: PLC0415
            from tokenizers import Tokenizer  # noqa: PLC0415

            _require_mean_pooling(self._repo_id)

            tokenizer = Tokenizer.from_file(_hf_file(self._repo_id, "tokenizer.json"))
            tokenizer.enable_truncation(max_length=_max_seq_length(self._repo_id))
            tokenizer.enable_padding()

            session = onnxruntime.InferenceSession(
                _hf_file(self._repo_id, onnx_file),
                providers=["CPUExecutionProvider"],
            )
            runtime = (session, tokenizer, {i.name for i in session.get_inputs()})
            _onnx_runtime_cache = (key, runtime)
            return runtime

    def _encode(self, texts: list[str]) -> list:
        import numpy as np  # noqa: PLC0415

        if not texts:
            return []

        session, tokenizer, input_names = self._runtime()
        encodings = tokenizer.encode_batch(texts)
        ids = np.array([e.ids for e in encodings], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)

        feeds = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in input_names:
            feeds["token_type_ids"] = np.zeros_like(ids)

        hidden = session.run(None, feeds)[0]
        # Attention-masked mean pooling, matching 1_Pooling/config.json.
        weights = mask[..., None].astype(np.float32)
        pooled = (hidden * weights).sum(axis=1) / np.clip(
            weights.sum(axis=1), 1e-9, None
        )
        # LanceDB's SentenceTransformerEmbeddings defaults to normalize=True and
        # the sentence-transformers backend does not override it, so every
        # vector already in a store is L2-normalized. Skipping this would leave
        # old and new rows on different scales and skew distance ranking.
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        pooled = pooled / np.clip(norms, 1e-12, None)
        return list(pooled.astype(np.float32))

    def compute_source_embeddings(self, texts) -> list:
        return self._encode(list(texts))

    def compute_query_embeddings(self, query) -> list:
        return self._encode([query] if isinstance(query, str) else list(query))


def get_embedding_function(model_name: str = _DEFAULT_MODEL):
    """Return the embedding function for the resolved backend.

    The returned object implements ``compute_source_embeddings(texts)``
    and ``compute_query_embeddings(query)`` used by :class:`MemoryStore`,
    and both backends emit the same vectors for a given model.

    The adapter is instantiated directly, without mutating LanceDB's registry.
    """
    if resolve_embedding_backend() == ONNX_BACKEND:
        return OnnxEmbeddings.create(name=model_name)

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
