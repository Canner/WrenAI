from abc import ABCMeta, abstractmethod

from haystack.document_stores.types import DocumentStore


class LLMProvider(metaclass=ABCMeta):
    @abstractmethod
    def get_generator(self, *args, **kwargs):
        ...

    @property
    def alias(self):
        return self._alias

    @property
    def model(self):
        return self._model

    @property
    def model_kwargs(self):
        return self._model_kwargs

    @property
    def context_window_size(self):
        return self._context_window_size


class EmbedderProvider(metaclass=ABCMeta):
    @abstractmethod
    def get_text_embedder(self, *args, **kwargs):
        ...

    @abstractmethod
    def get_document_embedder(self, *args, **kwargs):
        ...

    @property
    def alias(self):
        return self._alias

    @property
    def model(self):
        return self._model

    @property
    def model_kwargs(self):
        return self._model_kwargs


class DocumentStoreProvider(metaclass=ABCMeta):
    @abstractmethod
    def get_store(self, *args, **kwargs) -> DocumentStore:
        ...

    @abstractmethod
    def get_retriever(self, *args, **kwargs):
        ...
