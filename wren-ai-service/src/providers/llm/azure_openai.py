import logging
import os
from typing import Any, Callable, Dict, List, Optional, Union

import backoff
import openai
import orjson
from haystack import component
from haystack.components.generators import AzureOpenAIGenerator
from haystack.dataclasses import ChatMessage, StreamingChunk
from haystack.utils import Secret
from openai import AsyncAzureOpenAI, Stream
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from src.core.provider import LLMProvider
from src.providers.loader import provider
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")

GENERATION_MODEL = "gpt-4-turbo"
GENERATION_MODEL_KWARGS = {
    "temperature": 0,
    "n": 1,
    "max_tokens": 1000,
    "response_format": {"type": "json_object"},
}


@component
class AsyncGenerator(AzureOpenAIGenerator):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("LLM_AZURE_OPENAI_API_KEY"),
        model: str = "gpt-4-turbo",
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
            model=self.azure_deployment,
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


@provider("azure_openai_llm")
class AzureOpenAILLMProvider(LLMProvider):
    def __init__(
        self,
        chat_api_key: Secret = Secret.from_env_var("LLM_AZURE_OPENAI_API_KEY"),
        chat_api_base: str = os.getenv("LLM_AZURE_OPENAI_API_BASE"),
        chat_api_version: str = os.getenv("LLM_AZURE_OPENAI_VERSION"),
        generation_model: str = os.getenv("GENERATION_MODEL") or GENERATION_MODEL,
        model_kwargs: Dict[str, Any] = (
            orjson.loads(os.getenv("GENERATION_MODEL_KWARGS"))
            if os.getenv("GENERATION_MODEL_KWARGS")
            else GENERATION_MODEL_KWARGS
        ),
        timeout: Optional[float] = (
            float(os.getenv("LLM_TIMEOUT")) if os.getenv("LLM_TIMEOUT") else 120.0
        ),
    ):
        self._generation_api_key = chat_api_key
        self._generation_api_base = remove_trailing_slash(chat_api_base)
        self._generation_api_version = chat_api_version
        self._generation_model = generation_model
        self._model_kwargs = model_kwargs
        self._timeout = timeout

        logger.info(f"Using AzureOpenAI LLM: {self._generation_model}")
        logger.info(f"Using AzureOpenAI LLM with API base: {self._generation_api_base}")
        logger.info(
            f"Using AzureOpenAI LLM with API version: {self._generation_api_version}"
        )

    def get_generator(
        self,
        system_prompt: Optional[str] = None,
    ):
        logger.info(
            f"Creating Azure OpenAI generator with model kwargs: {self._model_kwargs}"
        )
        return AsyncGenerator(
            api_key=self._generation_api_key,
            model=self._generation_model,
            api_base=self._generation_api_base,
            api_version=self._generation_api_version,
            system_prompt=system_prompt,
            generation_kwargs=self._model_kwargs,
            timeout=self._timeout,
        )
