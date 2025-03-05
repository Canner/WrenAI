from __future__ import annotations

import functools
import logging
from collections import defaultdict
from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    DefaultDict,
    Dict,
    List,
    Optional,
    Type,
    TypeVar,
    Union,
)

from typing_extensions import TypedDict

from langsmith import client as ls_client
from langsmith import run_helpers
from langsmith.schemas import InputTokenDetails, OutputTokenDetails, UsageMetadata

if TYPE_CHECKING:
    from openai import AsyncOpenAI, OpenAI
    from openai.types.chat.chat_completion_chunk import (
        ChatCompletionChunk,
        Choice,
        ChoiceDeltaToolCall,
    )
    from openai.types.completion import Completion

# Any is used since it may work with Azure or other providers
C = TypeVar("C", bound=Union["OpenAI", "AsyncOpenAI", Any])
logger = logging.getLogger(__name__)


@functools.lru_cache
def _get_not_given() -> Optional[Type]:
    try:
        from openai._types import NotGiven

        return NotGiven
    except ImportError:
        return None


def _strip_not_given(d: dict) -> dict:
    try:
        not_given = _get_not_given()
        if not_given is None:
            return d
        return {k: v for k, v in d.items() if not isinstance(v, not_given)}
    except Exception as e:
        logger.error(f"Error stripping NotGiven: {e}")
        return d


def _infer_invocation_params(model_type: str, kwargs: dict):
    stripped = _strip_not_given(kwargs)

    stop = stripped.get("stop")
    if stop and isinstance(stop, str):
        stop = [stop]

    return {
        "ls_provider": "openai",
        "ls_model_type": model_type,
        "ls_model_name": stripped.get("model", None),
        "ls_temperature": stripped.get("temperature", None),
        "ls_max_tokens": stripped.get("max_tokens", None),
        "ls_stop": stop,
    }


def _reduce_choices(choices: List[Choice]) -> dict:
    reversed_choices = list(reversed(choices))
    message: Dict[str, Any] = {
        "role": "assistant",
        "content": "",
    }
    for c in reversed_choices:
        if hasattr(c, "delta") and getattr(c.delta, "role", None):
            message["role"] = c.delta.role
            break
    tool_calls: DefaultDict[int, List[ChoiceDeltaToolCall]] = defaultdict(list)
    for c in choices:
        if hasattr(c, "delta") and getattr(c.delta, "content", None):
            if getattr(c.delta, "content", None):
                message["content"] += c.delta.content
            if getattr(c.delta, "function_call", None):
                if not message.get("function_call"):
                    message["function_call"] = {"name": "", "arguments": ""}
                name_ = getattr(c.delta.function_call, "name", None)
                if name_:
                    message["function_call"]["name"] += name_
                arguments_ = getattr(c.delta.function_call, "arguments", None)
                if arguments_:
                    message["function_call"]["arguments"] += arguments_
            if getattr(c.delta, "tool_calls", None):
                tool_calls_list = c.delta.tool_calls
                if tool_calls_list is not None:
                    for tool_call in tool_calls_list:
                        tool_calls[c.index].append(tool_call)
    if tool_calls:
        message["tool_calls"] = [None for _ in tool_calls.keys()]
        for index, tool_call_chunks in tool_calls.items():
            message["tool_calls"][index] = {
                "index": index,
                "id": next((c.id for c in tool_call_chunks if c.id), None),
                "type": next((c.type for c in tool_call_chunks if c.type), None),
            }
            for chunk in tool_call_chunks:
                if getattr(chunk, "function", None):
                    if not message["tool_calls"][index].get("function"):
                        message["tool_calls"][index]["function"] = {
                            "name": "",
                            "arguments": "",
                        }
                    name_ = getattr(chunk.function, "name", None)
                    if name_:
                        fn_ = message["tool_calls"][index]["function"]
                        fn_["name"] += name_
                    arguments_ = getattr(chunk.function, "arguments", None)
                    if arguments_:
                        fn_ = message["tool_calls"][index]["function"]
                        fn_["arguments"] += arguments_
    return {
        "index": getattr(choices[0], "index", 0) if choices else 0,
        "finish_reason": next(
            (
                c.finish_reason
                for c in reversed_choices
                if getattr(c, "finish_reason", None)
            ),
            None,
        ),
        "message": message,
    }


def _reduce_chat(all_chunks: List[ChatCompletionChunk]) -> dict:
    choices_by_index: DefaultDict[int, List[Choice]] = defaultdict(list)
    for chunk in all_chunks:
        for choice in chunk.choices:
            choices_by_index[choice.index].append(choice)
    if all_chunks:
        d = all_chunks[-1].model_dump()
        d["choices"] = [
            _reduce_choices(choices) for choices in choices_by_index.values()
        ]
    else:
        d = {"choices": [{"message": {"role": "assistant", "content": ""}}]}
    # streamed outputs don't go through `process_outputs`
    # so we need to flatten metadata here
    oai_token_usage = d.pop("usage", None)
    d["usage_metadata"] = (
        _create_usage_metadata(oai_token_usage) if oai_token_usage else None
    )
    return d


def _reduce_completions(all_chunks: List[Completion]) -> dict:
    all_content = []
    for chunk in all_chunks:
        content = chunk.choices[0].text
        if content is not None:
            all_content.append(content)
    content = "".join(all_content)
    if all_chunks:
        d = all_chunks[-1].model_dump()
        d["choices"] = [{"text": content}]
    else:
        d = {"choices": [{"text": content}]}

    return d


def _create_usage_metadata(oai_token_usage: dict) -> UsageMetadata:
    input_tokens = oai_token_usage.get("prompt_tokens") or 0
    output_tokens = oai_token_usage.get("completion_tokens") or 0
    total_tokens = oai_token_usage.get("total_tokens") or input_tokens + output_tokens
    input_token_details: dict = {
        "audio": (oai_token_usage.get("prompt_tokens_details") or {}).get(
            "audio_tokens"
        ),
        "cache_read": (oai_token_usage.get("prompt_tokens_details") or {}).get(
            "cached_tokens"
        ),
    }
    output_token_details: dict = {
        "audio": (oai_token_usage.get("completion_tokens_details") or {}).get(
            "audio_tokens"
        ),
        "reasoning": (oai_token_usage.get("completion_tokens_details") or {}).get(
            "reasoning_tokens"
        ),
    }
    return UsageMetadata(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        input_token_details=InputTokenDetails(
            **{k: v for k, v in input_token_details.items() if v is not None}
        ),
        output_token_details=OutputTokenDetails(
            **{k: v for k, v in output_token_details.items() if v is not None}
        ),
    )


def _process_chat_completion(outputs: Any):
    try:
        rdict = outputs.model_dump()
        oai_token_usage = rdict.pop("usage", None)
        rdict["usage_metadata"] = (
            _create_usage_metadata(oai_token_usage) if oai_token_usage else None
        )
        return rdict
    except BaseException as e:
        logger.debug(f"Error processing chat completion: {e}")
        return {"output": outputs}


def _get_wrapper(
    original_create: Callable,
    name: str,
    reduce_fn: Callable,
    tracing_extra: Optional[TracingExtra] = None,
    invocation_params_fn: Optional[Callable] = None,
    process_outputs: Optional[Callable] = None,
) -> Callable:
    textra = tracing_extra or {}

    @functools.wraps(original_create)
    def create(*args, stream: bool = False, **kwargs):
        decorator = run_helpers.traceable(
            name=name,
            run_type="llm",
            reduce_fn=reduce_fn if stream else None,
            process_inputs=_strip_not_given,
            _invocation_params_fn=invocation_params_fn,
            process_outputs=process_outputs,
            **textra,
        )

        return decorator(original_create)(*args, stream=stream, **kwargs)

    @functools.wraps(original_create)
    async def acreate(*args, stream: bool = False, **kwargs):
        kwargs = _strip_not_given(kwargs)
        decorator = run_helpers.traceable(
            name=name,
            run_type="llm",
            reduce_fn=reduce_fn if stream else None,
            process_inputs=_strip_not_given,
            _invocation_params_fn=invocation_params_fn,
            process_outputs=process_outputs,
            **textra,
        )
        return await decorator(original_create)(*args, stream=stream, **kwargs)

    return acreate if run_helpers.is_async(original_create) else create


def _get_parse_wrapper(
    original_parse: Callable,
    name: str,
    tracing_extra: Optional[TracingExtra] = None,
    invocation_params_fn: Optional[Callable] = None,
) -> Callable:
    textra = tracing_extra or {}

    @functools.wraps(original_parse)
    def parse(*args, **kwargs):
        decorator = run_helpers.traceable(
            name=name,
            run_type="llm",
            reduce_fn=None,
            process_inputs=_strip_not_given,
            _invocation_params_fn=invocation_params_fn,
            process_outputs=_process_chat_completion,
            **textra,
        )
        return decorator(original_parse)(*args, **kwargs)

    @functools.wraps(original_parse)
    async def aparse(*args, **kwargs):
        kwargs = _strip_not_given(kwargs)
        decorator = run_helpers.traceable(
            name=name,
            run_type="llm",
            reduce_fn=None,
            process_inputs=_strip_not_given,
            _invocation_params_fn=invocation_params_fn,
            process_outputs=_process_chat_completion,
            **textra,
        )
        return await decorator(original_parse)(*args, **kwargs)

    return aparse if run_helpers.is_async(original_parse) else parse


class TracingExtra(TypedDict, total=False):
    metadata: Optional[Mapping[str, Any]]
    tags: Optional[List[str]]
    client: Optional[ls_client.Client]


def wrap_openai(
    client: C,
    *,
    tracing_extra: Optional[TracingExtra] = None,
    chat_name: str = "ChatOpenAI",
    completions_name: str = "OpenAI",
) -> C:
    """Patch the OpenAI client to make it traceable.

    Args:
        client (Union[OpenAI, AsyncOpenAI]): The client to patch.
        tracing_extra (Optional[TracingExtra], optional): Extra tracing information.
            Defaults to None.
        chat_name (str, optional): The run name for the chat completions endpoint.
            Defaults to "ChatOpenAI".
        completions_name (str, optional): The run name for the completions endpoint.
            Defaults to "OpenAI".

    Returns:
        Union[OpenAI, AsyncOpenAI]: The patched client.

    """
    client.chat.completions.create = _get_wrapper(  # type: ignore[method-assign]
        client.chat.completions.create,
        chat_name,
        _reduce_chat,
        tracing_extra=tracing_extra,
        invocation_params_fn=functools.partial(_infer_invocation_params, "chat"),
        process_outputs=_process_chat_completion,
    )
    client.completions.create = _get_wrapper(  # type: ignore[method-assign]
        client.completions.create,
        completions_name,
        _reduce_completions,
        tracing_extra=tracing_extra,
        invocation_params_fn=functools.partial(_infer_invocation_params, "llm"),
    )

    # Wrap beta.chat.completions.parse if it exists
    if (
        hasattr(client, "beta")
        and hasattr(client.beta, "chat")
        and hasattr(client.beta.chat, "completions")
        and hasattr(client.beta.chat.completions, "parse")
    ):
        client.beta.chat.completions.parse = _get_parse_wrapper(  # type: ignore[method-assign]
            client.beta.chat.completions.parse,  # type: ignore
            chat_name,
            tracing_extra=tracing_extra,
            invocation_params_fn=functools.partial(_infer_invocation_params, "chat"),
        )

    return client
