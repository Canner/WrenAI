import os
from typing import Any, Callable, Dict, List, Optional

import backoff
import openai
from litellm import Router, acompletion

from src.core.provider import LLMProvider
from src.providers.llm import (
    ChatMessage,
    StreamingChunk,
    build_chunk,
    build_message,
    check_finish_reason,
    connect_chunks,
    convert_message_to_openai_format,
)
from src.providers.loader import provider
from src.utils import extract_braces_content, remove_trailing_slash


def normalize_litellm_model_name(model: str, api_base: Optional[str] = None) -> str:
    if api_base and "/" not in model:
        return f"openai/{model}"
    return model


def _is_openai_api_base(api_base: Optional[str]) -> bool:
    return bool(api_base) and "api.openai.com" in api_base.lower()


def _is_ollama_native_model(model: str) -> bool:
    return model.startswith(("ollama/", "ollama_chat/"))


@provider("litellm_llm")
class LitellmLLMProvider(LLMProvider):
    def __init__(
        self,
        model: str,
        api_key_name: Optional[
            str
        ] = None,  # e.g. OPENAI_API_KEY, LLM_ANTHROPIC_API_KEY, etc.
        api_base: Optional[str] = None,
        api_version: Optional[str] = None,
        kwargs: Optional[Dict[str, Any]] = None,
        timeout: float = 120.0,
        context_window_size: int = 100000,
        fallback_model_list: Optional[List[Dict[str, Any]]] = None,
        fallback_testing: bool = False,
        **_,
    ):
        self._model = normalize_litellm_model_name(model, api_base)
        # TODO: remove _api_key, _api_base, _api_version in the future, as it is not used in litellm
        self._api_key = os.getenv(api_key_name) if api_key_name else None
        self._api_base = remove_trailing_slash(api_base) if api_base else None
        self._api_version = api_version
        self._model_kwargs = kwargs or {}
        self._timeout = timeout
        self._context_window_size = context_window_size
        # build a dynamic list of all fallback model names (beyond the first)
        self._has_fallbacks = (
            fallback_model_list is not None and len(fallback_model_list) > 1
        )
        fallbacks = (
            [{self._model: [m["model_name"] for m in fallback_model_list[1:]]}]
            if self._has_fallbacks
            else []
        )
        self._router = Router(
            model_list=fallback_model_list or [],
            fallbacks=fallbacks,
        )
        self._enable_fallback_testing = fallback_testing and self._has_fallbacks

    def get_generator(
        self,
        system_prompt: Optional[str] = None,
        generation_kwargs: Optional[Dict[str, Any]] = None,
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
    ):
        component_generation_kwargs = generation_kwargs or {}

        def _normalize_generation_kwargs(
            kwargs: Optional[Dict[str, Any]],
            explicit_response_format: bool = False,
        ) -> Dict[str, Any]:
            normalized = dict(kwargs or {})
            response_format = normalized.get("response_format")

            # Plain text is the default chat-completions behavior.
            # Some OpenAI-compatible endpoints reject an explicit
            # {"type": "text"} payload or serialize it incorrectly.
            if (
                isinstance(response_format, dict)
                and response_format.get("type") == "text"
            ):
                normalized.pop("response_format", None)

            if (
                self._api_base
                and not _is_openai_api_base(self._api_base)
                and isinstance(response_format, dict)
                and response_format.get("type") == "json_schema"
            ):
                if explicit_response_format:
                    normalized["response_format"] = {"type": "json_object"}
                else:
                    normalized.pop("response_format", None)

            if self._api_base and not _is_openai_api_base(self._api_base):
                # Some local OpenAI-compatible servers reject non-OpenAI keys.
                normalized.pop("speed", None)

            if (
                _is_ollama_native_model(self._model)
                and "max_tokens" in normalized
                and "num_predict" not in normalized
            ):
                normalized["num_predict"] = normalized["max_tokens"]

            return normalized

        @backoff.on_exception(backoff.expo, openai.APIError, max_time=60.0, max_tries=3)
        async def _run(
            prompt: str,
            image_url: Optional[str] = None,
            current_system_prompt: Optional[str] = None,
            history_messages: Optional[List[ChatMessage]] = None,
            generation_kwargs: Optional[Dict[str, Any]] = None,
            query_id: Optional[str] = None,
        ):
            message = ChatMessage.from_user(prompt, image_url)
            _system_prompt = system_prompt
            if current_system_prompt:
                _system_prompt = current_system_prompt

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
                convert_message_to_openai_format(message) for message in messages
            ]

            runtime_generation_kwargs = generation_kwargs or {}
            model_generation_kwargs = self._model_kwargs or {}
            explicit_response_format = (
                "response_format" in component_generation_kwargs
                or "response_format" in model_generation_kwargs
                or "response_format" in runtime_generation_kwargs
            )
            generation_kwargs = _normalize_generation_kwargs(
                {
                    **component_generation_kwargs,
                    **model_generation_kwargs,
                    **runtime_generation_kwargs,
                },
                explicit_response_format=explicit_response_format,
            )
            completion_timeout = generation_kwargs.pop("timeout", self._timeout)
            should_stream = (
                streaming_callback is not None
                and query_id is not None
                and generation_kwargs.pop("stream", True)
            )

            allowed_openai_params = generation_kwargs.get(
                "allowed_openai_params", []
            ) + (["reasoning_effort"] if self._model.startswith("gpt-5") else [])

            if self._has_fallbacks:
                completion = await self._router.acompletion(
                    model=self._model,
                    messages=openai_formatted_messages,
                    stream=should_stream,
                    allowed_openai_params=allowed_openai_params,
                    mock_testing_fallbacks=self._enable_fallback_testing,
                    timeout=completion_timeout,
                    **generation_kwargs,
                )
            else:
                completion = await acompletion(
                    model=self._model,
                    api_key=self._api_key,
                    api_base=self._api_base,
                    api_version=self._api_version,
                    timeout=completion_timeout,
                    messages=openai_formatted_messages,
                    stream=should_stream,
                    allowed_openai_params=allowed_openai_params,
                    **generation_kwargs,
                )

            completions: List[ChatMessage] = []
            if should_stream:
                num_responses = generation_kwargs.pop("n", 1)
                if num_responses > 1:
                    raise ValueError(
                        "Cannot stream multiple responses, please set n=1."
                    )
                chunks: List[StreamingChunk] = []

                async for chunk in completion:
                    if chunk.choices and streaming_callback:
                        chunk_delta: StreamingChunk = build_chunk(chunk)
                        chunks.append(chunk_delta)
                        streaming_callback(
                            chunk_delta, query_id
                        )  # invoke callback with the chunk_delta
                completions = [connect_chunks(chunk, chunks)]
            else:
                completions = [
                    build_message(completion, choice) for choice in completion.choices
                ]

            # before returning, do post-processing of the completions
            for response in completions:
                check_finish_reason(response)

            return {
                "replies": [
                    extract_braces_content(message.content) for message in completions
                ],
                "meta": [message.meta for message in completions],
            }

        return _run
