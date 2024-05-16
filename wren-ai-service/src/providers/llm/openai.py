import logging
import os
from typing import Any, Dict, List, Optional

import backoff
import openai
from haystack import component
from haystack.components.embedders import OpenAIDocumentEmbedder, OpenAITextEmbedder
from haystack.components.generators import OpenAIGenerator
from haystack.utils.auth import Secret
from openai import OpenAI

from src.core.provider import LLMProvider
from src.providers.loader import provider

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


@provider("openai")
class OpenAILLMProvider(LLMProvider):
    def __init__(
        self,
        api_key: Secret = Secret.from_env_var("OPENAI_API_KEY"),
        generation_model: str = os.getenv("OPENAI_GENERATION_MODEL")
        or GENERATION_MODEL_NAME,
    ):
        def _verify_env_vars() -> None:
            """
            this is a temporary solution to verify that the required environment variables are set
            """
            OpenAI().models.list()

        _verify_env_vars()
        logger.info(f"Using OpenAI Generation Model: {generation_model}")
        self._api_key = api_key
        self._generation_model = generation_model

    def get_generator(
        self,
        model_kwargs: Optional[Dict[str, Any]] = GENERATION_MODEL_KWARGS,
        system_prompt: Optional[str] = None,
    ):
        return CustomOpenAIGenerator(
            api_key=self._api_key,
            model=self._generation_model,
            system_prompt=system_prompt,
            generation_kwargs=model_kwargs,
        )

    def get_text_embedder(
        self,
        model_name: str = EMBEDDING_MODEL_NAME,
        model_dim: int = EMBEDDING_MODEL_DIMENSION,
    ):
        return OpenAITextEmbedder(
            api_key=self._api_key,
            model=model_name,
            dimensions=model_dim,
        )

    def get_document_embedder(
        self,
        model_name: str = EMBEDDING_MODEL_NAME,
        model_dim: int = EMBEDDING_MODEL_DIMENSION,
    ):
        return OpenAIDocumentEmbedder(
            api_key=self._api_key,
            model=model_name,
            dimensions=model_dim,
        )
