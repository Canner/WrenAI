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
logger = logging.getLogger("wren-ai-service")

MODEL_NAME = "gpt-3.5-turbo"
MAX_TOKENS = {
    "gpt-3.5-turbo": 4096,
}
GENERATION_KWARGS = {
    "temperature": 0,
    "n": 1,
    "max_tokens": MAX_TOKENS[MODEL_NAME] if MODEL_NAME in MAX_TOKENS else 4096,
    "response_format": {"type": "json_object"},
}


@component
class CustomOpenAIGenerator(OpenAIGenerator):
    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    @backoff.on_exception(backoff.expo, openai.RateLimitError, max_time=60, max_tries=3)
    def run(self, prompt: str, generation_kwargs: Optional[Dict[str, Any]] = None):
        logger.debug(f"Running OpenAI generator with prompt: {prompt}")
        return super(CustomOpenAIGenerator, self).run(
            prompt=prompt, generation_kwargs=generation_kwargs
        )


def init_generator(
    model_name: str = MODEL_NAME,
    generation_kwargs: Optional[Dict[str, Any]] = GENERATION_KWARGS,
):
    return CustomOpenAIGenerator(
        api_key=Secret.from_env_var("OPENAI_API_KEY"),
        model=model_name,
        generation_kwargs=generation_kwargs,
    )
