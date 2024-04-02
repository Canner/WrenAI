from typing import Any

from haystack_integrations.components.retrievers.qdrant import QdrantEmbeddingRetriever


def init_retriever(document_store: Any, top_k: int = 10):
    return QdrantEmbeddingRetriever(document_store=document_store, top_k=top_k)
