import logging
from typing import Any, Dict, List, Optional

import backoff
import openai
from haystack import component
from haystack.components.generators import OpenAIGenerator
from haystack.utils.auth import Secret

from src.utils import load_env_vars

load_env_vars()

logging.getLogger("backoff").addHandler(logging.StreamHandler())

_MODEL_NAME = "gpt-3.5-turbo"
_MAX_TOKENS = {
    "gpt-3.5-turbo": 4096,
}
_GENERATION_KWARGS = {
    "temperature": 0,
    "n": 1,
    "max_tokens": _MAX_TOKENS[_MODEL_NAME] if _MODEL_NAME in _MAX_TOKENS else 4096,
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


def init_generator(
    model_name: str = _MODEL_NAME,
    generation_kwargs: Optional[Dict[str, Any]] = _GENERATION_KWARGS,
    system_prompt: Optional[str] = None,
) -> Any:
    return CustomOpenAIGenerator(
        api_key=Secret.from_env_var("OPENAI_API_KEY"),
        model=model_name,
        generation_kwargs=generation_kwargs,
        system_prompt=system_prompt,
    )
