from __future__ import annotations

import asyncio
import typing as t
from abc import ABC, abstractmethod
from dataclasses import field
from typing import List

import numpy as np
from langchain_core.embeddings import Embeddings
from langchain_openai.embeddings import OpenAIEmbeddings
from pydantic.dataclasses import dataclass
from pydantic_core import CoreSchema, core_schema

from ragas.cache import CacheInterface, cacher
from ragas.run_config import RunConfig, add_async_retry, add_retry

if t.TYPE_CHECKING:
    from llama_index.core.base.embeddings.base import BaseEmbedding
    from pydantic import GetCoreSchemaHandler


DEFAULT_MODEL_NAME = "BAAI/bge-small-en-v1.5"


class BaseRagasEmbeddings(Embeddings, ABC):
    """
    Abstract base class for Ragas embeddings.

    This class extends the Embeddings class and provides methods for embedding
    text and managing run configurations.

    Attributes:
        run_config (RunConfig): Configuration for running the embedding operations.

    """

    run_config: RunConfig
    cache: t.Optional[CacheInterface] = None

    def __init__(self, cache: t.Optional[CacheInterface] = None):
        super().__init__()
        self.cache = cache
        if self.cache is not None:
            self.embed_query = cacher(cache_backend=self.cache)(self.embed_query)
            self.embed_documents = cacher(cache_backend=self.cache)(
                self.embed_documents
            )
            self.aembed_query = cacher(cache_backend=self.cache)(self.aembed_query)
            self.aembed_documents = cacher(cache_backend=self.cache)(
                self.aembed_documents
            )

    async def embed_text(self, text: str, is_async=True) -> List[float]:
        """
        Embed a single text string.
        """
        embs = await self.embed_texts([text], is_async=is_async)
        return embs[0]

    async def embed_texts(
        self, texts: List[str], is_async: bool = True
    ) -> t.List[t.List[float]]:
        """
        Embed multiple texts.
        """
        if is_async:
            aembed_documents_with_retry = add_async_retry(
                self.aembed_documents, self.run_config
            )
            return await aembed_documents_with_retry(texts)
        else:
            loop = asyncio.get_event_loop()
            embed_documents_with_retry = add_retry(
                self.embed_documents, self.run_config
            )
            return await loop.run_in_executor(None, embed_documents_with_retry, texts)

    @abstractmethod
    async def aembed_query(self, text: str) -> List[float]: ...

    @abstractmethod
    async def aembed_documents(self, texts: List[str]) -> t.List[t.List[float]]: ...

    def set_run_config(self, run_config: RunConfig):
        """
        Set the run configuration for the embedding operations.
        """
        self.run_config = run_config

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: t.Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        """
        Define how Pydantic generates a schema for BaseRagasEmbeddings.
        """
        return core_schema.no_info_after_validator_function(
            cls, core_schema.is_instance_schema(cls)  # The validator function
        )


class LangchainEmbeddingsWrapper(BaseRagasEmbeddings):
    """
    Wrapper for any embeddings from langchain.
    """

    def __init__(
        self,
        embeddings: Embeddings,
        run_config: t.Optional[RunConfig] = None,
        cache: t.Optional[CacheInterface] = None,
    ):
        super().__init__(cache=cache)
        self.embeddings = embeddings
        if run_config is None:
            run_config = RunConfig()
        self.set_run_config(run_config)

    def embed_query(self, text: str) -> List[float]:
        """
        Embed a single query text.
        """
        return self.embeddings.embed_query(text)

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        Embed multiple documents.
        """
        return self.embeddings.embed_documents(texts)

    async def aembed_query(self, text: str) -> List[float]:
        """
        Asynchronously embed a single query text.
        """
        return await self.embeddings.aembed_query(text)

    async def aembed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        Asynchronously embed multiple documents.
        """
        return await self.embeddings.aembed_documents(texts)

    def set_run_config(self, run_config: RunConfig):
        """
        Set the run configuration for the embedding operations.
        """
        self.run_config = run_config

        # run configurations specially for OpenAI
        if isinstance(self.embeddings, OpenAIEmbeddings):
            try:
                from openai import RateLimitError
            except ImportError:
                raise ImportError(
                    "openai.error.RateLimitError not found. Please install openai package as `pip install openai`"
                )
            self.embeddings.request_timeout = run_config.timeout
            self.run_config.exception_types = RateLimitError

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(embeddings={self.embeddings.__class__.__name__}(...))"


@dataclass
class HuggingfaceEmbeddings(BaseRagasEmbeddings):
    """
    Hugging Face embeddings class for generating embeddings using pre-trained models.

    This class provides functionality to load and use Hugging Face models for
    generating embeddings of text inputs.

    Parameters
    ----------
    model_name : str, optional
        Name of the pre-trained model to use, by default DEFAULT_MODEL_NAME.
    cache_folder : str, optional
        Path to store downloaded models. Can also be set by SENTENCE_TRANSFORMERS_HOME
        environment variable.
    model_kwargs : dict, optional
        Additional keyword arguments to pass to the model.
    encode_kwargs : dict, optional
        Additional keyword arguments to pass to the encoding method.

    Attributes
    ----------
    model : Union[SentenceTransformer, CrossEncoder]
        The loaded Hugging Face model.
    is_cross_encoder : bool
        Flag indicating whether the model is a cross-encoder.

    Methods
    -------
    embed_query(text)
        Embed a single query text.
    embed_documents(texts)
        Embed multiple documents.
    predict(texts)
        Make predictions using a cross-encoder model.

    Notes
    -----
    This class requires the `sentence_transformers` and `transformers` packages
    to be installed.

    Examples
    --------
    >>> embeddings = HuggingfaceEmbeddings(model_name="bert-base-uncased")
    >>> query_embedding = embeddings.embed_query("What is the capital of France?")
    >>> doc_embeddings = embeddings.embed_documents(["Paris is the capital of France.", "London is the capital of the UK."])
    """

    model_name: str = DEFAULT_MODEL_NAME
    cache_folder: t.Optional[str] = None
    model_kwargs: t.Dict[str, t.Any] = field(default_factory=dict)
    encode_kwargs: t.Dict[str, t.Any] = field(default_factory=dict)
    cache: t.Optional[CacheInterface] = None

    def __post_init__(self):
        """
        Initialize the model after the object is created.
        """
        super().__init__(cache=self.cache)
        try:
            import sentence_transformers
            from transformers import AutoConfig
            from transformers.models.auto.modeling_auto import (
                MODEL_FOR_SEQUENCE_CLASSIFICATION_MAPPING_NAMES,
            )
        except ImportError as exc:
            raise ImportError(
                "Could not import sentence_transformers python package. "
                "Please install it with `pip install sentence-transformers`."
            ) from exc
        config = AutoConfig.from_pretrained(self.model_name)
        self.is_cross_encoder = bool(
            np.intersect1d(
                list(MODEL_FOR_SEQUENCE_CLASSIFICATION_MAPPING_NAMES.values()),
                config.architectures,
            )
        )

        if self.is_cross_encoder:
            self.model = sentence_transformers.CrossEncoder(
                self.model_name, **self.model_kwargs
            )
        else:
            self.model = sentence_transformers.SentenceTransformer(
                self.model_name, cache_folder=self.cache_folder, **self.model_kwargs
            )

        # ensure outputs are tensors
        if "convert_to_tensor" not in self.encode_kwargs:
            self.encode_kwargs["convert_to_tensor"] = True

        if self.cache is not None:
            self.predict = cacher(cache_backend=self.cache)(self.predict)

    def embed_query(self, text: str) -> List[float]:
        """
        Embed a single query text.
        """
        return self.embed_documents([text])[0]

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        Embed multiple documents.
        """
        from sentence_transformers.SentenceTransformer import SentenceTransformer
        from torch import Tensor

        assert isinstance(
            self.model, SentenceTransformer
        ), "Model is not of the type Bi-encoder"
        embeddings = self.model.encode(
            texts, normalize_embeddings=True, **self.encode_kwargs
        )

        assert isinstance(embeddings, Tensor)
        return embeddings.tolist()

    def predict(self, texts: List[List[str]]) -> List[List[float]]:
        """
        Make predictions using a cross-encoder model.
        """
        from sentence_transformers.cross_encoder import CrossEncoder
        from torch import Tensor

        assert isinstance(
            self.model, CrossEncoder
        ), "Model is not of the type CrossEncoder"

        predictions = self.model.predict(texts, **self.encode_kwargs)

        assert isinstance(predictions, Tensor)
        return predictions.tolist()


class LlamaIndexEmbeddingsWrapper(BaseRagasEmbeddings):
    """
    Wrapper for any embeddings from llama-index.

    This class provides a wrapper for llama-index embeddings, allowing them to be used
    within the Ragas framework. It supports both synchronous and asynchronous embedding
    operations for queries and documents.

    Parameters
    ----------
    embeddings : BaseEmbedding
        The llama-index embedding model to be wrapped.
    run_config : RunConfig, optional
        Configuration for the run. If not provided, a default RunConfig will be used.

    Attributes
    ----------
    embeddings : BaseEmbedding
        The wrapped llama-index embedding model.

    Examples
    --------
    >>> from llama_index.embeddings import OpenAIEmbedding
    >>> from ragas.embeddings import LlamaIndexEmbeddingsWrapper
    >>> llama_embeddings = OpenAIEmbedding()
    >>> wrapped_embeddings = LlamaIndexEmbeddingsWrapper(llama_embeddings)
    >>> query_embedding = wrapped_embeddings.embed_query("What is the capital of France?")
    >>> document_embeddings = wrapped_embeddings.embed_documents(["Paris is the capital of France.", "London is the capital of the UK."])
    """

    def __init__(
        self,
        embeddings: BaseEmbedding,
        run_config: t.Optional[RunConfig] = None,
        cache: t.Optional[CacheInterface] = None,
    ):
        super().__init__(cache=cache)
        self.embeddings = embeddings
        if run_config is None:
            run_config = RunConfig()
        self.set_run_config(run_config)

    def embed_query(self, text: str) -> t.List[float]:
        return self.embeddings.get_query_embedding(text)

    def embed_documents(self, texts: t.List[str]) -> t.List[t.List[float]]:
        return self.embeddings.get_text_embedding_batch(texts)

    async def aembed_query(self, text: str) -> t.List[float]:
        return await self.embeddings.aget_query_embedding(text)

    async def aembed_documents(self, texts: t.List[str]) -> t.List[t.List[float]]:
        return await self.embeddings.aget_text_embedding_batch(texts)

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(embeddings={self.embeddings.__class__.__name__}(...))"


def embedding_factory(
    model: str = "text-embedding-ada-002", run_config: t.Optional[RunConfig] = None
) -> BaseRagasEmbeddings:
    """
    Create and return a BaseRagasEmbeddings instance. Used for default embeddings
    used in Ragas (OpenAI).

    This factory function creates an OpenAIEmbeddings instance and wraps it with
    LangchainEmbeddingsWrapper to provide a BaseRagasEmbeddings compatible object.

    Parameters
    ----------
    model : str, optional
        The name of the OpenAI embedding model to use, by default "text-embedding-ada-002".
    run_config : RunConfig, optional
        Configuration for the run, by default None.

    Returns
    -------
    BaseRagasEmbeddings
        An instance of BaseRagasEmbeddings configured with the specified parameters.
    """
    openai_embeddings = OpenAIEmbeddings(model=model)
    if run_config is not None:
        openai_embeddings.request_timeout = run_config.timeout
    else:
        run_config = RunConfig()
    return LangchainEmbeddingsWrapper(openai_embeddings, run_config=run_config)
