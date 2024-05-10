from abc import ABCMeta, abstractmethod


class LLMProvider(metaclass=ABCMeta):
    @abstractmethod
    def get_generator(self, *args, **kwargs):
        ...

    @abstractmethod
    def get_embedder(self, *args, **kwargs):
        ...
