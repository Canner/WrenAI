import logging
import os
import re
from typing import Any, Callable, Dict, List, Optional

import backoff
import openai
from openai import AsyncOpenAI

from src.core.provider import LLMProvider
from src.providers.llm import (
    ChatMessage,
    StreamingChunk,
    build_chunk,
    build_message,
    check_finish_reason,
    convert_message_to_openai_format,
)
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")

MINIMAX_API_BASE = "https://api.minimax.io/v1"


def _extract_braces_content(resp: str) -> str:
    """Extract JSON from a markdown code block, or return the original string."""
    match = re.search(r"```json\s*(\{.*?\})\s*```", resp, re.DOTALL)
    return match.group(1) if match else resp


def _clamp_temperature(temperature: float) -> float:
    """Clamp temperature to MiniMax's valid range (0.0, 1.0].

    MiniMax rejects temperature=0; use a small positive value instead.
    """
    if temperature <= 0:
        return 0.01
    return min(temperature, 1.0)


@provider("minimax_llm")
class MiniMaxLLMProvider(LLMProvider):
    """MiniMax LLM provider using the OpenAI-compatible Chat API.

    Supported models:
        - MiniMax-M2.7 (default, latest flagship with enhanced reasoning and coding)
        - MiniMax-M2.7-highspeed (high-speed version of M2.7 for low-latency scenarios)
        - MiniMax-M2.5 (204K context)
        - MiniMax-M2.5-highspeed (faster variant, 204K context)

    API docs: https://platform.minimax.io/docs/api-reference/text-openai-api
    """

    def __init__(
        self,
        model: str = "MiniMax-M2.7",
        api_key_name: Optional[str] = "MINIMAX_API_KEY",
        api_base: Optional[str] = None,
        kwargs: Optional[Dict[str, Any]] = None,
        timeout: float = 120.0,
        context_window_size: int = 204800,
        **_,
    ):
        self._model = model
        api_key = os.getenv(api_key_name) if api_key_name else None
        if not api_key:
            logger.warning(
                "MINIMAX_API_KEY is not set. MiniMax provider will not work "
                "until a valid API key is provided."
            )
        self._api_base = api_base or MINIMAX_API_BASE
        self._model_kwargs = kwargs or {}
        self._timeout = timeout
        self._context_window_size = context_window_size

        self._client = AsyncOpenAI(
            api_key=api_key or "placeholder",
            base_url=self._api_base,
            timeout=self._timeout,
        )

    def get_generator(
        self,
        system_prompt: Optional[str] = None,
        generation_kwargs: Optional[Dict[str, Any]] = None,
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
    ):
        combined_generation_kwargs = {
            **(generation_kwargs or {}),
            **(self._model_kwargs or {}),
        }

        # Remove response_format — MiniMax does not support it
        combined_generation_kwargs.pop("response_format", None)

        # Clamp temperature to MiniMax's valid range
        if "temperature" in combined_generation_kwargs:
            combined_generation_kwargs["temperature"] = _clamp_temperature(
                combined_generation_kwargs["temperature"]
            )

        @backoff.on_exception(
            backoff.expo, openai.APIError, max_time=60.0, max_tries=3
        )
        async def _run(
            prompt: str,
            image_url: Optional[str] = None,
            current_system_prompt: Optional[str] = None,
            history_messages: Optional[List[ChatMessage]] = None,
            generation_kwargs: Optional[Dict[str, Any]] = None,
            query_id: Optional[str] = None,
        ):
            message = ChatMessage.from_user(prompt, image_url)
            _system_prompt = current_system_prompt or system_prompt

            if _system_prompt:
                messages = [ChatMessage.from_system(_system_prompt)]
                if history_messages:
                    messages.extend(history_messages)
                messages.append(message)
            else:
                if history_messages:
                    messages = history_messages + [message]
                else:
                    messages = [message]

            openai_formatted_messages = [
                convert_message_to_openai_format(msg) for msg in messages
            ]

            merged_kwargs = {
                **combined_generation_kwargs,
                **(generation_kwargs or {}),
            }

            # Remove response_format from per-call kwargs as well
            merged_kwargs.pop("response_format", None)

            # Clamp temperature for per-call overrides
            if "temperature" in merged_kwargs:
                merged_kwargs["temperature"] = _clamp_temperature(
                    merged_kwargs["temperature"]
                )

            # Remove unsupported params
            merged_kwargs.pop("allowed_openai_params", None)

            completion = await self._client.chat.completions.create(
                model=self._model,
                messages=openai_formatted_messages,
                stream=streaming_callback is not None,
                **merged_kwargs,
            )

            completions: List[ChatMessage] = []
            if streaming_callback is not None:
                chunks: List[StreamingChunk] = []

                last_chunk = None
                async for chunk in completion:
                    if chunk.choices and streaming_callback:
                        chunk_delta: StreamingChunk = build_chunk(chunk)
                        chunks.append(chunk_delta)
                        streaming_callback(chunk_delta, query_id)
                    last_chunk = chunk

                complete_response = ChatMessage.from_assistant(
                    "".join([c.content for c in chunks])
                )
                complete_response.meta.update(
                    {
                        "model": last_chunk.model if last_chunk else self._model,
                        "index": 0,
                        "finish_reason": (
                            last_chunk.choices[0].finish_reason
                            if last_chunk and last_chunk.choices
                            else "stop"
                        ),
                        "usage": (
                            dict(last_chunk.usage)
                            if last_chunk
                            and hasattr(last_chunk, "usage")
                            and last_chunk.usage is not None
                            else {}
                        ),
                    }
                )
                completions = [complete_response]
            else:
                completions = [
                    build_message(completion, choice)
                    for choice in completion.choices
                ]

            for response in completions:
                check_finish_reason(response)

            return {
                "replies": [
                    _extract_braces_content(msg.content) for msg in completions
                ],
                "meta": [msg.meta for msg in completions],
            }

        return _run
