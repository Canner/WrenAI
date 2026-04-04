import importlib
from types import SimpleNamespace

import pytest

from src.providers.document_store.pgvector import (
    PgvectorProvider,
    PgvectorStoreAdapter,
    _filter_supported_store_kwargs,
    _normalize_pgvector_filters,
    _table_scoped_index_name,
    _ensure_haystack_filter_convert_compatibility,
)


class FakePgvectorDocumentStore:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class FakePgvectorEmbeddingRetriever:
    def __init__(self, document_store, top_k: int):
        self.document_store = document_store
        self.top_k = top_k


class SignatureLimitedPgvectorDocumentStore:
    def __init__(
        self,
        *,
        connection_string,
        table_name,
        language,
        embedding_dimension,
        vector_function,
        recreate_table,
        search_strategy,
        hnsw_recreate_index_if_exists=False,
        hnsw_index_name="haystack_hnsw_index",
        hnsw_ef_search=None,
        keyword_index_name="haystack_keyword_index",
    ):
        self.kwargs = {
            "connection_string": connection_string,
            "table_name": table_name,
            "language": language,
            "embedding_dimension": embedding_dimension,
            "vector_function": vector_function,
            "recreate_table": recreate_table,
            "search_strategy": search_strategy,
            "hnsw_recreate_index_if_exists": hnsw_recreate_index_if_exists,
            "hnsw_index_name": hnsw_index_name,
            "hnsw_ef_search": hnsw_ef_search,
            "keyword_index_name": keyword_index_name,
        }


class FakeDocument:
    def __init__(self, doc_id: str):
        self.id = doc_id


class FakeRuntimePgvectorStore:
    def __init__(self):
        self.last_filter_documents_filters = None
        self.last_embedding_filters = None
        self.deleted_ids = None
        self.write_calls = []

    def write_documents(self, documents, policy):
        self.write_calls.append((documents, policy))
        return len(documents)

    def filter_documents(self, filters=None):
        self.last_filter_documents_filters = filters
        return [FakeDocument("doc-1"), FakeDocument("doc-2")]

    def delete_documents(self, document_ids):
        self.deleted_ids = document_ids

    def count_documents(self):
        return 7

    def _embedding_retrieval(
        self, query_embedding, *, filters=None, top_k=10, vector_function=None
    ):
        self.last_embedding_filters = filters
        return [FakeDocument("doc-1")]


def test_pgvector_provider_loads_optional_modules_lazily(monkeypatch):
    provider = PgvectorProvider(
        connection_string="postgresql://postgres:postgres@localhost:5432/postgres",
        embedding_dimension=1536,
        search_strategy="hnsw",
        hnsw_ef_search=32,
    )
    real_import_module = importlib.import_module

    def fake_import_module(name: str, package: str | None = None):
        if name == "haystack_integrations.document_stores.pgvector":
            return SimpleNamespace(PgvectorDocumentStore=FakePgvectorDocumentStore)
        if name == "haystack_integrations.components.retrievers.pgvector":
            return SimpleNamespace(
                PgvectorEmbeddingRetriever=FakePgvectorEmbeddingRetriever
            )
        return real_import_module(name, package)

    monkeypatch.setattr(
        "src.providers.document_store.pgvector.importlib.import_module",
        fake_import_module,
    )

    store = provider.get_store(dataset_name="sql_pairs", recreate_table=True)
    retriever = provider.get_retriever(store, top_k=3)

    assert store.kwargs["connection_string"].resolve_value().startswith("postgresql://")
    assert store.kwargs["table_name"] == "sql_pairs"
    assert store.kwargs["recreate_table"] is True
    assert store.kwargs["search_strategy"] == "hnsw"
    assert store.kwargs["hnsw_ef_search"] == 32
    assert store.kwargs["keyword_index_name"] == "sql_pairs_haystack_keyword_index"
    assert store.kwargs["hnsw_index_name"] == "sql_pairs_haystack_hnsw_index"
    assert retriever.document_store is store._store
    assert retriever.top_k == 3


def test_pgvector_provider_raises_clear_error_when_dependency_missing(monkeypatch):
    provider = PgvectorProvider(
        connection_string="postgresql://postgres:postgres@localhost:5432/postgres",
        embedding_dimension=1536,
    )
    real_import_module = importlib.import_module

    def fake_import_module(name: str, package: str | None = None):
        if name == "haystack_integrations.document_stores.pgvector":
            raise ModuleNotFoundError(name)
        return real_import_module(name, package)

    monkeypatch.setattr(
        "src.providers.document_store.pgvector.importlib.import_module",
        fake_import_module,
    )

    with pytest.raises(RuntimeError, match="pgvector-haystack"):
        provider.get_store()


def test_pgvector_provider_raises_clear_error_when_runtime_is_incompatible(
    monkeypatch,
):
    provider = PgvectorProvider(
        connection_string="postgresql://postgres:postgres@localhost:5432/postgres",
        embedding_dimension=1536,
    )
    real_import_module = importlib.import_module

    def fake_import_module(name: str, package: str | None = None):
        if name == "haystack_integrations.document_stores.pgvector":
            raise ImportError("cannot import name 'convert' from 'haystack.utils.filters'")
        return real_import_module(name, package)

    monkeypatch.setattr(
        "src.providers.document_store.pgvector.importlib.import_module",
        fake_import_module,
    )

    with pytest.raises(RuntimeError, match="incompatible pgvector runtime"):
        provider.get_store()


def test_pgvector_provider_shims_missing_haystack_filter_convert(monkeypatch):
    fake_filters_module = SimpleNamespace()

    def fake_import_module(name: str, package: str | None = None):
        if name == "haystack.utils.filters":
            return fake_filters_module
        return importlib.import_module(name, package)

    monkeypatch.setattr(
        "src.providers.document_store.pgvector.importlib.import_module",
        fake_import_module,
    )

    _ensure_haystack_filter_convert_compatibility()

    assert fake_filters_module.convert({"tenant_id": "acme"}) == {
        "field": "tenant_id",
        "operator": "==",
        "value": "acme",
    }
    assert fake_filters_module.convert(
        {"operator": "AND", "conditions": [{"field": "tenant_id", "operator": "==", "value": "acme"}]}
    ) == {
        "operator": "AND",
        "conditions": [{"field": "tenant_id", "operator": "==", "value": "acme"}],
    }


def test_pgvector_provider_filters_store_kwargs_for_newer_runtime():
    kwargs = _filter_supported_store_kwargs(
        SignatureLimitedPgvectorDocumentStore,
        {
            "connection_string": "postgresql://postgres:postgres@localhost:5432/postgres",
            "create_extension": True,
            "schema_name": "public",
            "table_name": "sql_pairs",
            "language": "english",
            "embedding_dimension": 1536,
            "vector_type": "vector",
            "vector_function": "cosine_similarity",
            "recreate_table": True,
            "search_strategy": "hnsw",
            "hnsw_index_name": "haystack_hnsw_index",
            "hnsw_ef_search": 32,
            "keyword_index_name": "haystack_keyword_index",
        },
    )

    assert "create_extension" not in kwargs
    assert "schema_name" not in kwargs
    assert "vector_type" not in kwargs
    assert kwargs["hnsw_recreate_index_if_exists"] is True


def test_pgvector_provider_scopes_index_names_by_table():
    assert _table_scoped_index_name("sql_pairs", "haystack_keyword_index") == (
        "sql_pairs_haystack_keyword_index"
    )
    assert _table_scoped_index_name("table-descriptions", "haystack_hnsw_index") == (
        "table_descriptions_haystack_hnsw_index"
    )


def test_pgvector_provider_normalizes_meta_filters():
    assert _normalize_pgvector_filters(
        {"field": "project_id", "operator": "==", "value": "scope-a"}
    ) == {
        "field": "meta.project_id",
        "operator": "==",
        "value": "scope-a",
    }
    assert _normalize_pgvector_filters(
        {
            "operator": "AND",
            "conditions": [
                {"field": "project_id", "operator": "==", "value": "scope-a"},
                {"field": "meta.kind", "operator": "==", "value": "sql_pair"},
            ],
        }
    ) == {
        "operator": "AND",
        "conditions": [
            {"field": "meta.project_id", "operator": "==", "value": "scope-a"},
            {"field": "meta.kind", "operator": "==", "value": "sql_pair"},
        ],
    }


@pytest.mark.asyncio
async def test_pgvector_store_adapter_rewrites_filters_for_runtime_scope():
    store = FakeRuntimePgvectorStore()
    adapter = PgvectorStoreAdapter(store)

    assert await adapter.count_documents(
        filters={"field": "project_id", "operator": "==", "value": "scope-a"}
    ) == 2
    await adapter.delete_documents(
        filters={"field": "project_id", "operator": "==", "value": "scope-a"}
    )
    adapter.filter_documents(
        filters={"field": "project_id", "operator": "==", "value": "scope-a"}
    )
    adapter._embedding_retrieval(
        [1.0, 0.0, 0.0],
        filters={"field": "project_id", "operator": "==", "value": "scope-a"},
    )

    expected = {"field": "meta.project_id", "operator": "==", "value": "scope-a"}
    assert store.last_filter_documents_filters == expected
    assert store.last_embedding_filters == expected
    assert store.deleted_ids == ["doc-1", "doc-2"]


@pytest.mark.asyncio
async def test_pgvector_store_adapter_short_circuits_empty_writes():
    store = FakeRuntimePgvectorStore()
    adapter = PgvectorStoreAdapter(store)

    assert await adapter.write_documents([], policy="overwrite") == 0
    assert store.write_calls == []


def test_pgvector_provider_supports_legacy_alias_fields(monkeypatch):
    provider = PgvectorProvider(
        connection_string="postgresql://postgres:postgres@localhost:5432/postgres",
        embedding_model_dim=1024,
    )
    real_import_module = importlib.import_module

    def fake_import_module(name: str, package: str | None = None):
        if name == "haystack_integrations.document_stores.pgvector":
            return SimpleNamespace(PgvectorDocumentStore=FakePgvectorDocumentStore)
        return real_import_module(name, package)

    monkeypatch.setattr(
        "src.providers.document_store.pgvector.importlib.import_module",
        fake_import_module,
    )

    store = provider.get_store(dataset_name="project_meta", recreate_index=True)

    assert store.kwargs["embedding_dimension"] == 1024
    assert store.kwargs["recreate_table"] is True
    assert store.kwargs["table_name"] == "project_meta"
