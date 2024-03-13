import os
from abc import ABCMeta, abstractmethod
from pathlib import Path
from typing import Any, Dict

from haystack import Pipeline


class BasicPipeline(metaclass=ABCMeta):
    def __init__(self, pipe: Pipeline):
        self._pipe = pipe

    @abstractmethod
    def run(self, *args, **kwargs) -> Dict[str, Any]:
        ...

    def draw(self, path: Path) -> None:
        dir_path, _ = os.path.split(path)
        os.makedirs(dir_path, exist_ok=True)
        self._pipe.draw(path)
