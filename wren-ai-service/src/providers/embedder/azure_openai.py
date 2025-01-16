import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import backoff
import openai
from haystack import Document, component
from haystack.components.embedders import (
    AzureOpenAIDocumentEmbedder,
    AzureOpenAITextEmbedder,
)
from haystack.utils import Secret
from openai import AsyncAzureOpenAI
from tqdm import tqdm

from src.core.provider import EmbedderProvider
from src.providers.loader import provider
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")

EMBEDDING_MODEL = "text-embedding-3-small"


@component
class AsyncTextEmbedder(AzureOpenAITextEmbedder):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("EMBEDDER_AZURE_OPENAI_API_KEY"),
        model: str = "text-embedding-3-small",
        dimensions: Optional[int] = None,
        api_base_url: Optional[str] = None,
        api_version: Optional[str] = None,
        organization: Optional[str] = None,
        timeout: Optional[float] = None,
        prefix: str = "",
        suffix: str = "",
    ):
        super(AsyncTextEmbedder, self).__init__(
            azure_endpoint=api_base_url,
            api_version=api_version,
            azure_deployment=model,
            dimensions=dimensions,
            api_key=api_key,
            organization=organization,
            prefix=prefix,
            suffix=suffix,
            timeout=timeout,
        )

        self.client = AsyncAzureOpenAI(
            azure_endpoint=api_base_url,
            azure_deployment=model,
            api_version=api_version,
            api_key=api_key.resolve_value(),
        )

    @component.output_types(embedding=List[float], meta=Dict[str, Any])
    @backoff.on_exception(backoff.expo, openai.APIError, max_time=60.0, max_tries=3)
    async def run(self, text: str):
        if not isinstance(text, str):
            raise TypeError(
                "AzureOpenAITextEmbedder expects a string as an input."
                "In case you want to embed a list of Documents, please use the AzureOpenAIDocumentEmbedder."
            )

        logger.info(f"Running Async Azure OpenAI text embedder with text: {text}")

        text_to_embed = self.prefix + text + self.suffix

        # copied from OpenAI embedding_utils (https://github.com/openai/openai-python/blob/main/openai/embeddings_utils.py)
        # replace newlines, which can negatively affect performance.
        text_to_embed = text_to_embed.replace("\n", " ")

        if self.dimensions is not None:
            response = await self.client.embeddings.create(
                model=self.azure_deployment,
                dimensions=self.dimensions,
                input=text_to_embed,
            )
        else:
            response = await self.client.embeddings.create(
                model=self.azure_deployment, input=text_to_embed
            )

        meta = {"model": response.model, "usage": dict(response.usage)}

        return {"embedding": response.data[0].embedding, "meta": meta}


@component
class AsyncDocumentEmbedder(AzureOpenAIDocumentEmbedder):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("EMBEDDER_AZURE_OPENAI_API_KEY"),
        model: str = "text-embedding-3-small",
        dimensions: Optional[int] = None,
        api_base_url: Optional[str] = None,
        api_version: Optional[str] = None,
        organization: Optional[str] = None,
        prefix: str = "",
        suffix: str = "",
        batch_size: int = 32,
        progress_bar: bool = True,
        meta_fields_to_embed: Optional[List[str]] = None,
        embedding_separator: str = "\n",
        timeout: Optional[float] = None,
    ):
        super(AsyncDocumentEmbedder, self).__init__(
            azure_endpoint=api_base_url,
            api_version=api_version,
            azure_deployment=model,
            dimensions=dimensions,
            api_key=api_key,
            organization=organization,
            prefix=prefix,
            suffix=suffix,
            batch_size=batch_size,
            progress_bar=progress_bar,
            meta_fields_to_embed=meta_fields_to_embed,
            embedding_separator=embedding_separator,
            timeout=timeout,
        )

        self.client = AsyncAzureOpenAI(
            azure_endpoint=api_base_url,
            azure_deployment=model,
            api_version=api_version,
            api_key=api_key.resolve_value(),
        )

    async def _embed_batch(
        self, texts_to_embed: List[str], batch_size: int
    ) -> Tuple[List[List[float]], Dict[str, Any]]:
        all_embeddings = []
        meta: Dict[str, Any] = {}
        for i in tqdm(
            range(0, len(texts_to_embed), batch_size),
            disable=not self.progress_bar,
            desc="Calculating embeddings",
        ):
            batch = texts_to_embed[i : i + batch_size]
            if self.dimensions is not None:
                response = await self.client.embeddings.create(
                    model=self.azure_deployment, dimensions=self.dimensions, input=batch
                )
            else:
                response = await self.client.embeddings.create(
                    model=self.azure_deployment, input=batch
                )
            embeddings = [el.embedding for el in response.data]
            all_embeddings.extend(embeddings)

            if "model" not in meta:
                meta["model"] = response.model
            if "usage" not in meta:
                meta["usage"] = dict(response.usage)
            else:
                meta["usage"]["prompt_tokens"] += response.usage.prompt_tokens
                meta["usage"]["total_tokens"] += response.usage.total_tokens

        return all_embeddings, meta

    @component.output_types(documents=List[Document], meta=Dict[str, Any])
    @backoff.on_exception(backoff.expo, openai.RateLimitError, max_time=60, max_tries=3)
    async def run(self, documents: List[Document]):
        if (
            not isinstance(documents, list)
            or documents
            and not isinstance(documents[0], Document)
        ):
            raise TypeError(
                "AzureOpenAIDocumentEmbedder expects a list of Documents as input."
                "In case you want to embed a string, please use the AzureOpenAITextEmbedder."
            )

        logger.info(
            f"Running Async OpenAI document embedder with documents: {documents}"
        )

        texts_to_embed = self._prepare_texts_to_embed(documents=documents)

        embeddings, meta = await self._embed_batch(
            texts_to_embed=texts_to_embed, batch_size=self.batch_size
        )

        for doc, emb in zip(documents, embeddings):
            doc.embedding = emb

        return {"documents": documents, "meta": meta}


@provider("azure_openai_embedder")
class AzureOpenAIEmbedderProvider(EmbedderProvider):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("EMBEDDER_AZURE_OPENAI_API_KEY"),
        api_base: str = os.getenv("EMBEDDER_AZURE_OPENAI_API_BASE"),
        api_version: str = os.getenv("EMBEDDER_AZURE_OPENAI_VERSION"),
        model: str = os.getenv("EMBEDDING_MODEL") or EMBEDDING_MODEL,
        timeout: Optional[float] = (
            float(os.getenv("EMBEDDER_TIMEOUT"))
            if os.getenv("EMBEDDER_TIMEOUT")
            else 120.0
        ),
        **_,
    ):
        self._embedding_api_base = remove_trailing_slash(api_base)
        self._embedding_api_key = api_key
        self._embedding_api_version = api_version
        self._embedding_model = model
        self._timeout = timeout

        logger.info(f"Using Azure OpenAI Embedding Model: {self._embedding_model}")
        logger.info(
            f"Using Azure OpenAI Embedding API Base: {self._embedding_api_base}"
        )
        logger.info(
            f"Using Azure OpenAI Embedding API Version: {self._embedding_api_version}"
        )

    def get_text_embedder(self):
        return AsyncTextEmbedder(
            api_key=self._embedding_api_key,
            model=self._embedding_model,
            api_base_url=self._embedding_api_base,
            api_version=self._embedding_api_version,
            timeout=self._timeout,
        )

    def get_document_embedder(self):
        return AsyncDocumentEmbedder(
            api_key=self._embedding_api_key,
            model=self._embedding_model,
            api_base_url=self._embedding_api_base,
            api_version=self._embedding_api_version,
            timeout=self._timeout,
        )
