import logging
import os
from typing import Any, Callable, Dict, List, Optional, Union

import backoff
import langfuse.openai
import openai
import orjson
from haystack import component
from haystack.components.generators import AzureOpenAIGenerator
from haystack.components.generators.openai_utils import (
    _convert_message_to_openai_format,
)
from haystack.dataclasses import ChatMessage, StreamingChunk
from haystack.utils import Secret
from openai import AsyncAzureOpenAI, AsyncStream
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from src.core.provider import LLMProvider
from src.providers.loader import provider
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")

GENERATION_MODEL = "gpt-4o-mini"
GENERATION_MODEL_KWARGS = {
    "temperature": 0,
    "n": 1,
    "max_tokens": 4096,
    "response_format": {"type": "json_object"},
}


@component
class AsyncGenerator(AzureOpenAIGenerator):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("LLM_AZURE_OPENAI_API_KEY"),
        model: str = "gpt-4o-mini",
        api_base: str = os.getenv("LLM_AZURE_OPENAI_API_BASE"),
        api_version: str = os.getenv("LLM_AZURE_OPENAI_VERSION"),
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
        system_prompt: Optional[str] = None,
        generation_kwargs: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ):
        super(AsyncGenerator, self).__init__(
            azure_endpoint=api_base,
            api_version=api_version,
            azure_deployment=model,
            api_key=api_key,
            streaming_callback=streaming_callback,
            system_prompt=system_prompt,
            generation_kwargs=generation_kwargs,
            timeout=timeout,
        )

        self.client = AsyncAzureOpenAI(
            azure_endpoint=api_base,
            azure_deployment=model,
            api_version=api_version,
            api_key=api_key.resolve_value(),
        )

    async def __call__(self, *args, **kwargs):
        return await self.run(*args, **kwargs)

    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    @backoff.on_exception(backoff.expo, openai.APIError, max_time=60.0, max_tries=3)
    async def run(
        self,
        prompt: str,
        generation_kwargs: Optional[Dict[str, Any]] = None,
        query_id: Optional[str] = None,
    ):
        logger.info(f"running async azure generator with prompt : {prompt}")
        message = ChatMessage.from_user(prompt)
        if self.system_prompt:
            messages = [ChatMessage.from_system(self.system_prompt), message]
        else:
            messages = [message]

        generation_kwargs = {**self.generation_kwargs, **(generation_kwargs or {})}

        openai_formatted_messages = [
            _convert_message_to_openai_format(message) for message in messages
        ]

        completion: Union[
            AsyncStream[ChatCompletionChunk], ChatCompletion
        ] = await self.client.chat.completions.create(
            model=self.azure_deployment,
            messages=openai_formatted_messages,
            stream=self.streaming_callback is not None,
            **generation_kwargs,
        )

        completions: List[ChatMessage] = []
        if isinstance(completion, AsyncStream) or isinstance(
            completion, langfuse.openai.LangfuseResponseGeneratorAsync
        ):
            num_responses = generation_kwargs.pop("n", 1)
            if num_responses > 1:
                raise ValueError(
                    "Cannot stream multiple responses , please set n = 1 in AzureAsyncGenerator"
                )
            chunks: List[StreamingChunk] = []

            # pylint: disable=not-an-iterable
            for chunk in completion:
                if chunk.choices and self.streaming_callback:
                    chunk_delta: StreamingChunk = self._build_chunk(chunk)
                    chunks.append(chunk_delta)
                    self.streaming_callback(chunk_delta, query_id)
            completions = [self._connect_chunks(chunk, chunks)]
        elif isinstance(completion, ChatCompletion) or isinstance(
            completion, langfuse.openai.LangfuseResponseGeneratorSync
        ):
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


@provider("azure_openai_llm")
class AzureOpenAILLMProvider(LLMProvider):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("LLM_AZURE_OPENAI_API_KEY"),
        api_base: str = os.getenv("LLM_AZURE_OPENAI_API_BASE"),
        api_version: str = os.getenv("LLM_AZURE_OPENAI_VERSION"),
        model: str = os.getenv("GENERATION_MODEL") or GENERATION_MODEL,
        kwargs: Dict[str, Any] = (
            orjson.loads(os.getenv("GENERATION_MODEL_KWARGS"))
            if os.getenv("GENERATION_MODEL_KWARGS")
            else GENERATION_MODEL_KWARGS
        ),
        timeout: Optional[float] = (
            float(os.getenv("LLM_TIMEOUT")) if os.getenv("LLM_TIMEOUT") else 120.0
        ),
        **_,
    ):
        self._generation_api_key = api_key
        self._generation_api_base = remove_trailing_slash(api_base)
        self._generation_api_version = api_version
        self._model = model
        self._model_kwargs = kwargs
        self._timeout = timeout

        logger.info(f"Using AzureOpenAI LLM: {self._model}")
        logger.info(f"Using AzureOpenAI LLM with API base: {self._generation_api_base}")
        logger.info(
            f"Using AzureOpenAI LLM with API version: {self._generation_api_version}"
        )
        logger.info(f"Using AzureOpenAI LLM model kwargs: {self._model_kwargs}")

    def get_generator(
        self,
        system_prompt: Optional[str] = None,
        # it is expected to only pass the response format only, others will be merged from the model parameters.
        generation_kwargs: Optional[Dict[str, Any]] = None,
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
    ):
        return AsyncGenerator(
            api_key=self._generation_api_key,
            model=self._model,
            api_base=self._generation_api_base,
            api_version=self._generation_api_version,
            system_prompt=system_prompt,
            generation_kwargs=(
                {**self._model_kwargs, **generation_kwargs}
                if generation_kwargs
                else self._model_kwargs
            ),
            timeout=self._timeout,
            streaming_callback=streaming_callback,
        )
