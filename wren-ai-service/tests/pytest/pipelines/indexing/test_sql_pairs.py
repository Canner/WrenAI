import pytest

from src.config import settings
from src.core.provider import DocumentStoreProvider
from src.pipelines.indexing import SqlPairs
from src.providers import generate_components
from tests.pytest.conftest import (
    install_test_document_embedder,
    require_pgvector_runtime,
)


@pytest.mark.asyncio
async def test_sql_pairs_indexing_saving_to_document_store():
    require_pgvector_runtime()
    pipe_components = generate_components(settings.components)
    install_test_document_embedder(pipe_components, ("sql_pairs_indexing",))
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
        recreate_index=True,
    )

    sql_pairs = SqlPairs(
        **pipe_components["sql_pairs_indexing"], sql_pairs_path="tests/data/pairs.json"
    )
    await sql_pairs.run(
        mdl_str='{"models": [{"properties": {"boilerplate": "test"}}]}',
        runtime_scope_id="fake-id",
    )

    assert await store.count_documents() == 2
    documents = store.filter_documents()
    for document in documents:
        assert document.content, "content should not be empty"
        assert document.meta, "meta should not be empty"
        assert document.meta.get("sql_pair_id"), "sql_pair_id should be in meta"
        assert document.meta.get("sql"), "sql should be in meta"


@pytest.mark.asyncio
async def test_sql_pairs_indexing_saving_to_document_store_with_multiple_project_ids():
    require_pgvector_runtime()
    pipe_components = generate_components(settings.components)
    install_test_document_embedder(pipe_components, ("sql_pairs_indexing",))
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
        recreate_index=True,
    )

    sql_pairs = SqlPairs(
        **pipe_components["sql_pairs_indexing"], sql_pairs_path="tests/data/pairs.json"
    )
    await sql_pairs.run(
        mdl_str='{"models": [{"properties": {"boilerplate": "test"}}]}',
        runtime_scope_id="fake-id",
    )

    await sql_pairs.run(
        mdl_str='{"models": [{"properties": {"boilerplate": "test"}}]}',
        runtime_scope_id="fake-id-2",
    )

    assert await store.count_documents() == 4
    documents = store.filter_documents(
        filters={
            "operator": "AND",
            "conditions": [
                {"field": "project_id", "operator": "==", "value": "fake-id"},
            ],
        }
    )
    assert len(documents) == 2


@pytest.mark.asyncio
async def test_sql_pairs_deletion():
    require_pgvector_runtime()
    pipe_components = generate_components(settings.components)
    install_test_document_embedder(pipe_components, ("sql_pairs_indexing",))
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
        recreate_index=True,
    )

    pipe = SqlPairs(
        **pipe_components["sql_pairs_indexing"], sql_pairs_path="tests/data/pairs.json"
    )
    await pipe.run(
        mdl_str='{"models": [{"properties": {"boilerplate": "test"}}]}',
        runtime_scope_id="fake-id",
    )

    await pipe.clean(sql_pairs=[], runtime_scope_id="fake-id-2")
    assert await store.count_documents() == 2

    await pipe.clean(sql_pairs=[], runtime_scope_id="fake-id")
    assert await store.count_documents() == 2
