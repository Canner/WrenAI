import json
from typing import Any, Dict, List, Union
from ragas.messages import AIMessage, HumanMessage, ToolCall, ToolMessage


def convert_to_ragas_messages(
    messages: List[Dict[str, Any]],
) -> List[Union[HumanMessage, AIMessage, ToolMessage]]:
    """
    Convert Swarm messages to Ragas message format.

    Parameters
    ----------
    messages : List[Union[Response, Dict]]
        List of messages to convert, where each message can be either:
        - Response: A Swarm Response object containing messages
        - Dict: A dictionary containing a user message

    Returns
    -------
    List[Union[HumanMessage, AIMessage, ToolMessage]]
        List of converted Ragas format messages where:
        - HumanMessage: For user messages
        - AIMessage: For assistant messages with optional tool calls
        - ToolMessage: For tool response messages

    Raises
    ------
    KeyError
        If a message is missing the required 'role' key
    """

    def convert_tool_calls(tool_calls_data: List[Dict[str, Any]]) -> List[ToolCall]:
        """Convert tool calls data to Ragas ToolCall objects"""
        return [
            ToolCall(
                name=tool_call["function"]["name"],
                args=json.loads(tool_call["function"]["arguments"]),
            )
            for tool_call in tool_calls_data
        ]

    def handle_assistant_message(message: Dict[str, Any]) -> AIMessage:
        """Convert assistant message to Ragas AIMessage"""
        tool_calls = (
            convert_tool_calls(message["tool_calls"]) if message["tool_calls"] else []
        )
        ai_message_content = message.get("content")
        return AIMessage(
            content=ai_message_content if ai_message_content else "",
            tool_calls=tool_calls,
        )

    def handle_tool_message(message: Dict[str, str]) -> ToolMessage:
        """Convert tool message to Ragas ToolMessage"""
        return ToolMessage(content=message["content"])

    def handle_user_message(message: Dict[str, str]) -> HumanMessage:
        """Convert user message to Ragas HumanMessage"""
        return HumanMessage(content=message["content"])

    converted_messages = []

    for message in messages:
        role = message.get("role")
        if role is None:
            raise KeyError("'role' key not present in message")

        if role == "assistant":
            converted_messages.append(handle_assistant_message(message))
        elif role == "tool":
            converted_messages.append(handle_tool_message(message))
        elif role == "user":
            converted_messages.append(handle_user_message(message))
        else:
            raise ValueError(
                f"Role must be one of ['assistant', 'user', 'tool'], but found '{role}'"
            )

    return converted_messages
