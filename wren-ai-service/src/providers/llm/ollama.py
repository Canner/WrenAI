import logging
import os
from typing import Any, Callable, Dict, List, Optional

import aiohttp
import orjson
from haystack import component
from haystack.dataclasses import StreamingChunk
from haystack_integrations.components.generators.ollama import OllamaGenerator

from src.core.provider import LLMProvider
from src.providers.loader import provider, pull_ollama_model
from src.utils import remove_trailing_slash

logger = logging.getLogger("wren-ai-service")

LLM_OLLAMA_URL = "http://localhost:11434"
GENERATION_MODEL = "gemma2:9b"
GENERATION_MODEL_KWARGS = {
    "temperature": 0,
}


@component
class AsyncGenerator(OllamaGenerator):
    def __init__(
        self,
        model: str = "orca-mini",
        url: str = "http://localhost:11434/api/generate",
        generation_kwargs: Optional[Dict[str, Any]] = None,
        system_prompt: Optional[str] = None,
        template: Optional[str] = None,
        raw: bool = False,
        timeout: int = 120,
        streaming_callback: Optional[Callable[[StreamingChunk], None]] = None,
    ):
        super(AsyncGenerator, self).__init__(
            model=model,
            url=url,
            generation_kwargs=generation_kwargs,
            system_prompt=system_prompt,
            template=template,
            raw=raw,
            timeout=timeout,
            streaming_callback=streaming_callback,
        )

    async def _handle_streaming_response(self, response) -> List[StreamingChunk]:
        """
        Handles Streaming response cases
        """
        chunks: List[StreamingChunk] = []
        for chunk in await response.iter_lines():
            chunk_delta: StreamingChunk = self._build_chunk(chunk)
            chunks.append(chunk_delta)
            if self.streaming_callback is not None:
                self.streaming_callback(chunk_delta)
        return chunks

    async def _convert_to_response(
        self, ollama_response: aiohttp.ClientResponse
    ) -> Dict[str, List[Any]]:
        """
        Converts a response from the Ollama API to the required Haystack format.
        """

        resp_dict = await ollama_response.json()

        replies = [resp_dict["response"]]
        meta = {key: value for key, value in resp_dict.items() if key != "response"}

        return {"replies": replies, "meta": [meta]}

    def _create_json_payload(
        self, prompt: str, stream: bool, generation_kwargs=None
    ) -> Dict[str, Any]:
        """
        Returns a dictionary of JSON arguments for a POST request to an Ollama service.
        """
        generation_kwargs = generation_kwargs or {}
        return {
            "prompt": prompt,
            "model": self.model,
            "stream": stream,
            "raw": self.raw,
            "format": "json",  # https://github.com/ollama/ollama/blob/main/docs/api.md#request-json-mode
            "template": self.template,
            "system": self.system_prompt,
            "options": generation_kwargs,
        }

    @component.output_types(replies=List[str], meta=List[Dict[str, Any]])
    async def run(
        self,
        prompt: str,
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        logger.debug(f"Running Ollama generator with prompt: {prompt}")

        generation_kwargs = {**self.generation_kwargs, **(generation_kwargs or {})}

        stream = self.streaming_callback is not None

        json_payload = self._create_json_payload(prompt, stream, generation_kwargs)

        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(self.timeout)
        ) as session:
            response = await session.post(
                self.url,
                json=json_payload,
            )

            if stream:
                chunks: List[StreamingChunk] = await self._handle_streaming_response(
                    response
                )
                return self._convert_to_streaming_response(chunks)

            return await self._convert_to_response(response)


@provider("ollama_llm")
class OllamaLLMProvider(LLMProvider):
    def __init__(
        self,
        url: str = os.getenv("LLM_OLLAMA_URL") or LLM_OLLAMA_URL,
        generation_model: str = os.getenv("GENERATION_MODEL") or GENERATION_MODEL,
        model_kwargs: Dict[str, Any] = (
            orjson.loads(os.getenv("GENERATION_MODEL_KWARGS"))
            if os.getenv("GENERATION_MODEL_KWARGS")
            else GENERATION_MODEL_KWARGS
        ),
        timeout: int = (
            int(os.getenv("LLM_TIMEOUT")) if os.getenv("LLM_TIMEOUT") else 120
        ),
    ):
        self._url = remove_trailing_slash(url)
        self._generation_model = generation_model
        self._model_kwargs = model_kwargs
        self._timeout = timeout

        pull_ollama_model(self._url, self._generation_model)

        logger.info(f"Using Ollama LLM: {self._generation_model}")
        logger.info(f"Using Ollama URL: {self._url}")

    def get_generator(
        self,
        system_prompt: Optional[str] = None,
    ):
        logger.info(
            f"Creating Ollama generator with model kwargs: {self._model_kwargs}"
        )
        return AsyncGenerator(
            model=self._generation_model,
            url=f"{self._url}/api/generate",
            generation_kwargs=self._model_kwargs,
            system_prompt=system_prompt,
            timeout=self._timeout,
        )
