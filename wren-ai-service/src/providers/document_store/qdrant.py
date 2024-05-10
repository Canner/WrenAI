from typing import Optional

from haystack_integrations.components.retrievers.qdrant import QdrantEmbeddingRetriever
from haystack_integrations.document_stores.qdrant import QdrantDocumentStore

from src.core.document_store_provider import DocumentStoreProvider
from src.providers.llm.openai import EMBEDDING_MODEL_DIMENSION


class QdrantProvider(DocumentStoreProvider):
    def __init__(self, location: str):
        self._location = location

    def get_store(
        self,
        embedding_model_dim: int = EMBEDDING_MODEL_DIMENSION,
        dataset_name: Optional[str] = None,
        recreate_index: bool = False,
    ):
        return QdrantDocumentStore(
            location=self._location,
            embedding_dim=embedding_model_dim,
            index=dataset_name or "db_schema",
            recreate_index=recreate_index,
            # hnsw_config={"ef_construct": 200, "m": 32},  # https://qdrant.tech/documentation/concepts/indexing/#vector-index
        )

    def get_retriever(
        self,
        document_store: QdrantDocumentStore,
        top_k: int = 10,
    ):
        return QdrantEmbeddingRetriever(
            document_store=document_store,
            top_k=top_k,
        )
