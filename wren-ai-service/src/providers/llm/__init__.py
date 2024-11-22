import logging
from typing import Any, List

from haystack.dataclasses import ChatMessage, StreamingChunk

logger = logging.getLogger("wren-ai-service")


def build_message(completion: Any, choice: Any) -> ChatMessage:
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


def check_finish_reason(message: ChatMessage) -> None:
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


def connect_chunks(chunk: Any, chunks: List[StreamingChunk]) -> ChatMessage:
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


def build_chunk(chunk: Any) -> StreamingChunk:
    """
    Converts the response from the OpenAI API to a StreamingChunk.

    :param chunk:
        The chunk returned by the OpenAI API.
    :returns:
        The StreamingChunk.
    """
    # function or tools calls are not going to happen in non-chat generation
    # as users can not send ChatMessage with function or tools calls
    choice = chunk.choices[0]
    content = choice.delta.content or ""
    chunk_message = StreamingChunk(content)
    chunk_message.meta.update(
        {
            "model": chunk.model,
            "index": choice.index,
            "finish_reason": choice.finish_reason,
        }
    )
    return chunk_message
