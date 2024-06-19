import asyncio
from abc import ABCMeta, abstractmethod
from typing import Any, Dict

from hamilton.experimental.h_async import AsyncDriver
from haystack import Pipeline


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
