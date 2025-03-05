# SPDX-FileCopyrightText: 2022-present deepset GmbH <info@deepset.ai>
#
# SPDX-License-Identifier: Apache-2.0

import json
import logging
from typing import Any, Callable, Dict, List, Optional, Tuple, Type

from haystack import component, default_from_dict
from haystack.dataclasses import StreamingChunk
from haystack.lazy_imports import LazyImport
from haystack.utils import Secret, deserialize_callable, deserialize_secrets_inplace

from haystack_experimental.dataclasses import ChatMessage, ToolCall
from haystack_experimental.dataclasses.chat_message import ChatRole, ToolCallResult
from haystack_experimental.dataclasses.tool import Tool, deserialize_tools_inplace

logger = logging.getLogger(__name__)


with LazyImport("Run 'pip install anthropic-haystack'") as anthropic_integration_import:
    # pylint: disable=import-error
    from haystack_integrations.components.generators.anthropic import (
        AnthropicChatGenerator as AnthropicChatGeneratorBase,
    )

    from anthropic import Stream


# The following code block ensures that:
# - we reuse existing code where possible
# - people can use haystack-experimental without installing anthropic-haystack.
#
# If anthropic-haystack is installed: all works correctly.
#
# If anthropic-haystack is not installed:
# - haystack-experimental package works fine (no import errors).
# - AnthropicChatGenerator fails with ImportError at init (due to anthropic_integration_import.check()).

if anthropic_integration_import.is_successful():
    chatgenerator_base_class: Type[AnthropicChatGeneratorBase] = AnthropicChatGeneratorBase
else:
    chatgenerator_base_class: Type[object] = object  # type: ignore[no-redef]


def _update_anthropic_message_with_tool_call_results(
    tool_call_results: List[ToolCallResult], anthropic_msg: Dict[str, Any]
) -> None:
    """
    Update an Anthropic message with tool call results.

    :param tool_call_results: The list of ToolCallResults to update the message with.
    :param anthropic_msg: The Anthropic message to update.
    """
    if "content" not in anthropic_msg:
        anthropic_msg["content"] = []

    for tool_call_result in tool_call_results:
        if tool_call_result.origin.id is None:
            raise ValueError("`ToolCall` must have a non-null `id` attribute to be used with Anthropic.")
        anthropic_msg["content"].append(
            {
                "type": "tool_result",
                "tool_use_id": tool_call_result.origin.id,
                "content": [{"type": "text", "text": tool_call_result.result}],
                "is_error": tool_call_result.error,
            }
        )


def _convert_tool_calls_to_anthropic_format(tool_calls: List[ToolCall]) -> List[Dict[str, Any]]:
    """
    Convert a list of tool calls to the format expected by Anthropic Chat API.

    :param tool_calls: The list of ToolCalls to convert.
    :return: A list of dictionaries in the format expected by Anthropic API.
    """
    anthropic_tool_calls = []
    for tc in tool_calls:
        if tc.id is None:
            raise ValueError("`ToolCall` must have a non-null `id` attribute to be used with Anthropic.")
        anthropic_tool_calls.append(
            {
                "type": "tool_use",
                "id": tc.id,
                "name": tc.tool_name,
                "input": tc.arguments,
            }
        )
    return anthropic_tool_calls


def _convert_messages_to_anthropic_format(
    messages: List[ChatMessage],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Convert a list of messages to the format expected by Anthropic Chat API.

    :param messages: The list of ChatMessages to convert.
    :return: A tuple of two lists:
        - A list of system message dictionaries in the format expected by Anthropic API.
        - A list of non-system message dictionaries in the format expected by Anthropic API.
    """

    anthropic_system_messages = []
    anthropic_non_system_messages = []

    i = 0
    while i < len(messages):
        message = messages[i]

        # system messages have special format requirements for Anthropic API
        # they can have only type and text fields, and they need to be passed separately
        # to the Anthropic API endpoint
        if message.is_from(ChatRole.SYSTEM):
            anthropic_system_messages.append({"type": "text", "text": message.text})
            i += 1
            continue

        anthropic_msg: Dict[str, Any] = {"role": message._role.value, "content": []}

        if message.texts and message.texts[0]:
            anthropic_msg["content"].append({"type": "text", "text": message.texts[0]})
        if message.tool_calls:
            anthropic_msg["content"] += _convert_tool_calls_to_anthropic_format(message.tool_calls)

        if message.tool_call_results:
            results = message.tool_call_results.copy()
            # Handle consecutive tool call results
            while (i + 1) < len(messages) and messages[i + 1].tool_call_results:
                i += 1
                results.extend(messages[i].tool_call_results)

            _update_anthropic_message_with_tool_call_results(results, anthropic_msg)
            anthropic_msg["role"] = "user"

        if not anthropic_msg["content"]:
            raise ValueError(
                "A `ChatMessage` must contain at least one `TextContent`, `ToolCall`, or `ToolCallResult`."
            )

        anthropic_non_system_messages.append(anthropic_msg)
        i += 1

    return anthropic_system_messages, anthropic_non_system_messages


def _check_duplicate_tool_names(tools: List[Tool]) -> None:
    """
    Check for duplicate tool names.

    :param tools: The list of tools to check.
    :raises ValueError: If duplicate tool names are found.
    """
    tool_names = [tool.name for tool in tools]
    duplicate_tool_names = {name for name in tool_names if tool_names.count(name) > 1}
    if duplicate_tool_names:
        raise ValueError(f"Duplicate tool names found: {duplicate_tool_names}")


@component
class AnthropicChatGenerator(chatgenerator_base_class):
    """
    Completes chats using Anthropic's large language models (LLMs).

    It uses [ChatMessage](https://docs.haystack.deepset.ai/docs/data-classes#chatmessage)
    format in input and output.

    You can customize how the text is generated by passing parameters to the
    Anthropic API. Use the `**generation_kwargs` argument when you initialize
    the component or when you run it. Any parameter that works with
    `anthropic.Message.create` will work here too.

    For details on Anthropic API parameters, see
    [Anthropic documentation](https://docs.anthropic.com/en/api/messages).

    Usage example:
    ```python
    from haystack_experimental.components.generators.anthropic import AnthropicChatGenerator
    from haystack_experimental.dataclasses import ChatMessage

    generator = AnthropicChatGenerator(model="claude-3-5-sonnet-20240620",
                                       generation_kwargs={
                                           "max_tokens": 1000,
                                           "temperature": 0.7,
                                       })

    messages = [ChatMessage.from_system("You are a helpful, respectful and honest assistant"),
                ChatMessage.from_user("What's Natural Language Processing?")]
    print(generator.run(messages=messages))
    ```
    """

    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("ANTHROPIC_API_KEY"),
        model: str = "claude-3-5-sonnet-20240620",
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
        generation_kwargs: Optional[Dict[str, Any]] = None,
        ignore_tools_thinking_messages: bool = True,
        tools: Optional[List[Tool]] = None,
    ):
        """
        Creates an instance of AnthropicChatGenerator.

        :param api_key: The Anthropic API key.
            You can set it with an environment variable `ANTHROPIC_API_KEY`, or pass with this parameter
            as a Secret during initialization.
        :param model: The name of the Anthropic model to use. Specify one of the Anthropic models with
            their Anthropic API names listed in the
            [Anthropic documentation](https://docs.anthropic.com/en/docs/about-claude/models).
        :param streaming_callback: A callback function that is called when a new token is received from the stream.
            The callback function accepts StreamingChunk as an argument.
        :param generation_kwargs: Additional parameters to use for the model. These parameters are sent directly to
            the Anthropic API. See Anthropic's documentation for more details on available parameters.
             Supported generation_kwargs parameters are:
            - `system`: The system message to be passed to the model.
            - `max_tokens`: The maximum number of tokens to generate.
            - `metadata`: A dictionary of metadata to be passed to the model.
            - `stop_sequences`: A list of strings that the model should stop generating at.
            - `temperature`: The temperature to use for sampling.
            - `top_p`: The top_p value to use for nucleus sampling.
            - `top_k`: The top_k value to use for top-k sampling.
        :param ignore_tools_thinking_messages: Anthropic's approach to tools (function calling) resolution involves a
            "chain of thought" messages before returning the actual function names and parameters in a message. If
            `ignore_tools_thinking_messages` is `True`, the generator will drop so-called thinking messages when tool
            use is detected.
            See the Anthropic [tools](https://docs.anthropic.com/en/docs/build-with-claude/tool-use#chain-of-thought-tool-use)
            for more details.
        :param tools: A list of Tool objects that the model can use. Each tool should have a unique name.
        """
        anthropic_integration_import.check()

        super(AnthropicChatGenerator, self).__init__(
            model=model,
            api_key=api_key,
            generation_kwargs=generation_kwargs,
            streaming_callback=streaming_callback,
        )

        if tools:
            _check_duplicate_tool_names(tools)
        self.tools = tools

    def to_dict(self) -> Dict[str, Any]:
        """
        Serialize this component to a dictionary.

        :returns:
            The serialized component as a dictionary.
        """
        serialized = super(AnthropicChatGenerator, self).to_dict()
        serialized["init_parameters"]["tools"] = [tool.to_dict() for tool in self.tools] if self.tools else None
        return serialized

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AnthropicChatGenerator":
        """
        Deserialize this component from a dictionary.

        :param data: The dictionary representation of this component.
        :returns:
            The deserialized component instance.
        """
        deserialize_secrets_inplace(data["init_parameters"], keys=["api_key"])
        deserialize_tools_inplace(data["init_parameters"], key="tools")
        init_params = data.get("init_parameters", {})
        serialized_callback_handler = init_params.get("streaming_callback")
        if serialized_callback_handler:
            data["init_parameters"]["streaming_callback"] = deserialize_callable(serialized_callback_handler)

        return default_from_dict(cls, data)

    def _convert_chat_completion_to_chat_message(self, anthropic_response: Any) -> ChatMessage:
        """
        Converts the response from the Anthropic API to a ChatMessage.
        """
        text_extracted = ""
        tool_calls = []

        for content_block in anthropic_response.content:
            if content_block.type == "text":
                text_extracted = content_block.text
            elif content_block.type == "tool_use":
                tool_calls.append(
                    ToolCall(
                        tool_name=content_block.name,
                        arguments=content_block.input,  # dict already
                        id=content_block.id,
                    )
                )

        message = ChatMessage.from_assistant(text=text_extracted, tool_calls=tool_calls)

        # Dump the chat completion to a dict
        response_dict = anthropic_response.model_dump()

        # create meta to match the openai format
        message._meta.update(
            {
                "model": response_dict.get("model", None),
                "index": 0,
                "finish_reason": response_dict.get("stop_reason", None),
                "usage": dict(response_dict.get("usage", {})),
            }
        )
        return message

    def _convert_anthropic_chunk_to_streaming_chunk(self, chunk: Any) -> StreamingChunk:
        """
        Converts an Anthropic StreamEvent to a StreamingChunk.
        """
        content = ""
        if chunk.type == "content_block_delta" and chunk.delta.type == "text_delta":
            content = chunk.delta.text

        return StreamingChunk(content=content, meta=chunk.model_dump())

    def _convert_streaming_chunks_to_chat_message(
        self, chunks: List[StreamingChunk], model: Optional[str] = None
    ) -> ChatMessage:
        """
        Converts a list of StreamingChunks to a ChatMessage.
        """
        full_content = ""
        tool_calls = []
        current_tool_call: Optional[Dict[str, Any]] = {}

        # loop through chunks and call the appropriate handler
        for chunk in chunks:
            chunk_type = chunk.meta.get("type")
            if chunk_type == "content_block_start":
                if chunk.meta.get("content_block", {}).get("type") == "tool_use":
                    delta_block = chunk.meta.get("content_block")
                    current_tool_call = {
                        "id": delta_block.get("id"),
                        "name": delta_block.get("name"),
                        "arguments": "",
                    }
            elif chunk_type == "content_block_delta":
                delta = chunk.meta.get("delta", {})
                if delta.get("type") == "text_delta":
                    full_content += delta.get("text", "")
                elif delta.get("type") == "input_json_delta" and current_tool_call:
                    current_tool_call["arguments"] += delta.get("partial_json", "")
            elif chunk_type == "message_delta":  # noqa: SIM102 (prefer nested if statement here for readability)
                if chunk.meta.get("delta", {}).get("stop_reason") == "tool_use" and current_tool_call:
                    try:
                        # arguments is a string, convert to json
                        tool_calls.append(
                            ToolCall(
                                id=current_tool_call.get("id"),
                                tool_name=str(current_tool_call.get("name")),
                                arguments=json.loads(current_tool_call.get("arguments", {})),
                            )
                        )
                    except json.JSONDecodeError:
                        logger.warning(
                            "Anthropic returned a malformed JSON string for tool call arguments. "
                            "This tool call will be skipped. Arguments: %s",
                            current_tool_call.get("arguments", ""),
                        )
                    current_tool_call = None

        message = ChatMessage.from_assistant(full_content, tool_calls=tool_calls)

        # Update meta information
        last_chunk_meta = chunks[-1].meta
        message._meta.update(
            {
                "model": model,
                "index": 0,
                "finish_reason": last_chunk_meta.get("delta", {}).get("stop_reason", None),
                "usage": last_chunk_meta.get("usage", {}),
            }
        )

        return message

    @component.output_types(replies=List[ChatMessage])
    def run(
        self,
        messages: List[ChatMessage],
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
        generation_kwargs: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Tool]] = None,
    ):
        """
        Invokes the Anthropic API with the given messages and generation kwargs.

        :param messages: A list of ChatMessage instances representing the input messages.
        :param streaming_callback: A callback function that is called when a new token is received from the stream.
        :param generation_kwargs: Optional arguments to pass to the Anthropic generation endpoint.
        :param tools: A list of tools for which the model can prepare calls. If set, it will override
        the `tools` parameter set during component initialization.
        :returns: A dictionary with the following keys:
            - `replies`: The responses from the model
        """
        # update generation kwargs by merging with the generation kwargs passed to the run method
        generation_kwargs = {**self.generation_kwargs, **(generation_kwargs or {})}
        disallowed_params = set(generation_kwargs) - set(self.ALLOWED_PARAMS)
        if disallowed_params:
            logger.warning(
                "Model parameters %s are not allowed and will be ignored. Allowed parameters are %s.",
                disallowed_params,
                self.ALLOWED_PARAMS,
            )
        generation_kwargs = {k: v for k, v in generation_kwargs.items() if k in self.ALLOWED_PARAMS}
        tools = tools or self.tools
        if tools:
            _check_duplicate_tool_names(tools)

        system_messages, non_system_messages = _convert_messages_to_anthropic_format(messages)
        anthropic_tools = (
            [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.parameters,
                }
                for tool in tools
            ]
            if tools
            else []
        )

        streaming_callback = streaming_callback or self.streaming_callback

        response = self.client.messages.create(
            model=self.model,
            messages=non_system_messages,
            system=system_messages,
            tools=anthropic_tools,
            stream=streaming_callback is not None,
            max_tokens=generation_kwargs.pop("max_tokens", 1024),
            **generation_kwargs,
        )

        if isinstance(response, Stream):
            chunks: List[StreamingChunk] = []
            model: Optional[str] = None
            for chunk in response:
                if chunk.type == "message_start":
                    model = chunk.message.model
                elif chunk.type in [
                    "content_block_start",
                    "content_block_delta",
                    "message_delta",
                ]:
                    streaming_chunk = self._convert_anthropic_chunk_to_streaming_chunk(chunk)
                    chunks.append(streaming_chunk)
                    if streaming_callback:
                        streaming_callback(streaming_chunk)

            completion = self._convert_streaming_chunks_to_chat_message(chunks, model)
            return {"replies": [completion]}
        else:
            return {"replies": [self._convert_chat_completion_to_chat_message(response)]}
