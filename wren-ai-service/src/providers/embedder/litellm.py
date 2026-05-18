import asyncio
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import backoff
import openai
from haystack import Document, component

from src.core.provider import EmbedderProvider
from src.providers.loader import provider
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")

DEFAULT_MAX_EMBED_INPUT_CHARS = 1800


def _normalize_model_name(model: str, api_base_url: Optional[str]) -> str:
    # OpenAI-compatible local servers often expect the raw model name and will
    # reject litellm-style "openai/<model>" prefixes.
    if api_base_url and model.startswith("openai/"):
        return model.split("/", 1)[1]
    return model


async def _create_embedding(
    *,
    model: str,
    input_text: str,
    api_key: Optional[str],
    api_base_url: Optional[str],
    timeout: Optional[float],
    **kwargs,
):
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
    @backoff.on_exception(backoff.expo, openai.APIError, max_time=60.0, max_tries=3)
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

        meta = {
            "model": response.model,
            "usage": dict(response.usage) if hasattr(response, "usage") else {},
        }

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
            return await _create_embedding(
                model=self._model,
                input_text=text,
                api_key=self._api_key,
                api_base_url=self._api_base_url,
                timeout=self._timeout,
                **self._kwargs,
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
                    meta["model"] = response.model
                if "usage" not in meta:
                    meta["usage"] = (
                        dict(response.usage) if hasattr(response, "usage") else {}
                    )
                else:
                    if hasattr(response, "usage"):
                        meta["usage"]["prompt_tokens"] += response.usage.prompt_tokens
                        meta["usage"]["total_tokens"] += response.usage.total_tokens

        return all_embeddings, meta

    @component.output_types(documents=List[Document], meta=Dict[str, Any])
    @backoff.on_exception(backoff.expo, openai.APIError, max_time=60.0, max_tries=3)
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
