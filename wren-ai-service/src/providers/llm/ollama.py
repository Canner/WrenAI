import logging
import os
import time
from typing import Any, Callable, Dict, List, Optional

import aiohttp
from haystack import Document, component
from haystack.dataclasses import StreamingChunk
from haystack_integrations.components.embedders.ollama import (
    OllamaDocumentEmbedder,
    OllamaTextEmbedder,
)
from haystack_integrations.components.generators.ollama import OllamaGenerator
from tqdm import tqdm

from src.core.provider import LLMProvider
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")

OLLAMA_URL = "http://localhost:11434"
GENERATION_MODEL_NAME = "llama3:70b"
GENERATION_MODEL_KWARGS = {
    "temperature": 0,
}
EMBEDDING_MODEL_NAME = "nomic-embed-text"
EMBEDDING_MODEL_DIMENSION = 768  # https://huggingface.co/nomic-ai/nomic-embed-text-v1.5


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


@component
class AsyncTextEmbedder(OllamaTextEmbedder):
    def __init__(
        self,
        model: str = "nomic-embed-text",
        url: str = "http://localhost:11434/api/embeddings",
        generation_kwargs: Optional[Dict[str, Any]] = None,
        timeout: int = 120,
    ):
        super(AsyncTextEmbedder, self).__init__(
            model=model,
            url=url,
            generation_kwargs=generation_kwargs,
            timeout=timeout,
        )

    @component.output_types(embedding=List[float], meta=Dict[str, Any])
    async def run(
        self,
        text: str,
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        logger.debug(f"Running Ollama text embedder with text: {text}")

        payload = self._create_json_payload(text, generation_kwargs)

        start = time.perf_counter()
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(self.timeout)
        ) as session:
            async with session.post(
                self.url,
                json=payload,
            ) as response:
                elapsed = time.perf_counter() - start
                result = await response.json()

        result["meta"] = {"model": self.model, "duration": elapsed}

        return result


@component
class AsyncDocumentEmbedder(OllamaDocumentEmbedder):
    def __init__(
        self,
        model: str = "nomic-embed-text",
        url: str = "http://localhost:11434/api/embeddings",
        generation_kwargs: Optional[Dict[str, Any]] = None,
        timeout: int = 120,
        prefix: str = "",
        suffix: str = "",
        progress_bar: bool = True,
        meta_fields_to_embed: Optional[List[str]] = None,
        embedding_separator: str = "\n",
    ):
        super(AsyncDocumentEmbedder, self).__init__(
            model=model,
            url=url,
            generation_kwargs=generation_kwargs,
            timeout=timeout,
            prefix=prefix,
            suffix=suffix,
            progress_bar=progress_bar,
            meta_fields_to_embed=meta_fields_to_embed,
            embedding_separator=embedding_separator,
        )

    async def _embed_batch(
        self,
        texts_to_embed: List[str],
        batch_size: int,
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        """
        Ollama Embedding only allows single uploads, not batching. Currently the batch size is set to 1.
        If this changes in the future, line 86 (the first line within the for loop), can contain:
            batch = texts_to_embed[i + i + batch_size]
        """

        all_embeddings = []
        meta: Dict[str, Any] = {"model": self.model}

        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(self.timeout)
        ) as session:
            for i in tqdm(
                range(0, len(texts_to_embed), batch_size),
                disable=not self.progress_bar,
                desc="Calculating embeddings",
            ):
                batch = texts_to_embed[i]  # Single batch only
                payload = self._create_json_payload(batch, generation_kwargs)

                async with session.post(
                    self.url,
                    json=payload,
                ) as response:
                    result = await response.json()
                    all_embeddings.append(result["embedding"])

        return all_embeddings, meta

    @component.output_types(embedding=List[float], meta=Dict[str, Any])
    async def run(
        self,
        documents: List[str],
        generation_kwargs: Optional[Dict[str, Any]] = None,
    ):
        logger.debug(f"Running Ollama document embedder with documents: {documents}")

        if (
            not isinstance(documents, list)
            or documents
            and not isinstance(documents[0], Document)
        ):
            msg = (
                "OllamaDocumentEmbedder expects a list of Documents as input."
                "In case you want to embed a list of strings, please use the OllamaTextEmbedder."
            )
            raise TypeError(msg)

        texts_to_embed = self._prepare_texts_to_embed(documents=documents)
        embeddings, meta = await self._embed_batch(
            texts_to_embed=texts_to_embed,
            batch_size=self.batch_size,
            generation_kwargs=generation_kwargs,
        )

        for doc, emb in zip(documents, embeddings):
            doc.embedding = emb

        return {"documents": documents, "meta": meta}


@provider("ollama")
class OllamaLLMProvider(LLMProvider):
    def __init__(
        self,
        url: str = os.getenv("OLLAMA_URL") or OLLAMA_URL,
        generation_model: str = os.getenv("GENERATION_MODEL") or GENERATION_MODEL_NAME,
        embedding_model: str = os.getenv("EMBEDDING_MODEL") or EMBEDDING_MODEL_NAME,
    ):
        logger.info(f"Using Ollama Generation Model: {generation_model}")
        self._url = url
        self._generation_model = generation_model
        self._embedding_model = embedding_model

    def get_generator(
        self,
        model_kwargs: Optional[Dict[str, Any]] = GENERATION_MODEL_KWARGS,
        system_prompt: Optional[str] = None,
    ):
        return AsyncGenerator(
            model=self._generation_model,
            url=f"{self._url}/api/generate",
            generation_kwargs=model_kwargs,
            system_prompt=system_prompt,
        )

    def get_text_embedder(
        self,
        model_kwargs: Optional[Dict[str, Any]] = None,
    ):
        return AsyncTextEmbedder(
            model=self._embedding_model,
            url=f"{self._url}/api/embeddings",
            generation_kwargs=model_kwargs,
        )

    def get_document_embedder(
        self,
        model_kwargs: Optional[Dict[str, Any]] = None,
    ):
        return AsyncDocumentEmbedder(
            model=self._embedding_model,
            url=f"{self._url}/api/embeddings",
            generation_kwargs=model_kwargs,
        )
