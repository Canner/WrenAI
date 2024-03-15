import logging
from typing import Any, Dict, List, Optional

import anthropic
import backoff
import openai
from haystack import component
from haystack.components.generators import OpenAIGenerator
from haystack.utils.auth import Secret

from src.utils import load_env_vars

from ...trace import TraceGenerationInput, trace_generation

load_env_vars()
logging.getLogger("backoff").addHandler(logging.StreamHandler())

MODEL_NAME = "gpt-3.5-turbo"
MAX_TOKENS = {
    "gpt-3.5-turbo": 4096,
}
GENERATION_KWARGS = {
    "temperature": 0.75,
    "n": 3,
    "max_tokens": MAX_TOKENS[MODEL_NAME] if MODEL_NAME in MAX_TOKENS else 4096,
    "response_format": {"type": "json_object"},
}


@component
class CustomOpenAIGenerator(OpenAIGenerator):
    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    @backoff.on_exception(backoff.expo, openai.RateLimitError, max_time=60, max_tries=3)
    def run(self, prompt: str, generation_kwargs: Optional[Dict[str, Any]] = None):
        return super(CustomOpenAIGenerator, self).run(
            prompt=prompt, generation_kwargs=generation_kwargs
        )


@component
class TracedOpenAIGenerator(CustomOpenAIGenerator):
    def _run(self, *args, **kwargs):
        return super(TracedOpenAIGenerator, self).run(*args, **kwargs)

    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    def run(
        self,
        trace_generation_input: TraceGenerationInput,
        prompt: str,
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        return trace_generation(self._run)(
            trace_generation_input=trace_generation_input,
            prompt=prompt,
            generation_kwargs=generation_kwargs,
        )


@component
class AnthropicGenerator:
    def __init__(self, api_key: Secret, model: str = "claude-3-haiku-20240307"):
        self._model = model
        self._client = anthropic.Anthropic(
            api_key=api_key.resolve_value(),
        )

    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    @backoff.on_exception(
        backoff.expo, anthropic.RateLimitError, max_time=60, max_tries=3
    )
    def run(self, prompt: str):
        message = self._client.messages.create(
            model=self._model,
            max_tokens=4096,
            messages=[
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": "{"},
            ],
            temperature=0,
        )

        return {
            "replies": [
                content.text for content in message.content if content.type == "text"
            ],
            "meta": [
                {
                    "model": message.model,
                    "index": message.id,
                    "finish_reason": message.stop_reason,
                    "usage": {
                        "completion_tokens": message.usage.output_tokens,
                        "prompt_tokens": message.usage.input_tokens,
                        "total_tokens": message.usage.output_tokens
                        + message.usage.input_tokens,
                    },
                }
            ],
        }


def _init_openai_generator(
    with_trace: bool = False,
    model_name: str = MODEL_NAME,
    generation_kwargs: Optional[Dict[str, Any]] = GENERATION_KWARGS,
):
    if with_trace:
        return TracedOpenAIGenerator(
            api_key=Secret.from_env_var("OPENAI_API_KEY"),
            model=model_name,
            generation_kwargs=generation_kwargs,
        )

    return CustomOpenAIGenerator(
        api_key=Secret.from_env_var("OPENAI_API_KEY"),
        model=model_name,
        generation_kwargs=generation_kwargs,
    )


def _init_anthropic_generator():
    return AnthropicGenerator(
        api_key=Secret.from_env_var("ANTHROPIC_API_KEY"),
    )


def init_generator(
    provider: str = "openai",
    with_trace: bool = False,
    model_name: str = MODEL_NAME,
    generation_kwargs: Optional[Dict[str, Any]] = GENERATION_KWARGS,
):
    if provider == "anthropic":
        return _init_anthropic_generator()
    elif provider == "openai":
        return _init_openai_generator(
            with_trace=with_trace,
            model_name=model_name,
            generation_kwargs=generation_kwargs,
        )

    raise ValueError(f"Invalid provider: {provider}")
