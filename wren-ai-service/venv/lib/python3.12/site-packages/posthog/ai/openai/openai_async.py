import time
import uuid
from typing import Any, Dict, Optional

try:
    import openai
    import openai.resources
except ImportError:
    raise ModuleNotFoundError("Please install the OpenAI SDK to use this feature: 'pip install openai'")

from posthog.ai.utils import call_llm_and_track_usage_async, get_model_params
from posthog.client import Client as PostHogClient


class AsyncOpenAI(openai.AsyncOpenAI):
    """
    An async wrapper around the OpenAI SDK that automatically sends LLM usage events to PostHog.
    """

    _ph_client: PostHogClient

    def __init__(self, posthog_client: PostHogClient, **kwargs):
        """
        Args:
            api_key: OpenAI API key.
            posthog_client: If provided, events will be captured via this client instance.
            **openai_config: Additional keyword args (e.g. organization="xxx").
        """
        super().__init__(**kwargs)
        self._ph_client = posthog_client
        self.chat = WrappedChat(self)
        self.embeddings = WrappedEmbeddings(self)


class WrappedChat(openai.resources.chat.AsyncChat):
    _client: AsyncOpenAI

    @property
    def completions(self):
        return WrappedCompletions(self._client)


class WrappedCompletions(openai.resources.chat.completions.AsyncCompletions):
    _client: AsyncOpenAI

    async def create(
        self,
        posthog_distinct_id: Optional[str] = None,
        posthog_trace_id: Optional[str] = None,
        posthog_properties: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ):
        if posthog_trace_id is None:
            posthog_trace_id = uuid.uuid4()

        # If streaming, handle streaming specifically
        if kwargs.get("stream", False):
            return await self._create_streaming(
                posthog_distinct_id,
                posthog_trace_id,
                posthog_properties,
                **kwargs,
            )

        response = await call_llm_and_track_usage_async(
            posthog_distinct_id,
            self._client._ph_client,
            posthog_trace_id,
            posthog_properties,
            self._client.base_url,
            super().create,
            **kwargs,
        )
        return response

    async def _create_streaming(
        self,
        posthog_distinct_id: Optional[str],
        posthog_trace_id: Optional[str],
        posthog_properties: Optional[Dict[str, Any]],
        **kwargs: Any,
    ):
        start_time = time.time()
        usage_stats: Dict[str, int] = {}
        accumulated_content = []
        if "stream_options" not in kwargs:
            kwargs["stream_options"] = {}
        kwargs["stream_options"]["include_usage"] = True
        response = await super().create(**kwargs)

        async def async_generator():
            nonlocal usage_stats, accumulated_content
            try:
                async for chunk in response:
                    if hasattr(chunk, "usage") and chunk.usage:
                        usage_stats = {
                            k: getattr(chunk.usage, k, 0)
                            for k in [
                                "prompt_tokens",
                                "completion_tokens",
                                "total_tokens",
                            ]
                        }
                    if hasattr(chunk, "choices") and chunk.choices and len(chunk.choices) > 0:
                        content = chunk.choices[0].delta.content
                        if content:
                            accumulated_content.append(content)

                    yield chunk

            finally:
                end_time = time.time()
                latency = end_time - start_time
                output = "".join(accumulated_content)
                self._capture_streaming_event(
                    posthog_distinct_id,
                    posthog_trace_id,
                    posthog_properties,
                    kwargs,
                    usage_stats,
                    latency,
                    output,
                )

        return async_generator()

    def _capture_streaming_event(
        self,
        posthog_distinct_id: Optional[str],
        posthog_trace_id: Optional[str],
        posthog_properties: Optional[Dict[str, Any]],
        kwargs: Dict[str, Any],
        usage_stats: Dict[str, int],
        latency: float,
        output: str,
    ):
        if posthog_trace_id is None:
            posthog_trace_id = uuid.uuid4()

        event_properties = {
            "$ai_provider": "openai",
            "$ai_model": kwargs.get("model"),
            "$ai_model_parameters": get_model_params(kwargs),
            "$ai_input": kwargs.get("messages"),
            "$ai_output": {
                "choices": [
                    {
                        "content": output,
                        "role": "assistant",
                    }
                ]
            },
            "$ai_http_status": 200,
            "$ai_input_tokens": usage_stats.get("prompt_tokens", 0),
            "$ai_output_tokens": usage_stats.get("completion_tokens", 0),
            "$ai_latency": latency,
            "$ai_trace_id": posthog_trace_id,
            "$ai_base_url": str(self._client.base_url),
            **posthog_properties,
        }

        if posthog_distinct_id is None:
            event_properties["$process_person_profile"] = False

        if hasattr(self._client._ph_client, "capture"):
            self._client._ph_client.capture(
                distinct_id=posthog_distinct_id or posthog_trace_id,
                event="$ai_generation",
                properties=event_properties,
            )


class WrappedEmbeddings(openai.resources.embeddings.AsyncEmbeddings):
    _client: AsyncOpenAI

    async def create(
        self,
        posthog_distinct_id: Optional[str] = None,
        posthog_trace_id: Optional[str] = None,
        posthog_properties: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ):
        """
        Create an embedding using OpenAI's 'embeddings.create' method, but also track usage in PostHog.

        Args:
            posthog_distinct_id: Optional ID to associate with the usage event.
            posthog_trace_id: Optional trace UUID for linking events.
            posthog_properties: Optional dictionary of extra properties to include in the event.
            **kwargs: Any additional parameters for the OpenAI Embeddings API.

        Returns:
            The response from OpenAI's embeddings.create call.
        """
        if posthog_trace_id is None:
            posthog_trace_id = uuid.uuid4()

        start_time = time.time()
        response = await super().create(**kwargs)
        end_time = time.time()

        # Extract usage statistics if available
        usage_stats = {}
        if hasattr(response, "usage") and response.usage:
            usage_stats = {
                "prompt_tokens": getattr(response.usage, "prompt_tokens", 0),
                "total_tokens": getattr(response.usage, "total_tokens", 0),
            }

        latency = end_time - start_time

        # Build the event properties
        event_properties = {
            "$ai_provider": "openai",
            "$ai_model": kwargs.get("model"),
            "$ai_input": kwargs.get("input"),
            "$ai_http_status": 200,
            "$ai_input_tokens": usage_stats.get("prompt_tokens", 0),
            "$ai_latency": latency,
            "$ai_trace_id": posthog_trace_id,
            "$ai_base_url": str(self._client.base_url),
            **posthog_properties,
        }

        if posthog_distinct_id is None:
            event_properties["$process_person_profile"] = False

        # Send capture event for embeddings
        if hasattr(self._client._ph_client, "capture"):
            self._client._ph_client.capture(
                distinct_id=posthog_distinct_id or posthog_trace_id,
                event="$ai_embedding",
                properties=event_properties,
            )

        return response
