from typing import Optional

from haystack_integrations.document_stores.qdrant import QdrantDocumentStore

from src.utils import load_env_vars

from .embedder import EMBEDDING_MODEL_DIMENSION

env = load_env_vars()


def init_document_store(
    env: str = env,
    embedding_dim: int = EMBEDDING_MODEL_DIMENSION,
    dataset_name: Optional[str] = None,
):
    return QdrantDocumentStore(
        url="localhost" if env == "dev" else "qdrant",
        embedding_dim=embedding_dim,
        index=dataset_name or "Document",
    )
