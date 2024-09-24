import logging
import os
from typing import Any, Callable, Dict, List, Optional, Union

import backoff
import openai
import orjson
from haystack import component
from haystack.components.generators import OpenAIGenerator
from haystack.dataclasses import ChatMessage, StreamingChunk
from haystack.utils import Secret
from openai import AsyncOpenAI, Stream
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from src.core.provider import LLMProvider
from src.providers.loader import provider
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")

LLM_OPENAI_API_BASE = "https://api.openai.com/v1"
GENERATION_MODEL = "gpt-4o-mini"
GENERATION_MODEL_KWARGS = {
    "temperature": 0,
    "n": 1,
    "max_tokens": 4096,
    "response_format": {"type": "json_object"},
}


@component
class AsyncGenerator(OpenAIGenerator):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("LLM_OPENAI_API_KEY"),
        model: str = "gpt-4o-mini",
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
        api_base_url: Optional[str] = None,
        organization: Optional[str] = None,
        system_prompt: Optional[str] = None,
        generation_kwargs: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ):
        super(AsyncGenerator, self).__init__(
            api_key,
            model,
            streaming_callback,
            api_base_url,
            organization,
            system_prompt,
            generation_kwargs,
            timeout,
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
        logger.debug(f"Running AsyncOpenAI generator with prompt: {prompt}")
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


@provider("openai_llm")
class OpenAILLMProvider(LLMProvider):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("LLM_OPENAI_API_KEY"),
        api_base: str = os.getenv("LLM_OPENAI_API_BASE") or LLM_OPENAI_API_BASE,
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
        self._api_key = api_key
        self._api_base = remove_trailing_slash(api_base)
        self._generation_model = generation_model
        self._model_kwargs = model_kwargs
        self._timeout = timeout

        logger.info(f"Using OpenAILLM provider with API base: {self._api_base}")
        if self._api_base == LLM_OPENAI_API_BASE:
            logger.info(f"Using OpenAI LLM: {self._generation_model}")
        else:
            logger.info(f"Using OpenAI API-compatible LLM: {self._generation_model}")

    def get_generator(
        self,
        system_prompt: Optional[str] = None,
    ):
        if self._api_base == LLM_OPENAI_API_BASE:
            logger.info(
                f"Creating OpenAI generator with model kwargs: {self._model_kwargs}"
            )
        else:
            logger.info(
                f"Creating OpenAI API-compatible generator with model kwargs: {self._model_kwargs}"
            )

        return AsyncGenerator(
            api_key=self._api_key,
            api_base_url=self._api_base,
            model=self._generation_model,
            system_prompt=system_prompt,
            generation_kwargs=self._model_kwargs,
            timeout=self._timeout,
        )
