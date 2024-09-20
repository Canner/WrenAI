import asyncio
from abc import ABCMeta, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict

from hamilton.experimental.h_async import AsyncDriver
from haystack import Pipeline

from src.core.engine import Engine
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider


class BasicPipeline(metaclass=ABCMeta):
    def __init__(self, pipe: Pipeline | AsyncDriver):
        self._pipe = pipe

    @abstractmethod
    def run(self, *args, **kwargs) -> Dict[str, Any]:
        ...


def async_validate(task: callable):
    result = asyncio.run(task())
    print(result)
    return result


@dataclass
class PipelineComponent:
    llm_provider: LLMProvider = None
    embedder_provider: EmbedderProvider = None
    document_store_provider: DocumentStoreProvider = None
    engine: Engine = None
