import logging
import os
from typing import Any, Callable, Dict, List, Optional, Union

import backoff
import openai
from haystack import component
from haystack.components.embedders import OpenAIDocumentEmbedder, OpenAITextEmbedder
from haystack.components.generators import OpenAIGenerator
from haystack.dataclasses import ChatMessage, StreamingChunk
from haystack.utils import (
    Secret,
)
from openai import AsyncOpenAI, OpenAI, Stream
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from src.core.provider import LLMProvider
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")

GENERATION_MODEL_NAME = "gpt-3.5-turbo"
GENERATION_MODEL_KWARGS = {
    "temperature": 0,
    "n": 1,
    "max_tokens": 4096,
    "response_format": {"type": "json_object"},
}
EMBEDDING_MODEL_NAME = "text-embedding-3-large"
EMBEDDING_MODEL_DIMENSION = 3072


@component
class AsyncGenerator(OpenAIGenerator):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("OPENAI_API_KEY"),
        model: str = "gpt-3.5-turbo",
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
        api_base_url: Optional[str] = None,
        organization: Optional[str] = None,
        system_prompt: Optional[str] = None,
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        super(AsyncGenerator, self).__init__(
            api_key,
            model,
            streaming_callback,
            api_base_url,
            organization,
            system_prompt,
            generation_kwargs,
        )
        self.client = AsyncOpenAI(
            api_key=api_key.resolve_value(),
            organization=organization,
            base_url=api_base_url,
        )

    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    @backoff.on_exception(backoff.expo, openai.RateLimitError, max_time=60, max_tries=3)
    async def run(
        self, prompt: str, generation_kwargs: Optional[Dict[str, Any]] = None
    ):
        logger.debug(f"Running OpenAI generator with prompt: {prompt}")
        message = ChatMessage.from_user(prompt)
        if self.system_prompt:
            messages = [ChatMessage.from_system(self.system_prompt), message]
        else:
            messages = [message]

        # update generation kwargs by merging with the generation kwargs passed to the run method
        generation_kwargs = {**self.generation_kwargs, **(generation_kwargs or {})}

        # adapt ChatMessage(s) to the format expected by the OpenAI API
        openai_formatted_messages = [message.to_openai_format() for message in messages]

        completion: Union[
            Stream[ChatCompletionChunk], ChatCompletion
        ] = await self.client.chat.completions.create(
            model=self.model,
            messages=openai_formatted_messages,  # type: ignore
            stream=self.streaming_callback is not None,
            **generation_kwargs,
        )

        completions: List[ChatMessage] = []
        if isinstance(completion, Stream):
            num_responses = generation_kwargs.pop("n", 1)
            if num_responses > 1:
                raise ValueError("Cannot stream multiple responses, please set n=1.")
            chunks: List[StreamingChunk] = []
            chunk = None

            # pylint: disable=not-an-iterable
            for chunk in completion:
                if chunk.choices and self.streaming_callback:
                    chunk_delta: StreamingChunk = self._build_chunk(chunk)
                    chunks.append(chunk_delta)
                    self.streaming_callback(
                        chunk_delta
                    )  # invoke callback with the chunk_delta
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


@provider("openai")
class OpenAILLMProvider(LLMProvider):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("OPENAI_API_KEY"),
        api_base: Secret = Secret.from_env_var("OPENAI_API_BASE"),
        generation_model: str = os.getenv("OPENAI_GENERATION_MODEL")
        or GENERATION_MODEL_NAME,
    ):
        def _verify_api_key(api_key: str, api_base: str) -> None:
            """
            this is a temporary solution to verify that the required environment variables are set
            """
            OpenAI(api_key=api_key, base_url=api_base).models.list()

        _verify_api_key(api_key.resolve_value(), api_base.resolve_value())
        logger.info(f"Using OpenAI Generation Model: {generation_model}")
        self._api_key = api_key
        self._api_base = api_base
        self._generation_model = generation_model

    def get_generator(
        self,
        model_kwargs: Optional[Dict[str, Any]] = GENERATION_MODEL_KWARGS,
        system_prompt: Optional[str] = None,
    ):
        return AsyncGenerator(
            api_key=self._api_key,
            api_base_url=self._api_base.resolve_value(),
            model=self._generation_model,
            system_prompt=system_prompt,
            generation_kwargs=model_kwargs,
        )

    def get_text_embedder(
        self,
        model_name: str = EMBEDDING_MODEL_NAME,
        model_dim: int = EMBEDDING_MODEL_DIMENSION,
    ):
        return OpenAITextEmbedder(
            api_key=self._api_key,
            api_base_url=self._api_base.resolve_value(),
            model=model_name,
            dimensions=model_dim,
        )

    def get_document_embedder(
        self,
        model_name: str = EMBEDDING_MODEL_NAME,
        model_dim: int = EMBEDDING_MODEL_DIMENSION,
    ):
        return OpenAIDocumentEmbedder(
            api_key=self._api_key,
            api_base_url=self._api_base.resolve_value(),
            model=model_name,
            dimensions=model_dim,
        )
