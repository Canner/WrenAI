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

    def save(self, with_trace: bool = False, suffix: str = None) -> Path:
        if suffix:
            if with_trace:
                file_path = Path(
                    f"./outputs/{self.__class__.__name__.lower()}_pipeline_with_trace_{suffix}.yaml"
                )
            else:
                file_path = Path(
                    f"./outputs/{self.__class__.__name__.lower()}_pipeline_{suffix}.yaml"
                )
        else:
            if with_trace:
                file_path = Path(
                    f"./outputs/{self.__class__.__name__.lower()}_pipeline_with_trace.yaml"
                )
            else:
                file_path = Path(
                    f"./outputs/{self.__class__.__name__.lower()}_pipeline.yaml"
                )

        with open(file_path, "w") as file:
            self._pipe.dump(file)

        return file_path

    @classmethod
    def load(cls, path: Path) -> Pipeline:
        with open(path, "r") as file:
            pipe = Pipeline.load(file)
        return cls.prepare(pipe)

    def draw(self, path: Path) -> None:
        dir_path, _ = os.path.split(path)
        os.makedirs(dir_path, exist_ok=True)
        self._pipe.draw(path)
