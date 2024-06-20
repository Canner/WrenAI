import logging
import os
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import backoff
import openai
from haystack import Document, component
from haystack.components.embedders import (
    AzureOpenAIDocumentEmbedder,
    AzureOpenAITextEmbedder,
)
from haystack.components.generators import AzureOpenAIGenerator
from haystack.dataclasses import ChatMessage, StreamingChunk
from haystack.utils import Secret
from openai import AsyncAzureOpenAI, Stream
from openai.types.chat import ChatCompletion, ChatCompletionChunk
from tqdm import tqdm

from src.core.provider import LLMProvider
from src.providers.loader import provider

EMBEDDING_MODEL_NAME = "text-embedding-3-small"
EMBEDDING_MODEL_DIMENSION = 1536
logger = logging.getLogger("azure-openai")
AZURE_GENERATION_MODEL = "gpt-4-turbo"
AZURE_GENERATION_MODEL_KWARGS = {
    "temperature": 0,
    "n": 1,
    "max_tokens": 1000,
    "response_format": {"type": "json_object"},
}

chat_base = os.getenv("AZURE_CHAT_BASE")
chat_token = Secret.from_env_var("AZURE_CHAT_KEY")
chat_version = os.getenv("AZURE_CHAT_VERSION")

embed_base = os.getenv("AZURE_EMBED_BASE")
embed_token = Secret.from_env_var("AZURE_EMBED_KEY")
embed_version = os.getenv("AZURE_EMBED_VERSION")


@component
class AsyncAzureGenerator(AzureOpenAIGenerator):
    def __init__(
        self,
        api_key: Secret = chat_token,
        model: str = "gpt-4-turbo",
        api_base: str = chat_base,
        api_version: str = chat_version,
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
        system_prompt: Optional[str] = None,
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        super(AsyncAzureGenerator, self).__init__(
            azure_endpoint=api_base,
            api_version=api_version,
            azure_deployment=model,
            api_key=api_key,
            streaming_callback=streaming_callback,
            system_prompt=system_prompt,
            generation_kwargs=generation_kwargs,
        )

        self.client = AsyncAzureOpenAI(
            azure_endpoint=chat_base,
            api_version=api_version,
            api_key=chat_token.resolve_value(),
        )

    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    @backoff.on_exception(backoff.expo, openai.RateLimitError, max_time=60, max_tries=3)
    async def run(
        self,
        prompt: str,
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        logger.info(f"running async azure generator with prompt : {prompt}")
        message = ChatMessage.from_user(prompt)
        if self.system_prompt:
            messages = [ChatMessage.from_system(self.system_prompt), message]
        else:
            messages = [message]

        generation_kwargs = {**self.generation_kwargs, **(generation_kwargs or {})}

        openai_formatted_messages = [message.to_openai_format() for message in messages]

        completion: Union[
            Stream[ChatCompletionChunk], ChatCompletion
        ] = await self.client.chat.completions.create(
            model=self.model,
            messages=openai_formatted_messages,
            stream=self.streaming_callback is not None,
            **generation_kwargs,
        )

        completions: List[ChatMessage] = []
        if isinstance(completion, Stream):
            num_responses = generation_kwargs.pop("n", 1)
            if num_responses > 1:
                raise ValueError(
                    "Cannot stream multiple responses , please set n = 1 in AzureAsyncGenerator"
                )
            chunks: List[StreamingChunk] = []
            chunk = None

            # pylint: disable=not-an-iterable
            for chunk in completion:
                if chunk.choices and self.streaming_callback:
                    chunk_delta: StreamingChunk = self._build_chunk(chunk)
                    chunks.append(chunk_delta)
                    self.streaming_callback(chunk_delta)
            completions = [self._connect_chunks(chunk, chunks)]
        elif isinstance(completion, ChatCompletion):
            completions = [
                self._build_message(completion, choice) for choice in completion.choices
            ]
        # before returning, do post-processing of the completions
        for response in completions:
            self._check_finish_reason(response)

        return {
            "replies": [message.content for message in completions],
            "meta": [message.meta for message in completions],
        }


@component
class AsyncAzureTextEmbedder(AzureOpenAITextEmbedder):
    def __init__(
        self,
        api_key: Secret = embed_token,
        model: str = "text-embedding-3-small",
        dimensions: Optional[int] = None,
        api_base_url: Optional[str] = None,
        api_version: Optional[str] = None,
        organization: Optional[str] = None,
        prefix: str = "",
        suffix: str = "",
    ):
        super(AsyncAzureTextEmbedder, self).__init__(
            azure_endpoint=api_base_url,
            api_version=api_version,
            azure_deployment=model,
            dimensions=dimensions,
            api_key=api_key,
            organization=organization,
            prefix=prefix,
            suffix=suffix,
        )

        self.client = AsyncAzureOpenAI(
            azure_endpoint=api_base_url,
            api_version=api_version,
            api_key=api_key.resolve_value(),
        )

    @component.output_types(embedding=List[float], meta=Dict[str, Any])
    @backoff.on_exception(backoff.expo, openai.RateLimitError, max_time=60, max_tries=3)
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
class AsyncAzureDocumentEmbedder(AzureOpenAIDocumentEmbedder):
    def __init__(
        self,
        api_key: Secret = embed_token,
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
    ):
        super(AsyncAzureDocumentEmbedder, self).__init__(
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
        )

        self.client = AsyncAzureOpenAI(
            azure_endpoint=api_base_url,
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


@provider("azure_openai")
class AzureOpenAILLMProvider(LLMProvider):
    def __init__(
        self,
        chat_api_key: Secret = Secret.from_env_var("AZURE_CHAT_KEY"),
        chat_api_base: str = os.getenv("AZURE_CHAT_BASE"),
        embed_api_key: Secret = Secret.from_env_var("AZURE_EMBED_KEY"),
        embed_api_base: str = os.getenv("AZURE_EMBED_BASE"),
        chat_api_version: str = os.getenv("AZURE_CHAT_VERSION"),
        embed_api_version: str = os.getenv("AZURE_EMBED_VERSION"),
        generation_model: str = os.getenv("AZURE_GENERATION_MODEL")
        or AZURE_GENERATION_MODEL,
    ):
        logger.info(f"Using Azure OpenAI Generation Model: {generation_model}")
        self.chat_api_key = chat_api_key
        self.chat_api_base = chat_api_base
        self.chat_api_version = chat_api_version

        self.embed_api_base = embed_api_base
        self.embed_api_key = embed_api_key
        self.embed_api_version = embed_api_version
        self.generation_model = generation_model

    def get_generator(
        self,
        model_kwargs: Optional[Dict[str, Any]] = AZURE_GENERATION_MODEL_KWARGS,
        system_prompt: Optional[str] = None,
    ):
        return AsyncAzureGenerator(
            api_key=self.chat_api_key,
            model=self.generation_model,
            api_base=self.chat_api_base,
            api_version=self.chat_api_version,
            system_prompt=system_prompt,
            generation_kwargs=model_kwargs,
        )

    def get_text_embedder(
        self,
        model_name: str = EMBEDDING_MODEL_NAME,
        model_dim: int = EMBEDDING_MODEL_DIMENSION,
    ):
        return AsyncAzureTextEmbedder(
            api_key=self.embed_api_key,
            model=model_name,
            dimensions=model_dim,
            api_base_url=self.embed_api_base,
            api_version=self.embed_api_version,
        )

    def get_document_embedder(
        self,
        model_name: str = EMBEDDING_MODEL_NAME,
        model_dim: int = EMBEDDING_MODEL_DIMENSION,
    ):
        return AsyncAzureDocumentEmbedder(
            api_key=self.embed_api_key,
            model=model_name,
            dimensions=model_dim,
            api_base_url=self.embed_api_base,
            api_version=self.embed_api_version,
        )
