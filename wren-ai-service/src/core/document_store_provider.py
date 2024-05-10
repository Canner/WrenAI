from abc import ABCMeta, abstractmethod


class DocumentStoreProvider(metaclass=ABCMeta):
    @abstractmethod
    def get_store(self, *args, **kwargs):
        ...

    @abstractmethod
    def get_retriever(self, *args, **kwargs):
        ...
