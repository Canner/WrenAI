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
# Matches SentenceTransformer.encode's default batch_size, so peak memory
# per encode call is the same on both backends.
_ENCODE_BATCH_SIZE = 32

ONNX_BACKEND = "onnx"
SENTENCE_TRANSFORMERS_BACKEND = "sentence-transformers"


class OnnxBackendError(RuntimeError):
    """The onnx backend cannot serve the configured model.

    Deliberately not a ``ValueError``: the CLI reports those as a malformed
    manifest, and none of these are a manifest problem. Every subclass names
    ``WREN_EMBEDDING_BACKEND=sentence-transformers`` in its message, because
    that is the way out of all of them.
    """


class UnsupportedPoolingError(OnnxBackendError):
    """The onnx backend cannot reproduce this model's pooling mode."""


class MissingOnnxExportError(OnnxBackendError):
    """The model repo does not publish the ONNX graph this backend needs."""


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
                """Load from the HF cache first, then fall back online."""
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
    """True when the ``memory-onnx`` extra is importable."""
    return bool(find_spec("onnxruntime")) and bool(find_spec("tokenizers"))


def _sentence_transformers_available() -> bool:
    """True when the ``memory`` extra is importable."""
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


def _is_absent_from_repo(error: OSError) -> bool:
    """True when the hub answered "no such file", as opposed to not answering.

    A remote 404 is the only response that means the repo does not publish the
    file. ``LocalEntryNotFoundError`` is the opposite -- nothing cached *and*
    the hub unreachable -- and a rate limit or dropped connection say nothing
    about the file at all. Reporting either as absence is how a transient
    fault acquires a permanent-sounding explanation.

    Tested against the pair rather than ``RemoteEntryNotFoundError``, which
    only exists from huggingface-hub 1.x; the pair discriminates identically
    on both. Needs >= 0.25 all the same, which is where they moved into
    ``huggingface_hub.errors`` -- before that this import raises inside the
    caller's ``except`` handler, replacing the error being classified.
    """
    from huggingface_hub.errors import (  # noqa: PLC0415
        EntryNotFoundError,
        LocalEntryNotFoundError,
    )

    return isinstance(error, EntryNotFoundError) and not isinstance(
        error, LocalEntryNotFoundError
    )


def _read_json(repo_id: str, filename: str) -> dict | None:
    """Read a small JSON config from the model repo, or None when absent.

    "Absent" means the hub answered 404. A cache miss that could not be
    checked online, a rate limit and a dropped connection are not absence, and
    neither is a corrupt file. The distinction matters because
    ``_require_mean_pooling`` reads "absent" as "assume mean pooling": report
    any of those as absence and a network blip waves a CLS-pooled model
    through with quietly wrong vectors. ``json.JSONDecodeError`` is also a
    ``ValueError``, so letting it escape would put it behind the CLI's
    "Malformed manifest:".
    """
    try:
        path = _hf_file(repo_id, filename)
    except OSError as e:
        if _is_absent_from_repo(e):
            return None
        raise OnnxBackendError(
            f"'{filename}' for '{repo_id}' could not be fetched: {e}. Whether "
            "this model is usable here could not be determined; retry with the "
            "Hugging Face cache or network available, or set "
            "WREN_EMBEDDING_BACKEND=sentence-transformers."
        ) from e
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise OnnxBackendError(
            f"'{filename}' for '{repo_id}' could not be read: {e}. The cached "
            f"copy at {path} looks corrupt; delete it to refetch, or set "
            "WREN_EMBEDDING_BACKEND=sentence-transformers."
        ) from e


def _max_seq_length(repo_id: str) -> int:
    """Read the model's truncation length, falling back to the ST default.

    ONNX-native mirrors publish ``onnx/model.onnx`` but no
    ``sentence_bert_config.json``, so the default is what an onnx user
    typically gets. It is correct for the 128-length models, but a 512-length
    model would truncate here with no other signal, hence the log line. Note
    ``config.json``'s ``max_position_embeddings`` is *not* a usable fallback:
    the default model reports 512 there against a real length of 128, so
    reading it would diverge from the sentence-transformers backend.
    """
    try:
        config = _read_json(repo_id, "sentence_bert_config.json") or {}
    except OnnxBackendError:
        # Truncation length is soft where pooling mode is not. An ONNX-native
        # mirror legitimately ships no sentence_bert_config.json, so an
        # offline run with the rest of the model cached should fall back here
        # rather than fail -- getting the length wrong degrades recall,
        # getting the pooling wrong corrupts the index.
        config = {}
    value = config.get("max_seq_length")
    if isinstance(value, int) and value > 0:
        return value
    logging.getLogger(__name__).debug(
        "'%s' declares no max_seq_length; truncating at the default of %d.",
        repo_id,
        _DEFAULT_MAX_SEQ_LENGTH,
    )
    return _DEFAULT_MAX_SEQ_LENGTH


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
    raise UnsupportedPoolingError(
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
        """Record the model name; the session is built lazily on first encode."""
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

            try:
                onnx_path = _hf_file(self._repo_id, onnx_file)
            except OSError as e:
                # onnx is selected on importability alone, so a
                # WREN_EMBEDDING_MODEL that works under sentence-transformers
                # reaches this. Only a 404 means the export is really missing;
                # anything else and the remedy is to retry, not to switch
                # backends. Deliberately not falling back on the 404 either:
                # quietly loading torch is the outcome this extra exists to
                # avoid, so name the override and let the caller choose.
                if _is_absent_from_repo(e):
                    raise MissingOnnxExportError(
                        f"'{self._repo_id}' does not publish '{onnx_file}', "
                        "which the onnx embedding backend needs. Set "
                        "WREN_EMBEDDING_BACKEND=sentence-transformers to use "
                        "this model, or point WREN_ONNX_MODEL_FILE at the "
                        "right path."
                    ) from e
                raise OnnxBackendError(
                    f"'{onnx_file}' could not be fetched for '{self._repo_id}': "
                    f"{e}. Retry when the Hugging Face cache or network is "
                    "available, or set "
                    "WREN_EMBEDDING_BACKEND=sentence-transformers."
                ) from e

            session = onnxruntime.InferenceSession(
                onnx_path,
                providers=["CPUExecutionProvider"],
            )
            runtime = (session, tokenizer, {i.name for i in session.get_inputs()})
            _onnx_runtime_cache = (key, runtime)
            return runtime

    def _encode(self, texts: list[str]) -> list:
        """Tokenize, run the encoder, mean-pool under the mask, L2 normalize.

        Runs in fixed-size chunks. ``SentenceTransformer.encode`` defaults to
        ``batch_size=32`` and lancedb's adapter does not override it, so
        feeding a whole manifest to one ``session.run`` would make peak memory
        scale with the manifest on this backend alone. Mean pooling and
        normalization are both per-row, so chunking cannot move a vector; it
        also confines padding to each chunk instead of the whole batch.
        """
        import numpy as np  # noqa: PLC0415

        if not texts:
            return []

        session, tokenizer, input_names = self._runtime()
        vectors: list = []
        for start in range(0, len(texts), _ENCODE_BATCH_SIZE):
            encodings = tokenizer.encode_batch(
                texts[start : start + _ENCODE_BATCH_SIZE]
            )
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
            # LanceDB's SentenceTransformerEmbeddings defaults to normalize=True
            # and the sentence-transformers backend does not override it, so
            # every vector already in a store is L2-normalized. Skipping this
            # would leave old and new rows on different scales and skew
            # distance ranking.
            norms = np.linalg.norm(pooled, axis=1, keepdims=True)
            pooled = pooled / np.clip(norms, 1e-12, None)
            vectors.extend(pooled.astype(np.float32))
        return vectors

    def compute_source_embeddings(self, texts) -> list:
        """Embed documents for indexing."""
        return self._encode(list(texts))

    def compute_query_embeddings(self, query) -> list:
        """Embed one query string, or a batch of them."""
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
