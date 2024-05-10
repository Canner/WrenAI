from abc import ABCMeta, abstractmethod


class LLMProvider(metaclass=ABCMeta):
    @abstractmethod
    def get_generator(self, *args, **kwargs):
        ...

    @abstractmethod
    def get_embedder(self, *args, **kwargs):
        ...

    @abstractmethod
    def create_embeddings(self, *args, **kwargs) -> list[float]:
        ...
