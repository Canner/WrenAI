import logging
from typing import Any, Dict, List, Optional

import backoff
import openai
from haystack import component
from haystack.components.embedders import OpenAITextEmbedder
from haystack.components.generators import OpenAIGenerator
from haystack.utils.auth import Secret

from src.core.llm_provider import LLMProvider

logger = logging.getLogger("wren-ai-service")

GENERATION_MODEL_NAME = "gpt-3.5-turbo"
GENERATION_MODEL_KWARGS = {
    "temperature": 0,
    "n": 1,
    "max_tokens": 4096,
    "response_format": {"type": "json_object"},
}
EMBEDDING_MODEL_NAME = "text-embedding-3-large"
EMBEDDING_MODEL_DIMENSION = 3072


@component
class CustomOpenAIGenerator(OpenAIGenerator):
    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    @backoff.on_exception(backoff.expo, openai.RateLimitError, max_time=60, max_tries=3)
    def run(self, prompt: str, generation_kwargs: Optional[Dict[str, Any]] = None):
        logger.debug(f"Running OpenAI generator with prompt: {prompt}")
        return super(CustomOpenAIGenerator, self).run(
            prompt=prompt, generation_kwargs=generation_kwargs
        )


class OpenAILLMProvider(LLMProvider):
    def __init__(self, api_key: Secret):
        self._api_key = api_key

    def get_generator(
        self,
        model_name: str = GENERATION_MODEL_NAME,
        model_kwargs: Optional[Dict[str, Any]] = GENERATION_MODEL_KWARGS,
        system_prompt: Optional[str] = None,
    ):
        return CustomOpenAIGenerator(
            api_key=self._api_key,
            model=model_name,
            system_prompt=system_prompt,
            generation_kwargs=model_kwargs,
        )

    def get_embedder(
        self,
        model_name: str = EMBEDDING_MODEL_NAME,
        model_dim: int = EMBEDDING_MODEL_DIMENSION,
    ):
        return OpenAITextEmbedder(
            api_key=self._api_key,
            model=model_name,
            dimensions=model_dim,
        )

    def create_embeddings(
        self,
        texts: List[str],
        model_name: str = EMBEDDING_MODEL_NAME,
        model_dim: int = EMBEDDING_MODEL_DIMENSION,
    ) -> List[float]:
        _openai_client = openai.Client(api_key=self._api_key.resolve_value())
        _embeddings = _openai_client.embeddings.create(
            input=texts,
            model=model_name,
            dimensions=model_dim,
        )

        return [data.embedding for data in _embeddings.data]
