import logging
import os
from typing import Any, Callable, Dict, List, Optional, Union

from haystack.dataclasses import ChatMessage, StreamingChunk
from litellm import acompletion
from litellm.types.utils import ModelResponse

from src.core.provider import LLMProvider
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")


def _build_message(completion: Any, choice: Any) -> ChatMessage:
    """
    Converts the response from the OpenAI API to a ChatMessage.

    :param completion:
        The completion returned by the OpenAI API.
    :param choice:
        The choice returned by the OpenAI API.
    :returns:
        The ChatMessage.
    """
    # function or tools calls are not going to happen in non-chat generation
    # as users can not send ChatMessage with function or tools calls
    chat_message = ChatMessage.from_assistant(choice.message.content or "")
    chat_message.meta.update(
        {
            "model": completion.model,
            "index": choice.index,
            "finish_reason": choice.finish_reason,
            "usage": dict(completion.usage),
        }
    )
    return chat_message


def _check_finish_reason(message: ChatMessage) -> None:
    """
    Check the `finish_reason` returned with the OpenAI completions.

    If the `finish_reason` is `length`, log a warning to the user.

    :param message:
        The message returned by the LLM.
    """
    if message.meta["finish_reason"] == "length":
        logger.warning(
            "The completion for index {index} has been truncated before reaching a natural stopping point. "
            "Increase the max_tokens parameter to allow for longer completions.",
            index=message.meta["index"],
            finish_reason=message.meta["finish_reason"],
        )
    if message.meta["finish_reason"] == "content_filter":
        logger.warning(
            "The completion for index {index} has been truncated due to the content filter.",
            index=message.meta["index"],
            finish_reason=message.meta["finish_reason"],
        )


def _connect_chunks(chunk: Any, chunks: List[StreamingChunk]) -> ChatMessage:
    """
    Connects the streaming chunks into a single ChatMessage.
    """
    complete_response = ChatMessage.from_assistant(
        "".join([chunk.content for chunk in chunks])
    )
    complete_response.meta.update(
        {
            "model": chunk.model,
            "index": 0,
            "finish_reason": chunk.choices[0].finish_reason,
            "usage": {},  # we don't have usage data for streaming responses
        }
    )
    return complete_response


@provider("litellm_llm")
class LitellmProvider(LLMProvider):
    def __init__(
        self,
        model: str,
        api_key: str = os.getenv("LLM_OPENAI_API_KEY"),
        api_base: Optional[str] = None,
        api_version: Optional[str] = None,
        kwargs: Optional[Dict[str, Any]] = None,
        timeout: float = 120.0,
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
        **_,
    ):
        self._model = model
        self._api_key = api_key
        self._api_base = api_base
        self._api_version = api_version
        self._model_kwargs = kwargs
        self._timeout = timeout
        self._streaming_callback = streaming_callback

    def get_generator(
        self,
        system_prompt: Optional[str] = None,
        generation_kwargs: Optional[Dict[str, Any]] = None,
        query_id: Optional[str] = None,
    ):
        combined_generation_kwargs = {**self._model_kwargs, **(generation_kwargs or {})}

        async def _run(prompt: str, generation_kwargs: Optional[Dict[str, Any]] = None):
            message = ChatMessage.from_user(prompt)
            if system_prompt:
                messages = [ChatMessage.from_assistant(system_prompt), message]
            else:
                messages = [message]

            openai_formatted_messages = [
                message.to_openai_format() for message in messages
            ]

            generation_kwargs = {
                **combined_generation_kwargs,
                **(generation_kwargs or {}),
            }

            completion: Union[ModelResponse] = await acompletion(
                model=self._model,
                api_key=self._api_key,
                api_base=self._api_base,
                api_version=self._api_version,
                timeout=self._timeout,
                messages=openai_formatted_messages,
                stream=self._streaming_callback is not None,
                **generation_kwargs,
            )

            completions: List[ChatMessage] = []
            if self._streaming_callback is not None:
                num_responses = generation_kwargs.pop("n", 1)
                if num_responses > 1:
                    raise ValueError(
                        "Cannot stream multiple responses, please set n=1."
                    )
                chunks: List[StreamingChunk] = []
                chunk = None

                async for chunk in completion:
                    if chunk.choices and self._streaming_callback:
                        chunk_delta: StreamingChunk = self._build_chunk(chunk)
                        chunks.append(chunk_delta)
                        self._streaming_callback(
                            chunk_delta, query_id
                        )  # invoke callback with the chunk_delta
                completions = [_connect_chunks(chunk, chunks)]
            else:
                completions = [
                    _build_message(completion, choice) for choice in completion.choices
                ]

            # before returning, do post-processing of the completions
            for response in completions:
                _check_finish_reason(response)

            return {
                "replies": [message.content for message in completions],
                "meta": [message.meta for message in completions],
            }

        return _run
