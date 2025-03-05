# SPDX-FileCopyrightText: 2022-present deepset GmbH <info@deepset.ai>
#
# SPDX-License-Identifier: Apache-2.0

from typing import Any, Callable, Dict, Iterable, List, Optional, Union

from haystack import component, default_from_dict, logging
from haystack.dataclasses import StreamingChunk
from haystack.lazy_imports import LazyImport
from haystack.utils import Secret, deserialize_callable, deserialize_secrets_inplace
from haystack.utils.hf import HFGenerationAPIType

with LazyImport(message="Run 'pip install \"huggingface_hub[inference]>=0.23.0\"'") as huggingface_hub_import:
    from huggingface_hub import (
        ChatCompletionInputTool,
        ChatCompletionOutput,
        ChatCompletionStreamOutput,
    )

from haystack.components.generators.chat.hugging_face_api import (
    HuggingFaceAPIChatGenerator as HuggingFaceAPIChatGeneratorBase,
)

from haystack_experimental.dataclasses import ChatMessage, ToolCall
from haystack_experimental.dataclasses.tool import Tool, deserialize_tools_inplace

logger = logging.getLogger(__name__)


def _convert_message_to_hfapi_format(message: ChatMessage) -> Dict[str, Any]:
    """
    Convert a message to the format expected by Hugging Face API.
    """
    text_contents = message.texts
    tool_calls = message.tool_calls
    tool_call_results = message.tool_call_results

    if not text_contents and not tool_calls and not tool_call_results:
        raise ValueError("A `ChatMessage` must contain at least one `TextContent`, `ToolCall`, or `ToolCallResult`.")
    elif len(text_contents) + len(tool_call_results) > 1:
        raise ValueError("A `ChatMessage` can only contain one `TextContent` or one `ToolCallResult`.")

    # HF API always expects a content field, even if it is empty
    hfapi_msg: Dict[str, Any] = {"role": message._role.value, "content": ""}

    if tool_call_results:
        result = tool_call_results[0]
        hfapi_msg["content"] = result.result
        if tc_id := result.origin.id:
            hfapi_msg["tool_call_id"] = tc_id
        # HF API does not provide a way to communicate errors in tool invocations, so we ignore the error field
        return hfapi_msg

    if text_contents:
        hfapi_msg["content"] = text_contents[0]
    if tool_calls:
        hfapi_tool_calls = []
        for tc in tool_calls:
            hfapi_tool_call = {
                "type": "function",
                "function": {"name": tc.tool_name, "arguments": tc.arguments},
            }
            if tc.id is not None:
                hfapi_tool_call["id"] = tc.id
            hfapi_tool_calls.append(hfapi_tool_call)
        hfapi_msg["tool_calls"] = hfapi_tool_calls

    return hfapi_msg


@component
class HuggingFaceAPIChatGenerator(HuggingFaceAPIChatGeneratorBase):
    """
    Completes chats using Hugging Face APIs.

    HuggingFaceAPIChatGenerator uses the [ChatMessage](https://docs.haystack.deepset.ai/docs/data-classes#chatmessage)
    format for input and output. Use it to generate text with Hugging Face APIs:
    - [Free Serverless Inference API](https://huggingface.co/inference-api)
    - [Paid Inference Endpoints](https://huggingface.co/inference-endpoints)
    - [Self-hosted Text Generation Inference](https://github.com/huggingface/text-generation-inference)

    ### Usage examples

    #### With the free serverless inference API

    ```python
    from haystack.components.generators.chat import HuggingFaceAPIChatGenerator
    from haystack.dataclasses import ChatMessage
    from haystack.utils import Secret
    from haystack.utils.hf import HFGenerationAPIType

    messages = [ChatMessage.from_system("\\nYou are a helpful, respectful and honest assistant"),
                ChatMessage.from_user("What's Natural Language Processing?")]

    # the api_type can be expressed using the HFGenerationAPIType enum or as a string
    api_type = HFGenerationAPIType.SERVERLESS_INFERENCE_API
    api_type = "serverless_inference_api" # this is equivalent to the above

    generator = HuggingFaceAPIChatGenerator(api_type=api_type,
                                            api_params={"model": "HuggingFaceH4/zephyr-7b-beta"},
                                            token=Secret.from_token("<your-api-key>"))

    result = generator.run(messages)
    print(result)
    ```

    #### With paid inference endpoints

    ```python
    from haystack.components.generators.chat import HuggingFaceAPIChatGenerator
    from haystack.dataclasses import ChatMessage
    from haystack.utils import Secret

    messages = [ChatMessage.from_system("\\nYou are a helpful, respectful and honest assistant"),
                ChatMessage.from_user("What's Natural Language Processing?")]

    generator = HuggingFaceAPIChatGenerator(api_type="inference_endpoints",
                                            api_params={"url": "<your-inference-endpoint-url>"},
                                            token=Secret.from_token("<your-api-key>"))

    result = generator.run(messages)
    print(result)

    #### With self-hosted text generation inference

    ```python
    from haystack.components.generators.chat import HuggingFaceAPIChatGenerator
    from haystack.dataclasses import ChatMessage

    messages = [ChatMessage.from_system("\\nYou are a helpful, respectful and honest assistant"),
                ChatMessage.from_user("What's Natural Language Processing?")]

    generator = HuggingFaceAPIChatGenerator(api_type="text_generation_inference",
                                            api_params={"url": "http://localhost:8080"})

    result = generator.run(messages)
    print(result)
    ```
    """

    def __init__(
        self,
        api_type: Union[HFGenerationAPIType, str],
        api_params: Dict[str, str],
        token: Optional[Secret] = Secret.from_env_var(["HF_API_TOKEN", "HF_TOKEN"], strict=False),
        generation_kwargs: Optional[Dict[str, Any]] = None,
        stop_words: Optional[List[str]] = None,
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
        tools: Optional[List[Tool]] = None,
    ):
        """
        Initialize the HuggingFaceAPIChatGenerator instance.

        :param api_type:
            The type of Hugging Face API to use. Available types:
            - `text_generation_inference`: See [TGI](https://github.com/huggingface/text-generation-inference).
            - `inference_endpoints`: See [Inference Endpoints](https://huggingface.co/inference-endpoints).
            - `serverless_inference_api`: See [Serverless Inference API](https://huggingface.co/inference-api).
        :param api_params:
            A dictionary with the following keys:
            - `model`: Hugging Face model ID. Required when `api_type` is `SERVERLESS_INFERENCE_API`.
            - `url`: URL of the inference endpoint. Required when `api_type` is `INFERENCE_ENDPOINTS` or
            `TEXT_GENERATION_INFERENCE`.
        :param token:
            The Hugging Face token to use as HTTP bearer authorization.
            Check your HF token in your [account settings](https://huggingface.co/settings/tokens).
        :param generation_kwargs:
            A dictionary with keyword arguments to customize text generation.
                Some examples: `max_tokens`, `temperature`, `top_p`.
                For details, see [Hugging Face chat_completion documentation](https://huggingface.co/docs/huggingface_hub/package_reference/inference_client#huggingface_hub.InferenceClient.chat_completion).
        :param stop_words:
            An optional list of strings representing the stop words.
        :param streaming_callback:
            An optional callable for handling streaming responses.
        :param tools:
            A list of tools for which the model can prepare calls.
            The chosen model should support tool/function calling, according to the model card.
            Support for tools in the Hugging Face API and TGI is not yet fully refined and you may experience
            unexpected behavior.
        """

        # the base class __init__ also checks the hugingface_hub lazy import
        super(HuggingFaceAPIChatGenerator, self).__init__(
            api_type=api_type,
            api_params=api_params,
            token=token,
            generation_kwargs=generation_kwargs,
            stop_words=stop_words,
            streaming_callback=streaming_callback,
        )

        if tools:
            tool_names = [tool.name for tool in tools]
            duplicate_tool_names = {name for name in tool_names if tool_names.count(name) > 1}
            if duplicate_tool_names:
                raise ValueError(f"Duplicate tool names found: {duplicate_tool_names}")
        self.tools = tools

        if tools and streaming_callback is not None:
            raise ValueError("Using tools and streaming at the same time is not supported. Please choose one.")

    def to_dict(self) -> Dict[str, Any]:
        """
        Serialize this component to a dictionary.

        :returns:
            A dictionary containing the serialized component.
        """
        serialized = super(HuggingFaceAPIChatGenerator, self).to_dict()
        serialized["init_parameters"]["tools"] = [tool.to_dict() for tool in self.tools] if self.tools else None
        return serialized

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "HuggingFaceAPIChatGenerator":
        """
        Deserialize this component from a dictionary.
        """
        deserialize_secrets_inplace(data["init_parameters"], keys=["token"])
        deserialize_tools_inplace(data["init_parameters"], key="tools")
        init_params = data.get("init_parameters", {})
        serialized_callback_handler = init_params.get("streaming_callback")
        if serialized_callback_handler:
            data["init_parameters"]["streaming_callback"] = deserialize_callable(serialized_callback_handler)

        return default_from_dict(cls, data)

    @component.output_types(replies=List[ChatMessage])
    def run(
        self,
        messages: List[ChatMessage],
        generation_kwargs: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Tool]] = None,
    ):
        """
        Invoke the text generation inference based on the provided messages and generation parameters.

        :param messages:
            A list of ChatMessage objects representing the input messages.
        :param generation_kwargs:
            Additional keyword arguments for text generation.
        :param tools:
            A list of tools for which the model can prepare calls. If set, it will override the `tools` parameter set
            during component initialization.
        :returns: A dictionary with the following keys:
            - `replies`: A list containing the generated responses as ChatMessage objects.
        """

        # update generation kwargs by merging with the default ones
        generation_kwargs = {**self.generation_kwargs, **(generation_kwargs or {})}

        formatted_messages = [_convert_message_to_hfapi_format(message) for message in messages]

        tools = tools or self.tools
        if tools:
            tool_names = [tool.name for tool in tools]
            duplicate_tool_names = {name for name in tool_names if tool_names.count(name) > 1}
            if duplicate_tool_names:
                raise ValueError(f"Duplicate tool names found: {duplicate_tool_names}")

        if tools and self.streaming_callback is not None:
            raise ValueError("Using tools and streaming at the same time is not supported. Please choose one.")

        if self.streaming_callback:
            return self._run_streaming(formatted_messages, generation_kwargs)

        hf_tools = None
        if tools:
            hf_tools = [{"type": "function", "function": {**t.tool_spec}} for t in tools]

        return self._run_non_streaming(formatted_messages, generation_kwargs, hf_tools)

    def _run_streaming(self, messages: List[Dict[str, str]], generation_kwargs: Dict[str, Any]):
        api_output: Iterable[ChatCompletionStreamOutput] = self._client.chat_completion(
            messages, stream=True, **generation_kwargs
        )

        generated_text = ""

        for chunk in api_output:
            # n is unused, so the API always returns only one choice
            # the argument is probably allowed for compatibility with OpenAI
            # see https://huggingface.co/docs/huggingface_hub/package_reference/inference_client#huggingface_hub.InferenceClient.chat_completion.n
            choice = chunk.choices[0]

            text = choice.delta.content
            if text:
                generated_text += text

            finish_reason = choice.finish_reason

            meta = {}
            if finish_reason:
                meta["finish_reason"] = finish_reason

            stream_chunk = StreamingChunk(text, meta)
            self.streaming_callback(stream_chunk)

        message = ChatMessage.from_assistant(text=generated_text)
        message.meta.update(
            {
                "model": self._client.model,
                "finish_reason": finish_reason,
                "index": 0,
                "usage": {"prompt_tokens": 0, "completion_tokens": 0},  # not available in streaming
            }
        )

        return {"replies": [message]}

    def _run_non_streaming(
        self,
        messages: List[Dict[str, str]],
        generation_kwargs: Dict[str, Any],
        tools: Optional[List["ChatCompletionInputTool"]] = None,
    ) -> Dict[str, List[ChatMessage]]:
        api_chat_output: ChatCompletionOutput = self._client.chat_completion(
            messages=messages, tools=tools, **generation_kwargs
        )

        if len(api_chat_output.choices) == 0:
            return {"replies": []}

        # n is unused, so the API always returns only one choice
        # the argument is probably allowed for compatibility with OpenAI
        # see https://huggingface.co/docs/huggingface_hub/package_reference/inference_client#huggingface_hub.InferenceClient.chat_completion.n
        choice = api_chat_output.choices[0]

        text = choice.message.content
        tool_calls = []

        if hfapi_tool_calls := choice.message.tool_calls:
            for hfapi_tc in hfapi_tool_calls:
                tool_call = ToolCall(
                    tool_name=hfapi_tc.function.name,
                    arguments=hfapi_tc.function.arguments,
                    id=hfapi_tc.id,
                )
                tool_calls.append(tool_call)

        meta = {
            "model": self._client.model,
            "finish_reason": choice.finish_reason,
            "index": choice.index,
            "usage": {
                "prompt_tokens": api_chat_output.usage.prompt_tokens,
                "completion_tokens": api_chat_output.usage.completion_tokens,
            },
        }

        message = ChatMessage.from_assistant(text=text, tool_calls=tool_calls, meta=meta)
        return {"replies": [message]}
