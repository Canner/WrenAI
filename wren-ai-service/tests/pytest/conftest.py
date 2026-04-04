import importlib
from pathlib import Path

import pytest
from haystack import Document

from src.config import settings
from src.providers.document_store.pgvector import _require_attr


def require_pgvector_runtime():
    uses_pgvector = any(
        entry.get("type") == "document_store" and entry.get("provider") == "pgvector"
        for entry in settings.components
    )
    if not uses_pgvector:
        return

    missing_reason = "pgvector optional dependencies are not installed in this environment"
    incompatible_reason = (
        "pgvector runtime is installed but incompatible with the current Haystack/PostgreSQL driver versions"
    )

    for module_name in (
        "psycopg",
    ):
        try:
            importlib.import_module(module_name)
        except ModuleNotFoundError:
            pytest.skip(missing_reason)
        except ImportError:
            pytest.skip(incompatible_reason)

    try:
        _require_attr(
            "haystack_integrations.document_stores.pgvector",
            "PgvectorDocumentStore",
        )
        _require_attr(
            "haystack_integrations.components.retrievers.pgvector",
            "PgvectorEmbeddingRetriever",
        )
    except RuntimeError as exc:
        message = str(exc)
        if "optional pgvector dependencies" in message:
            pytest.skip(missing_reason)
        pytest.skip(incompatible_reason)


class DeterministicDocumentEmbedder:
    def __init__(self, dimension: int = 3):
        self._dimension = max(int(dimension or 3), 3)

    async def run(self, documents: list[Document]):
        for index, document in enumerate(documents):
            content = (document.content or "").strip()
            checksum = sum(ord(ch) for ch in content) + index + 1
            embedding = [0.0] * self._dimension
            embedding[0] = float(len(content) or 1)
            embedding[1] = float((checksum % 997) + 1)
            embedding[2] = float(len(document.meta or {}))
            document.embedding = embedding

        return {
            "documents": documents,
            "meta": {
                "model": "deterministic-test-embedder",
                "dimension": self._dimension,
            },
        }


def install_test_document_embedder(
    pipe_components: dict,
    pipeline_names: tuple[str, ...],
):
    for pipeline_name in pipeline_names:
        component = pipe_components[pipeline_name]
        embedder_provider = component["embedder_provider"]
        if embedder_provider is None:
            continue

        document_store_provider = component["document_store_provider"]
        dimension = (
            getattr(document_store_provider, "_embedding_dimension", None)
            or 3
        )
        embedder_provider.get_document_embedder = (
            lambda _dimension=dimension: DeterministicDocumentEmbedder(_dimension)
        )


@pytest.fixture
def usecases() -> list[str]:
    usecases_dir = Path(__file__).resolve().parents[1] / "data" / "usecases"
    if not usecases_dir.exists():
        return []

    return sorted(
        path.name for path in usecases_dir.iterdir() if path.is_dir()
    )
