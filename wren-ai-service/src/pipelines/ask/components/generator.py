import logging
from typing import Any, Dict, List, Optional

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
    @backoff.on_exception(backoff.expo, openai.RateLimitError, max_time=60)
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


def init_generator(
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
