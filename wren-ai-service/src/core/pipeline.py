import asyncio
from abc import ABCMeta, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Dict

from hamilton.async_driver import AsyncDriver
from hamilton.driver import Driver
from haystack import Pipeline

from src.core.engine import Engine
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider


class BasicPipeline(metaclass=ABCMeta):
    def __init__(self, pipe: Pipeline | AsyncDriver | Driver):
        self._pipe = pipe

    @abstractmethod
    def run(self, *args, **kwargs) -> Dict[str, Any]:
        ...


def async_validate(task: callable):
    result = asyncio.run(task())
    print(result)
    return result


@dataclass
class PipelineComponent(Mapping):
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
