# SPDX-FileCopyrightText: 2022-present deepset GmbH <info@deepset.ai>
#
# SPDX-License-Identifier: Apache-2.0

from typing import Any, Callable, Dict, List, Optional, Type, Union

from haystack import component, default_from_dict
from haystack.dataclasses import StreamingChunk
from haystack.lazy_imports import LazyImport
from haystack.utils.callable_serialization import deserialize_callable

from haystack_experimental.dataclasses import ChatMessage, ToolCall
from haystack_experimental.dataclasses.tool import Tool, deserialize_tools_inplace

with LazyImport("Run 'pip install ollama-haystack'") as ollama_integration_import:
    # pylint: disable=import-error
    from haystack_integrations.components.generators.ollama import OllamaChatGenerator as OllamaChatGeneratorBase

    from ollama import ChatResponse


# The following code block ensures that:
# - we reuse existing code where possible
# - people can use haystack-experimental without installing ollama-haystack.
#
#
# If ollama-haystack is installed: all works correctly.
#
# If ollama-haystack is not installed:
# - haystack-experimental package works fine (no import errors).
# - OllamaChatGenerator fails with ImportError at init (due to ollama_integration_import.check()).

if ollama_integration_import.is_successful():
    chatgenerator_base_class: Type[OllamaChatGeneratorBase] = OllamaChatGeneratorBase
else:
    chatgenerator_base_class: Type[object] = object  # type: ignore[no-redef]


def _convert_message_to_ollama_format(message: ChatMessage) -> Dict[str, Any]:
    """
    Convert a message to the format expected by Ollama Chat API.
    """
    text_contents = message.texts
    tool_calls = message.tool_calls
    tool_call_results = message.tool_call_results

    if not text_contents and not tool_calls and not tool_call_results:
        raise ValueError("A `ChatMessage` must contain at least one `TextContent`, `ToolCall`, or `ToolCallResult`.")
    elif len(text_contents) + len(tool_call_results) > 1:
        raise ValueError("A `ChatMessage` can only contain one `TextContent` or one `ToolCallResult`.")

    ollama_msg: Dict[str, Any] = {"role": message._role.value}

    if tool_call_results:
        # Ollama does not provide a way to communicate errors in tool invocations, so we ignore the error field
        ollama_msg["content"] = tool_call_results[0].result
        return ollama_msg

    if text_contents:
        ollama_msg["content"] = text_contents[0]
    if tool_calls:
        # Ollama does not support tool call id, so we ignore it
        ollama_msg["tool_calls"] = [
            {"type": "function", "function": {"name": tc.tool_name, "arguments": tc.arguments}} for tc in tool_calls
        ]
    return ollama_msg


@component()
class OllamaChatGenerator(chatgenerator_base_class):
    """
    Supports models running on Ollama.

    Find the full list of supported models [here](https://ollama.ai/library).

    Usage example:
    ```python
    from haystack_experimental.components.generators.ollama import OllamaChatGenerator
    from haystack_experimental.dataclasses import ChatMessage

    generator = OllamaChatGenerator(model="zephyr",
                                url = "http://localhost:11434",
                                generation_kwargs={
                                "num_predict": 100,
                                "temperature": 0.9,
                                })

    messages = [ChatMessage.from_system("\nYou are a helpful, respectful and honest assistant"),
    ChatMessage.from_user("What's Natural Language Processing?")]

    print(generator.run(messages=messages))
    ```
    """

    def __init__(
        self,
        model: str = "orca-mini",
        url: str = "http://localhost:11434",
        generation_kwargs: Optional[Dict[str, Any]] = None,
        timeout: int = 120,
        keep_alive: Optional[Union[float, str]] = None,
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
        tools: Optional[List[Tool]] = None,
    ):
        """
        Creates an instance of OllamaChatGenerator.

        :param model:
            The name of the model to use. The model should be available in the running Ollama instance.
        :param url:
            The URL of a running Ollama instance.
        :param generation_kwargs:
            Optional arguments to pass to the Ollama generation endpoint, such as temperature,
            top_p, and others. See the available arguments in
            [Ollama docs](https://github.com/ollama/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values).
        :param timeout:
            The number of seconds before throwing a timeout error from the Ollama API.
        :param keep_alive:
            The option that controls how long the model will stay loaded into memory following the request.
            If not set, it will use the default value from the Ollama (5 minutes).
            The value can be set to:
            - a duration string (such as "10m" or "24h")
            - a number in seconds (such as 3600)
            - any negative number which will keep the model loaded in memory (e.g. -1 or "-1m")
            - '0' which will unload the model immediately after generating a response.
        :param streaming_callback:
            A callback function that is called when a new token is received from the stream.
            The callback function accepts StreamingChunk as an argument.
        :param tools:
            A list of tools for which the model can prepare calls.
            Not all models support tools. For a list of models compatible with tools, see the
            [models page](https://ollama.com/search?c=tools).
        """
        ollama_integration_import.check()

        if tools:
            tool_names = [tool.name for tool in tools]
            duplicate_tool_names = {name for name in tool_names if tool_names.count(name) > 1}
            if duplicate_tool_names:
                raise ValueError(f"Duplicate tool names found: {duplicate_tool_names}")
        self.tools = tools

        super(OllamaChatGenerator, self).__init__(
            model=model,
            url=url,
            generation_kwargs=generation_kwargs,
            timeout=timeout,
            keep_alive=keep_alive,
            streaming_callback=streaming_callback,
        )

    def to_dict(self) -> Dict[str, Any]:
        """
        Serialize this component to a dictionary.

        :returns:
            The serialized component as a dictionary.
        """
        serialized = super(OllamaChatGenerator, self).to_dict()
        serialized["init_parameters"]["tools"] = [tool.to_dict() for tool in self.tools] if self.tools else None
        return serialized

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "OllamaChatGenerator":
        """
        Deserialize this component from a dictionary.

        :param data: The dictionary representation of this component.
        :returns:
            The deserialized component instance.
        """
        deserialize_tools_inplace(data["init_parameters"], key="tools")
        init_params = data.get("init_parameters", {})
        serialized_callback_handler = init_params.get("streaming_callback")
        if serialized_callback_handler:
            data["init_parameters"]["streaming_callback"] = deserialize_callable(serialized_callback_handler)

        return default_from_dict(cls, data)

    def _build_message_from_ollama_response(self, ollama_response: "ChatResponse") -> ChatMessage:
        """
        Converts the non-streaming response from the Ollama API to a ChatMessage.
        """
        response_dict = ollama_response.model_dump()

        ollama_message = response_dict["message"]

        text = ollama_message["content"]

        tool_calls = []
        if ollama_tool_calls := ollama_message.get("tool_calls"):
            for ollama_tc in ollama_tool_calls:
                tool_calls.append(
                    ToolCall(tool_name=ollama_tc["function"]["name"], arguments=ollama_tc["function"]["arguments"])
                )

        message = ChatMessage.from_assistant(text=text, tool_calls=tool_calls)

        message.meta.update({key: value for key, value in response_dict.items() if key != "message"})
        return message

    def _convert_to_streaming_response(self, chunks: List[StreamingChunk]) -> Dict[str, List[Any]]:
        """
        Converts a list of chunks response required Haystack format.
        """

        # Unaltered from the integration code. Overridden to use the experimental ChatMessage dataclass.

        replies = [ChatMessage.from_assistant("".join([c.content for c in chunks]))]
        meta = {key: value for key, value in chunks[0].meta.items() if key != "message"}

        return {"replies": replies, "meta": [meta]}

    @component.output_types(replies=List[ChatMessage])
    def run(
        self,
        messages: List[ChatMessage],
        generation_kwargs: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Tool]] = None,
    ):
        """
        Runs an Ollama Model on a given chat history.

        :param messages:
            A list of ChatMessage instances representing the input messages.
        :param generation_kwargs:
            Optional arguments to pass to the Ollama generation endpoint, such as temperature,
            top_p, etc. See the
            [Ollama docs](https://github.com/ollama/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values).
        :param tools:
            A list of tools for which the model can prepare calls. If set, it will override the `tools` parameter set
            during component initialization.
        :returns: A dictionary with the following keys:
            - `replies`: The responses from the model
        """
        generation_kwargs = {**self.generation_kwargs, **(generation_kwargs or {})}

        stream = self.streaming_callback is not None
        tools = tools or self.tools

        if stream and tools:
            raise ValueError("Ollama does not support tools and streaming at the same time. Please choose one.")

        ollama_tools = None
        if tools:
            tool_names = [tool.name for tool in tools]
            duplicate_tool_names = {name for name in tool_names if tool_names.count(name) > 1}
            if duplicate_tool_names:
                raise ValueError(f"Duplicate tool names found: {duplicate_tool_names}")

            ollama_tools = [{"type": "function", "function": {**t.tool_spec}} for t in tools]

        ollama_messages = [_convert_message_to_ollama_format(msg) for msg in messages]
        response = self._client.chat(
            model=self.model,
            messages=ollama_messages,
            tools=ollama_tools,
            stream=stream,
            keep_alive=self.keep_alive,
            options=generation_kwargs,
        )

        if stream:
            chunks: List[StreamingChunk] = self._handle_streaming_response(response)
            return self._convert_to_streaming_response(chunks)

        return {"replies": [self._build_message_from_ollama_response(response)]}
