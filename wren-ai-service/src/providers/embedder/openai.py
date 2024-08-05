import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import backoff
import openai
from haystack import Document, component
from haystack.components.embedders import OpenAIDocumentEmbedder, OpenAITextEmbedder
from haystack.utils import Secret
from openai import AsyncOpenAI, OpenAI
from tqdm import tqdm

from src.core.provider import EmbedderProvider
from src.providers.loader import provider
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")

EMBEDDER_OPENAI_API_BASE = "https://api.openai.com/v1"
EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_MODEL_DIMENSION = 3072


@component
class AsyncTextEmbedder(OpenAITextEmbedder):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("EMBEDDER_OPENAI_API_KEY"),
        model: str = "text-embedding-ada-002",
        dimensions: Optional[int] = None,
        api_base_url: Optional[str] = None,
        organization: Optional[str] = None,
        prefix: str = "",
        suffix: str = "",
    ):
        super(AsyncTextEmbedder, self).__init__(
            api_key,
            model,
            dimensions,
            api_base_url,
            organization,
            prefix,
            suffix,
        )
        self.client = AsyncOpenAI(
            api_key=api_key.resolve_value(),
            organization=organization,
            base_url=api_base_url,
        )

    @component.output_types(embedding=List[float], meta=Dict[str, Any])
    @backoff.on_exception(backoff.expo, openai.RateLimitError, max_time=60, max_tries=3)
    async def run(self, text: str):
        if not isinstance(text, str):
            raise TypeError(
                "OpenAITextEmbedder expects a string as an input."
                "In case you want to embed a list of Documents, please use the OpenAIDocumentEmbedder."
            )

        logger.debug(f"Running Async OpenAI text embedder with text: {text}")

        text_to_embed = self.prefix + text + self.suffix

        # copied from OpenAI embedding_utils (https://github.com/openai/openai-python/blob/main/openai/embeddings_utils.py)
        # replace newlines, which can negatively affect performance.
        text_to_embed = text_to_embed.replace("\n", " ")

        if self.dimensions is not None:
            response = await self.client.embeddings.create(
                model=self.model, dimensions=self.dimensions, input=text_to_embed
            )
        else:
            response = await self.client.embeddings.create(
                model=self.model, input=text_to_embed
            )

        meta = {"model": response.model, "usage": dict(response.usage)}

        return {"embedding": response.data[0].embedding, "meta": meta}


@component
class AsyncDocumentEmbedder(OpenAIDocumentEmbedder):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("EMBEDDER_OPENAI_API_KEY"),
        model: str = "text-embedding-ada-002",
        dimensions: Optional[int] = None,
        api_base_url: Optional[str] = None,
        organization: Optional[str] = None,
        prefix: str = "",
        suffix: str = "",
        batch_size: int = 32,
        progress_bar: bool = True,
        meta_fields_to_embed: Optional[List[str]] = None,
        embedding_separator: str = "\n",
    ):
        super(AsyncDocumentEmbedder, self).__init__(
            api_key,
            model,
            dimensions,
            api_base_url,
            organization,
            prefix,
            suffix,
            batch_size,
            progress_bar,
            meta_fields_to_embed,
            embedding_separator,
        )
        self.client = AsyncOpenAI(
            api_key=api_key.resolve_value(),
            organization=organization,
            base_url=api_base_url,
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
                    model=self.model, dimensions=self.dimensions, input=batch
                )
            else:
                response = await self.client.embeddings.create(
                    model=self.model, input=batch
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
                "OpenAIDocumentEmbedder expects a list of Documents as input."
                "In case you want to embed a string, please use the OpenAITextEmbedder."
            )

        logger.debug(
            f"Running Async OpenAI document embedder with documents: {documents}"
        )

        texts_to_embed = self._prepare_texts_to_embed(documents=documents)

        embeddings, meta = await self._embed_batch(
            texts_to_embed=texts_to_embed, batch_size=self.batch_size
        )

        for doc, emb in zip(documents, embeddings):
            doc.embedding = emb

        return {"documents": documents, "meta": meta}


@provider("openai_embedder")
class OpenAIEmbedderProvider(EmbedderProvider):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("EMBEDDER_OPENAI_API_KEY"),
        api_base: str = os.getenv("EMBEDDER_OPENAI_API_BASE")
        or EMBEDDER_OPENAI_API_BASE,
        embedding_model: str = os.getenv("EMBEDDING_MODEL") or EMBEDDING_MODEL,
        embedding_model_dim: int = (
            int(os.getenv("EMBEDDING_MODEL_DIMENSION"))
            if os.getenv("EMBEDDING_MODEL_DIMENSION")
            else 0
        )
        or EMBEDDING_MODEL_DIMENSION,
    ):
        def _verify_api_key(api_key: str, api_base: str) -> None:
            """
            this is a temporary solution to verify that the required environment variables are set
            """
            OpenAI(api_key=api_key, base_url=api_base).models.list()

        self._api_key = api_key
        self._api_base = remove_trailing_slash(api_base)
        self._embedding_model = embedding_model
        self._embedding_model_dim = embedding_model_dim

        logger.info(
            f"Initializing OpenAIEmbedder provider with API base: {self._api_base}"
        )
        # TODO: currently only OpenAI api key can be verified
        if self._api_base == EMBEDDER_OPENAI_API_BASE:
            _verify_api_key(self._api_key.resolve_value(), self._api_base)
            logger.info(f"Using OpenAI Embedding Model: {self._embedding_model}")
        else:
            logger.info(
                f"Using OpenAI API-compatible Embedding Model: {self._embedding_model}"
            )

    def get_text_embedder(self):
        return AsyncTextEmbedder(
            api_key=self._api_key,
            api_base_url=self._api_base,
            model=self._embedding_model,
        )

    def get_document_embedder(self):
        return AsyncDocumentEmbedder(
            api_key=self._api_key,
            api_base_url=self._api_base,
            model=self._embedding_model,
        )
