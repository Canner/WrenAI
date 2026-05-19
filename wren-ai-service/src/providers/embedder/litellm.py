import asyncio
import json
import logging
import os
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

import aiohttp
import backoff
import openai
from haystack import Document, component

from src.core.provider import EmbedderProvider
from src.providers.loader import provider
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")

DEFAULT_MAX_EMBED_INPUT_CHARS = 900
MIN_EMBED_INPUT_CHARS = 128


class EmbeddingRequestError(Exception):
    pass


def _normalize_model_name(model: str, api_base_url: Optional[str]) -> str:
    # OpenAI-compatible local servers often expect the raw model name and will
    # reject litellm-style "openai/<model>" prefixes.
    if api_base_url and model.startswith("openai/"):
        return model.split("/", 1)[1]
    return model


def _should_use_minimal_http_client(api_base_url: Optional[str]) -> bool:
    if not api_base_url:
        return False

    return "api.openai.com" not in api_base_url.lower()


def _build_embedding_meta(response: Any) -> Dict[str, Any]:
    usage = getattr(response, "usage", {}) or {}
    usage_dict = dict(usage) if isinstance(usage, dict) or hasattr(usage, "__iter__") else {}

    return {
        "model": getattr(response, "model", ""),
        "usage": usage_dict,
    }


def _get_usage_value(usage: Any, key: str) -> int:
    if isinstance(usage, dict):
        return usage.get(key, 0) or 0

    return getattr(usage, key, 0) or 0


def _coerce_embedding_response(payload: Dict[str, Any]) -> Any:
    data = payload.get("data")
    if not data and payload.get("embedding") is not None:
        data = [{"embedding": payload["embedding"]}]

    if not isinstance(data, list) or not data:
        raise EmbeddingRequestError(
            "Embedding provider returned an invalid response payload."
        )

    normalized_data = []
    for item in data:
        embedding = item.get("embedding") if isinstance(item, dict) else None
        if embedding is None:
            raise EmbeddingRequestError(
                "Embedding provider response did not include an embedding."
            )
        normalized_data.append(SimpleNamespace(embedding=embedding))

    return SimpleNamespace(
        model=payload.get("model", ""),
        data=normalized_data,
        usage=payload.get("usage", {}) or {},
    )


async def _create_embedding_via_http(
    *,
    model: str,
    input_text: str,
    api_key: Optional[str],
    api_base_url: str,
    timeout: Optional[float],
    **kwargs,
):
    endpoint = f"{remove_trailing_slash(api_base_url)}/embeddings"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": _normalize_model_name(model, api_base_url),
        "input": input_text,
    }
    payload.update({key: value for key, value in kwargs.items() if value is not None})

    client_timeout = aiohttp.ClientTimeout(total=timeout) if timeout else None
    async with aiohttp.ClientSession() as session:
        async with session.post(
            endpoint,
            json=payload,
            headers=headers,
            timeout=client_timeout,
        ) as response:
            body = await response.text()
            if response.status >= 400:
                raise EmbeddingRequestError(
                    f"Embedding request failed with status {response.status}: {body}"
                )

            try:
                payload = json.loads(body)
            except json.JSONDecodeError as error:
                raise EmbeddingRequestError(
                    "Embedding provider returned a non-JSON response."
                ) from error

    return _coerce_embedding_response(payload)


async def _create_embedding(
    *,
    model: str,
    input_text: str,
    api_key: Optional[str],
    api_base_url: Optional[str],
    timeout: Optional[float],
    **kwargs,
):
    if _should_use_minimal_http_client(api_base_url):
        return await _create_embedding_via_http(
            model=model,
            input_text=input_text,
            api_key=api_key,
            api_base_url=api_base_url,
            timeout=timeout,
            **kwargs,
        )

    client = openai.AsyncOpenAI(
        api_key=api_key,
        base_url=api_base_url,
        timeout=timeout,
    )
    return await client.embeddings.create(
        model=_normalize_model_name(model, api_base_url),
        input=input_text,
        **kwargs,
    )


def _truncate_text_for_embedding(text: str, max_input_chars: int) -> str:
    if len(text) <= max_input_chars:
        return text

    return text[:max_input_chars].rstrip() + "..."


def _is_input_too_large_error(error: Exception) -> bool:
    error_message = str(error).lower()
    return any(
        phrase in error_message
        for phrase in [
            "too large to process",
            "context size has been exceeded",
            "physical batch size",
            "input (",
        ]
    )


def _prepare_texts_to_embed(
    documents: List[Document], max_input_chars: int
) -> List[str]:
    """
    Prepare the texts to embed by concatenating the Document text with the metadata fields to embed.
    """
    texts_to_embed = []
    for doc in documents:
        text_to_embed = "\n".join([doc.content or ""])

        # copied from OpenAI embedding_utils (https://github.com/openai/openai-python/blob/main/openai/embeddings_utils.py)
        # replace newlines, which can negatively affect performance.
        text_to_embed = text_to_embed.replace("\n", " ")
        text_to_embed = _truncate_text_for_embedding(text_to_embed, max_input_chars)
        texts_to_embed.append(text_to_embed)
    return texts_to_embed


def _iter_batches(items: List[str], batch_size: int) -> List[List[str]]:
    effective_batch_size = max(batch_size, 1)
    return [
        items[index : index + effective_batch_size]
        for index in range(0, len(items), effective_batch_size)
    ]


@component
class AsyncTextEmbedder:
    def __init__(
        self,
        model: str,
        api_key: Optional[str] = None,
        api_base_url: Optional[str] = None,
        timeout: Optional[float] = None,
        max_input_chars: int = DEFAULT_MAX_EMBED_INPUT_CHARS,
        **kwargs,
    ):
        self._api_key = api_key
        self._model = model
        self._api_base_url = api_base_url
        self._timeout = timeout
        self._max_input_chars = max(max_input_chars, 1)
        self._kwargs = kwargs

    @component.output_types(embedding=List[float], meta=Dict[str, Any])
    @backoff.on_exception(
        backoff.expo,
        (aiohttp.ClientError, asyncio.TimeoutError, EmbeddingRequestError, openai.APIError),
        max_time=60.0,
        max_tries=3,
    )
    async def run(self, text: str):
        if not isinstance(text, str):
            raise TypeError(
                "AsyncTextEmbedder expects a string as an input."
                "In case you want to embed a list of Documents, please use the AsyncDocumentEmbedder."
            )

        # copied from OpenAI embedding_utils (https://github.com/openai/openai-python/blob/main/openai/embeddings_utils.py)
        # replace newlines, which can negatively affect performance.
        text_to_embed = text.replace("\n", " ")
        text_to_embed = _truncate_text_for_embedding(
            text_to_embed,
            self._max_input_chars,
        )

        response = await _create_embedding(
            model=self._model,
            input_text=text_to_embed,
            api_key=self._api_key,
            api_base_url=self._api_base_url,
            timeout=self._timeout,
            **self._kwargs,
        )

        meta = _build_embedding_meta(response)

        return {"embedding": response.data[0].embedding, "meta": meta}


@component
class AsyncDocumentEmbedder:
    def __init__(
        self,
        model: str,
        batch_size: int = 32,
        api_key: Optional[str] = None,
        api_base_url: Optional[str] = None,
        timeout: Optional[float] = None,
        max_input_chars: int = DEFAULT_MAX_EMBED_INPUT_CHARS,
        **kwargs,
    ):
        self._api_key = api_key
        self._model = model
        self._batch_size = batch_size
        self._api_base_url = api_base_url
        self._timeout = timeout
        self._max_input_chars = max(max_input_chars, 1)
        self._kwargs = kwargs

    async def _embed_batch(
        self, texts_to_embed: List[str], batch_size: int
    ) -> Tuple[List[List[float]], Dict[str, Any]]:
        # Some OpenAI-compatible local embedding servers accept scalar string input
        # but fail on array input. Embed documents individually to avoid that path.
        async def embed_single_text(text: str) -> Any:
            candidate_text = text
            while True:
                try:
                    return await _create_embedding(
                        model=self._model,
                        input_text=candidate_text,
                        api_key=self._api_key,
                        api_base_url=self._api_base_url,
                        timeout=self._timeout,
                        **self._kwargs,
                    )
                except (
                    aiohttp.ClientError,
                    asyncio.TimeoutError,
                    EmbeddingRequestError,
                    openai.APIError,
                ) as error:
                    if (
                        not _is_input_too_large_error(error)
                        or len(candidate_text) <= MIN_EMBED_INPUT_CHARS
                    ):
                        raise

                    next_max_chars = max(len(candidate_text) // 2, MIN_EMBED_INPUT_CHARS)
                    logger.warning(
                        "Embedding input exceeded provider limits; retrying with %s characters",
                        next_max_chars,
                    )
                    candidate_text = _truncate_text_for_embedding(
                        candidate_text,
                        next_max_chars,
                    )

        all_embeddings = []
        meta: Dict[str, Any] = {}

        for batch in _iter_batches(texts_to_embed, batch_size):
            responses = await asyncio.gather(
                *[embed_single_text(text) for text in batch]
            )

            for response in responses:
                embeddings = [
                    el.embedding if hasattr(el, "embedding") else el["embedding"]
                    for el in response.data
                ]
                all_embeddings.extend(embeddings)

                if "model" not in meta:
                    meta["model"] = getattr(response, "model", "")
                if "usage" not in meta:
                    meta["usage"] = _build_embedding_meta(response)["usage"]
                else:
                    if hasattr(response, "usage"):
                        meta["usage"]["prompt_tokens"] += _get_usage_value(
                            response.usage,
                            "prompt_tokens",
                        )
                        meta["usage"]["total_tokens"] += _get_usage_value(
                            response.usage,
                            "total_tokens",
                        )

        return all_embeddings, meta

    @component.output_types(documents=List[Document], meta=Dict[str, Any])
    @backoff.on_exception(
        backoff.expo,
        (aiohttp.ClientError, asyncio.TimeoutError, EmbeddingRequestError, openai.APIError),
        max_time=60.0,
        max_tries=3,
    )
    async def run(self, documents: List[Document]):
        if (
            not isinstance(documents, list)
            or documents
            and not isinstance(documents[0], Document)
        ):
            raise TypeError(
                "AsyncDocumentEmbedder expects a list of Documents as input."
                "In case you want to embed a string, please use the AsyncTextEmbedder."
            )

        if not documents:
            return {"documents": documents, "meta": {}}

        texts_to_embed = _prepare_texts_to_embed(
            documents=documents,
            max_input_chars=self._max_input_chars,
        )

        embeddings, meta = await self._embed_batch(
            texts_to_embed=texts_to_embed,
            batch_size=self._batch_size,
        )

        for doc, emb in zip(documents, embeddings):
            doc.embedding = emb

        return {"documents": documents, "meta": meta}


@provider("litellm_embedder")
class LitellmEmbedderProvider(EmbedderProvider):
    def __init__(
        self,
        model: str,
        api_key_name: Optional[
            str
        ] = None,  # e.g. EMBEDDER_OPENAI_API_KEY, EMBEDDER_ANTHROPIC_API_KEY, etc.
        api_base: Optional[str] = None,
        timeout: float = 120.0,
        **kwargs,
    ):
        self._api_key = os.getenv(api_key_name) if api_key_name else None
        self._api_base = remove_trailing_slash(api_base) if api_base else None
        self._embedding_model = model
        self._timeout = timeout
        if "provider" in kwargs:
            del kwargs["provider"]
        self._kwargs = kwargs

    def get_text_embedder(self):
        return AsyncTextEmbedder(
            api_key=self._api_key,
            api_base_url=self._api_base,
            model=self._embedding_model,
            timeout=self._timeout,
            **self._kwargs,
        )

    def get_document_embedder(self):
        return AsyncDocumentEmbedder(
            api_key=self._api_key,
            api_base_url=self._api_base,
            model=self._embedding_model,
            timeout=self._timeout,
            **self._kwargs,
        )
