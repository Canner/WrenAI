import json
from typing import List, Union

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

import ragas.messages as r


def convert_to_ragas_messages(
    messages: List[Union[HumanMessage, SystemMessage, AIMessage, ToolMessage]]
) -> List[Union[r.HumanMessage, r.AIMessage, r.ToolMessage]]:
    """
    Convert LangChain messages into Ragas messages for agent evaluation.

    Parameters
    ----------
    messages : List[Union[HumanMessage, SystemMessage, AIMessage, ToolMessage]]
        List of LangChain message objects to be converted.

    Returns
    -------
    List[Union[r.HumanMessage, r.AIMessage, r.ToolMessage]]
        List of corresponding Ragas message objects.

    Raises
    ------
    ValueError
        If an unsupported message type is encountered.
    TypeError
        If message content is not a string.

    Notes
    -----
    SystemMessages are skipped in the conversion process.
    """

    def _validate_string_content(message, message_type: str) -> str:
        if not isinstance(message.content, str):
            raise TypeError(
                f"{message_type} content must be a string, got {type(message.content).__name__}. "
                f"Content: {message.content}"
            )
        return message.content

    MESSAGE_TYPE_MAP = {
        HumanMessage: lambda m: r.HumanMessage(
            content=_validate_string_content(m, "HumanMessage")
        ),
        ToolMessage: lambda m: r.ToolMessage(
            content=_validate_string_content(m, "ToolMessage")
        ),
    }

    def _extract_tool_calls(message: AIMessage) -> List[r.ToolCall]:
        tool_calls = message.additional_kwargs.get("tool_calls", [])
        return [
            r.ToolCall(
                name=tool_call["function"]["name"],
                args=json.loads(tool_call["function"]["arguments"]),
            )
            for tool_call in tool_calls
        ]

    def _convert_ai_message(message: AIMessage) -> r.AIMessage:
        tool_calls = _extract_tool_calls(message) if message.additional_kwargs else None
        return r.AIMessage(
            content=_validate_string_content(message, "AIMessage"),
            tool_calls=tool_calls,
        )

    def _convert_message(message):
        if isinstance(message, SystemMessage):
            return None  # Skip SystemMessages
        if isinstance(message, AIMessage):
            return _convert_ai_message(message)
        converter = MESSAGE_TYPE_MAP.get(type(message))
        if converter is None:
            raise ValueError(f"Unsupported message type: {type(message).__name__}")
        return converter(message)

    return [
        converted
        for message in messages
        if (converted := _convert_message(message)) is not None
    ]
