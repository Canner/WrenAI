import logging
import os
import time
from typing import Any, Dict, List, Optional

import aiohttp
from haystack import Document, component
from haystack_integrations.components.embedders.ollama import (
    OllamaDocumentEmbedder,
    OllamaTextEmbedder,
)
from tqdm import tqdm

from src.core.provider import EmbedderProvider
from src.providers.loader import provider
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")

EMBEDDER_OLLAMA_URL = "http://localhost:11434"
EMBEDDING_MODEL = "nomic-embed-text:latest"


@component
class AsyncTextEmbedder(OllamaTextEmbedder):
    def __init__(
        self,
        model: str = "nomic-embed-text",
        url: str = "http://localhost:11434/api/embeddings",
        generation_kwargs: Optional[Dict[str, Any]] = None,
        timeout: int = 120,
    ):
        super(AsyncTextEmbedder, self).__init__(
            model=model,
            url=url,
            generation_kwargs=generation_kwargs,
            timeout=timeout,
        )

    @component.output_types(embedding=List[float], meta=Dict[str, Any])
    async def run(
        self,
        text: str,
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        payload = self._create_json_payload(text, generation_kwargs)

        start = time.perf_counter()
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(self.timeout)
        ) as session:
            async with session.post(
                self.url,
                json=payload,
            ) as response:
                elapsed = time.perf_counter() - start
                result = await response.json()

        result["meta"] = {"model": self.model, "duration": elapsed}

        return result


@component
class AsyncDocumentEmbedder(OllamaDocumentEmbedder):
    def __init__(
        self,
        model: str = "nomic-embed-text",
        url: str = "http://localhost:11434/api/embeddings",
        generation_kwargs: Optional[Dict[str, Any]] = None,
        timeout: int = 120,
        prefix: str = "",
        suffix: str = "",
        progress_bar: bool = True,
        meta_fields_to_embed: Optional[List[str]] = None,
        embedding_separator: str = "\n",
    ):
        super(AsyncDocumentEmbedder, self).__init__(
            model=model,
            url=url,
            generation_kwargs=generation_kwargs,
            timeout=timeout,
            prefix=prefix,
            suffix=suffix,
            progress_bar=progress_bar,
            meta_fields_to_embed=meta_fields_to_embed,
            embedding_separator=embedding_separator,
        )

    async def _embed_batch(
        self,
        texts_to_embed: List[str],
        batch_size: int,
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        """
        Ollama Embedding only allows single uploads, not batching. Currently the batch size is set to 1.
        If this changes in the future, line 86 (the first line within the for loop), can contain:
            batch = texts_to_embed[i + i + batch_size]
        """

        all_embeddings = []
        meta: Dict[str, Any] = {"model": self.model}

        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(self.timeout)
        ) as session:
            for i in tqdm(
                range(0, len(texts_to_embed), batch_size),
                disable=not self.progress_bar,
                desc="Calculating embeddings",
            ):
                batch = texts_to_embed[i]  # Single batch only
                payload = self._create_json_payload(batch, generation_kwargs)

                async with session.post(
                    self.url,
                    json=payload,
                ) as response:
                    result = await response.json()
                    all_embeddings.append(result["embedding"])

        return all_embeddings, meta

    @component.output_types(embedding=List[float], meta=Dict[str, Any])
    async def run(
        self,
        documents: List[str],
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        if (
            not isinstance(documents, list)
            or documents
            and not isinstance(documents[0], Document)
        ):
            msg = (
                "OllamaDocumentEmbedder expects a list of Documents as input."
                "In case you want to embed a list of strings, please use the OllamaTextEmbedder."
            )
            raise TypeError(msg)

        texts_to_embed = self._prepare_texts_to_embed(documents=documents)
        embeddings, meta = await self._embed_batch(
            texts_to_embed=texts_to_embed,
            batch_size=self.batch_size,
            generation_kwargs=generation_kwargs,
        )

        for doc, emb in zip(documents, embeddings):
            doc.embedding = emb

        return {"documents": documents, "meta": meta}


@provider("ollama_embedder")
class OllamaEmbedderProvider(EmbedderProvider):
    def __init__(
        self,
        url: str = os.getenv("EMBEDDER_OLLAMA_URL") or EMBEDDER_OLLAMA_URL,
        model: str = os.getenv("EMBEDDING_MODEL") or EMBEDDING_MODEL,
        timeout: Optional[int] = (
            int(os.getenv("EMBEDDER_TIMEOUT")) if os.getenv("EMBEDDER_TIMEOUT") else 120
        ),
        **_,
    ):
        self._url = remove_trailing_slash(url)
        self._embedding_model = model
        self._timeout = timeout

        logger.info(f"Using Ollama Embedding Model: {self._embedding_model}")
        logger.info(f"Using Ollama URL: {self._url}")

    def get_text_embedder(
        self,
        model_kwargs: Optional[Dict[str, Any]] = None,
    ):
        return AsyncTextEmbedder(
            model=self._embedding_model,
            url=f"{self._url}/api/embeddings",
            generation_kwargs=model_kwargs,
            timeout=self._timeout,
        )

    def get_document_embedder(
        self,
        model_kwargs: Optional[Dict[str, Any]] = None,
    ):
        return AsyncDocumentEmbedder(
            model=self._embedding_model,
            url=f"{self._url}/api/embeddings",
            generation_kwargs=model_kwargs,
            timeout=self._timeout,
        )
