from abc import ABCMeta, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Dict, Optional

from hamilton.async_driver import AsyncDriver
from hamilton.driver import Driver
from haystack import Pipeline

from src.core.engine import Engine
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider


class BasicPipeline(metaclass=ABCMeta):
    def __init__(self, pipe: Pipeline | AsyncDriver | Driver):
        self._pipe = pipe
        self._description = ""
        self._llm_provider = None
        self._embedder_provider = None
        self._document_store_provider = None
        self._components = {}

    @abstractmethod
    def run(self, *args, **kwargs) -> Dict[str, Any]:
        ...

    def _update_components(self) -> dict:
        ...

    def update_components(
        self,
        llm_provider: Optional[LLMProvider] = None,
        embedder_provider: Optional[EmbedderProvider] = None,
        document_store_provider: Optional[DocumentStoreProvider] = None,
    ):
        self._llm_provider = llm_provider
        self._embedder_provider = embedder_provider
        self._document_store_provider = document_store_provider
        self._components = self._update_components()

    def __str__(self):
        return f"BasicPipeline(llm_provider={self._llm_provider}, embedder_provider={self._embedder_provider})"


@dataclass
class PipelineComponent(Mapping):
    description: str = None
    llm_provider: LLMProvider = None
    embedder_provider: EmbedderProvider = None
    document_store_provider: DocumentStoreProvider = None
    engine: Engine = None

    def __getitem__(self, key):
        return getattr(self, key)

    def __iter__(self):
        return iter(self.__dict__)

    def __len__(self):
        return len(self.__dict__)

    def __str__(self):
        return f"PipelineComponent(description={self.description}, llm_provider={self.llm_provider}, embedder_provider={self.embedder_provider}, document_store_provider={self.document_store_provider}, engine={self.engine})"
