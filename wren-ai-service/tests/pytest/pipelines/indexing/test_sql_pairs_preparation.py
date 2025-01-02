import pytest

from src.config import settings
from src.core.provider import DocumentStoreProvider
from src.pipelines.indexing.sql_pairs_preparation import SqlPair, SqlPairsPreparation
from src.providers import generate_components


@pytest.mark.asyncio
async def test_sql_pairs_preparation_saving_to_document_store():
    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_preparation"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
        recreate_index=True,
    )

    sql_pairs_preparation = SqlPairsPreparation(
        **pipe_components["sql_pairs_preparation"]
    )
    await sql_pairs_preparation.run(
        sql_pairs=[
            SqlPair(sql="SELECT * FROM book", id="1"),
            SqlPair(sql="SELECT * FROM author", id="2"),
        ],
        project_id="fake-id",
    )

    assert await store.count_documents() == 2
    documents = store.filter_documents()
    for document in documents:
        assert document.content, "content should not be empty"
        assert document.meta, "meta should not be empty"
        assert document.meta.get("sql_pair_id"), "sql_pair_id should be in meta"
        assert document.meta.get("sql"), "sql should be in meta"


@pytest.mark.asyncio
async def test_sql_pairs_preparation_saving_to_document_store_with_multiple_project_ids():
    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_preparation"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
        recreate_index=True,
    )

    sql_pairs_preparation = SqlPairsPreparation(
        **pipe_components["sql_pairs_preparation"]
    )
    await sql_pairs_preparation.run(
        sql_pairs=[
            SqlPair(sql="SELECT * FROM book", id="1"),
            SqlPair(sql="SELECT * FROM author", id="2"),
        ],
        project_id="fake-id",
    )

    await sql_pairs_preparation.run(
        sql_pairs=[
            SqlPair(sql="SELECT * FROM book", id="1"),
            SqlPair(sql="SELECT * FROM author", id="2"),
        ],
        project_id="fake-id-2",
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
