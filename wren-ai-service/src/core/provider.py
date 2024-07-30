from abc import ABCMeta, abstractmethod

from haystack.document_stores.types import DocumentStore


class LLMProvider(metaclass=ABCMeta):
    @abstractmethod
    def get_generator(self, *args, **kwargs):
        ...

    def get_model(self):
        return self._generation_model

    def get_model_kwargs(self):
        return self._model_kwargs


class EmbedderProvider(metaclass=ABCMeta):
    @abstractmethod
    def get_text_embedder(self, *args, **kwargs):
        ...

    @abstractmethod
    def get_document_embedder(self, *args, **kwargs):
        ...

    def get_model(self):
        return self._embedding_model

    def get_dimensions(self):
        return self._embedding_model_dim


class DocumentStoreProvider(metaclass=ABCMeta):
    @abstractmethod
    def get_store(self, *args, **kwargs) -> DocumentStore:
        ...

    @abstractmethod
    def get_retriever(self, *args, **kwargs):
        ...
