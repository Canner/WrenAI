import logging
import os
from typing import Any, Dict, List, Optional

import backoff
import openai
from haystack import component
from haystack_integrations.components.embedders.ollama import (
    OllamaDocumentEmbedder,
    OllamaTextEmbedder,
)
from haystack_integrations.components.generators.ollama import OllamaGenerator

from src.core.provider import LLMProvider
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")

OLLAMA_URL = "http://localhost:11434"
GENERATION_MODEL_NAME = "llama3:8b"
GENERATION_MODEL_KWARGS = {
    "temperature": 0,
}
EMBEDDING_MODEL_NAME = "nomic-embed-text"
EMBEDDING_MODEL_DIMENSION = 768


@component
class CustomOllamaGenerator(OllamaGenerator):
    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    @backoff.on_exception(backoff.expo, openai.RateLimitError, max_time=60, max_tries=3)
    def run(self, prompt: str, generation_kwargs: Optional[Dict[str, Any]] = None):
        logger.debug(f"Running OpenAI generator with prompt: {prompt}")
        return super(CustomOllamaGenerator, self).run(
            prompt=prompt, generation_kwargs=generation_kwargs
        )


@provider("ollama")
class OllamaLLMProvider(LLMProvider):
    def __init__(
        self,
        url: str = os.getenv("OLLAMA_URL") or OLLAMA_URL,
        generation_model: str = os.getenv("GENERATION_MODEL") or GENERATION_MODEL_NAME,
    ):
        logger.info(f"Using Ollama Generation Model: {generation_model}")
        self._url = url
        self._generation_model = generation_model

    def get_generator(
        self,
        model_kwargs: Optional[Dict[str, Any]] = GENERATION_MODEL_KWARGS,
        system_prompt: Optional[str] = None,
    ):
        return CustomOllamaGenerator(
            model=self._generation_model,
            url=f"{self._url}/api/generate",
            system_prompt=system_prompt,
            generation_kwargs=model_kwargs,
        )

    def get_text_embedder(
        self,
        model_name: str = EMBEDDING_MODEL_NAME,
    ):
        return OllamaTextEmbedder(
            model=model_name,
            url=f"{self._url}/api/embeddings",
        )

    def get_document_embedder(
        self,
        model_name: str = EMBEDDING_MODEL_NAME,
    ):
        return OllamaDocumentEmbedder(
            model=model_name,
            url=f"{self._url}/api/embeddings",
        )
