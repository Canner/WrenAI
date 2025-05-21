import logging
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger("wren-ai-service")


class ChatRole(str, Enum):
    """Enumeration representing the roles within a chat."""

    ASSISTANT = "assistant"
    USER = "user"
    SYSTEM = "system"
    FUNCTION = "function"


@dataclass
class ChatMessage:
    """
    Represents a message in a LLM chat conversation.

    :param content: The text content of the message.
    :param role: The role of the entity sending the message.
    :param name: The name of the function being called (only applicable for role FUNCTION).
    :param meta: Additional metadata associated with the message.
    """

    content: str
    role: ChatRole
    name: Optional[str] = None
    image_url: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict, hash=False)

    def is_from(self, role: ChatRole) -> bool:
        """
        Check if the message is from a specific role.

        :param role: The role to check against.
        :returns: True if the message is from the specified role, False otherwise.
        """
        return self.role == role

    @classmethod
    def from_assistant(
        cls, content: str, meta: Optional[Dict[str, Any]] = None
    ) -> "ChatMessage":
        """
        Create a message from the assistant.

        :param content: The text content of the message.
        :param meta: Additional metadata associated with the message.
        :returns: A new ChatMessage instance.
        """
        return cls(
            content, ChatRole.ASSISTANT, name=None, image_url=None, meta=meta or {}
        )

    @classmethod
    def from_user(cls, content: str, image_url: Optional[str] = None) -> "ChatMessage":
        """
        Create a message from the user.

        :param content: The text content of the message.
        :returns: A new ChatMessage instance.
        """
        return cls(content, ChatRole.USER, name=None, image_url=image_url)

    @classmethod
    def from_system(cls, content: str) -> "ChatMessage":
        """
        Create a message from the system.

        :param content: The text content of the message.
        :returns: A new ChatMessage instance.
        """
        return cls(content, ChatRole.SYSTEM, name=None, image_url=None)

    @classmethod
    def from_function(cls, content: str, name: str) -> "ChatMessage":
        """
        Create a message from a function call.

        :param content: The text content of the message.
        :param name: The name of the function being called.
        :returns: A new ChatMessage instance.
        """
        return cls(content, ChatRole.FUNCTION, name=name, image_url=None, meta=None)

    def to_dict(self) -> Dict[str, Any]:
        """
        Converts ChatMessage into a dictionary.

        :returns:
            Serialized version of the object.
        """
        data = asdict(self)
        data["role"] = self.role.value

        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChatMessage":
        """
        Creates a new ChatMessage object from a dictionary.

        :param data:
            The dictionary to build the ChatMessage object.
        :returns:
            The created object.
        """
        data["role"] = ChatRole(data["role"])

        return cls(**data)


@dataclass
class StreamingChunk:
    """
    The StreamingChunk class encapsulates a segment of streamed content along with associated metadata.

    This structure facilitates the handling and processing of streamed data in a systematic manner.

    :param content: The content of the message chunk as a string.
    :param meta: A dictionary containing metadata related to the message chunk.
    """

    content: str
    meta: Dict[str, Any] = field(default_factory=dict, hash=False)


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
            "The completion for index %s has been truncated before reaching a natural stopping point. "
            "Finish reason: %s. Increase the max_tokens parameter to allow for longer completions.",
            message.meta["index"],
            message.meta["finish_reason"],
        )
    if message.meta["finish_reason"] == "content_filter":
        logger.warning(
            "The completion for index %s has been truncated due to the content filter. "
            "Finish reason: %s.",
            message.meta["index"],
            message.meta["finish_reason"],
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


def convert_message_to_openai_format(message: ChatMessage) -> Dict[str, str]:
    """
    Convert a message to the format expected by OpenAI's Chat API.

    See the [API reference](https://platform.openai.com/docs/api-reference/chat/create) for details.

    :returns: A dictionary with the following key:
        - `role`
        - `content`
        - `name` (optional)
    """
    openai_msg = {"role": message.role.value}

    if message.content and hasattr(message, "image_url") and message.image_url:
        openai_msg["content"] = [
            {"type": "text", "text": message.content},
            {"type": "image_url", "image_url": {"url": message.image_url}},
        ]
    elif message.content:
        openai_msg["content"] = message.content
    elif hasattr(message, "image_url") and message.image_url:
        openai_msg["content"] = [
            {"type": "image_url", "image_url": {"url": message.image_url}}
        ]

    if hasattr(message, "name") and message.name:
        openai_msg["name"] = message.name

    return openai_msg
