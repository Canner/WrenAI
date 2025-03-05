import time
import uuid
from typing import Any, Callable, Dict, Optional

from httpx import URL

from posthog.client import Client as PostHogClient


def get_model_params(kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extracts model parameters from the kwargs dictionary.
    """
    model_params = {}
    for param in [
        "temperature",
        "max_tokens",  # Deprecated field
        "max_completion_tokens",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "n",
        "stop",
        "stream",
    ]:
        if param in kwargs and kwargs[param] is not None:
            model_params[param] = kwargs[param]
    return model_params


def format_response(response):
    """
    Format a regular (non-streaming) response.
    """
    output = {"choices": []}
    if response is None:
        return output
    for choice in response.choices:
        if choice.message.content:
            output["choices"].append(
                {
                    "content": choice.message.content,
                    "role": choice.message.role,
                }
            )
    return output


def call_llm_and_track_usage(
    posthog_distinct_id: Optional[str],
    ph_client: PostHogClient,
    posthog_trace_id: Optional[str],
    posthog_properties: Optional[Dict[str, Any]],
    base_url: URL,
    call_method: Callable[..., Any],
    **kwargs: Any,
) -> Any:
    """
    Common usage-tracking logic for both sync and async calls.
    call_method: the llm call method (e.g. openai.chat.completions.create)
    """
    start_time = time.time()
    response = None
    error = None
    http_status = 200
    usage: Dict[str, Any] = {}

    try:
        response = call_method(**kwargs)
    except Exception as exc:
        error = exc
        http_status = getattr(exc, "status_code", 0)  # default to 0 becuase its likely an SDK error
    finally:
        end_time = time.time()
        latency = end_time - start_time

        if posthog_trace_id is None:
            posthog_trace_id = uuid.uuid4()

        if response and hasattr(response, "usage"):
            usage = response.usage.model_dump()

        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)
        event_properties = {
            "$ai_provider": "openai",
            "$ai_model": kwargs.get("model"),
            "$ai_model_parameters": get_model_params(kwargs),
            "$ai_input": kwargs.get("messages"),
            "$ai_output": format_response(response),
            "$ai_http_status": http_status,
            "$ai_input_tokens": input_tokens,
            "$ai_output_tokens": output_tokens,
            "$ai_latency": latency,
            "$ai_trace_id": posthog_trace_id,
            "$ai_base_url": str(base_url),
            **(posthog_properties or {}),
        }

        if posthog_distinct_id is None:
            event_properties["$process_person_profile"] = False

        # send the event to posthog
        if hasattr(ph_client, "capture") and callable(ph_client.capture):
            ph_client.capture(
                distinct_id=posthog_distinct_id or posthog_trace_id,
                event="$ai_generation",
                properties=event_properties,
            )

    if error:
        raise error

    return response


async def call_llm_and_track_usage_async(
    posthog_distinct_id: Optional[str],
    ph_client: PostHogClient,
    posthog_trace_id: Optional[str],
    posthog_properties: Optional[Dict[str, Any]],
    base_url: URL,
    call_async_method: Callable[..., Any],
    **kwargs: Any,
) -> Any:
    start_time = time.time()
    response = None
    error = None
    http_status = 200
    usage: Dict[str, Any] = {}

    try:
        response = await call_async_method(**kwargs)
    except Exception as exc:
        error = exc
        http_status = getattr(exc, "status_code", 0)  # default to 0 because its likely an SDK error
    finally:
        end_time = time.time()
        latency = end_time - start_time

        if posthog_trace_id is None:
            posthog_trace_id = uuid.uuid4()

        if response and hasattr(response, "usage"):
            usage = response.usage.model_dump()

        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)
        event_properties = {
            "$ai_provider": "openai",
            "$ai_model": kwargs.get("model"),
            "$ai_model_parameters": get_model_params(kwargs),
            "$ai_input": kwargs.get("messages"),
            "$ai_output": format_response(response),
            "$ai_http_status": http_status,
            "$ai_input_tokens": input_tokens,
            "$ai_output_tokens": output_tokens,
            "$ai_latency": latency,
            "$ai_trace_id": posthog_trace_id,
            "$ai_base_url": str(base_url),
            **(posthog_properties or {}),
        }

        if posthog_distinct_id is None:
            event_properties["$process_person_profile"] = False

        # send the event to posthog
        if hasattr(ph_client, "capture") and callable(ph_client.capture):
            ph_client.capture(
                distinct_id=posthog_distinct_id or posthog_trace_id,
                event="$ai_generation",
                properties=event_properties,
            )

    if error:
        raise error

    return response
