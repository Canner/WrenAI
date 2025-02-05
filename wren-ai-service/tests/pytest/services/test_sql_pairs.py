import uuid

import pytest

from src.config import settings
from src.core.provider import DocumentStoreProvider
from src.globals import create_service_container
from src.providers import generate_components
from src.web.v1.services.sql_pairs import SqlPair, SqlPairsService


@pytest.fixture
def sql_pairs_service():
    pipe_components = generate_components(settings.components)
    service_container = create_service_container(pipe_components, settings)

    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_indexing"
    ]["document_store_provider"]
    document_store_provider.get_store(
        dataset_name="sql_pairs",
        recreate_index=True,
    )

    return service_container.sql_pairs_service


@pytest.mark.asyncio
async def test_sql_pairs_preparation(
    sql_pairs_service: SqlPairsService,
):
    id = str(uuid.uuid4())
    sql_pairs = [
        SqlPair(sql="SELECT * FROM book", id="1", question="What is the book?"),
        SqlPair(sql="SELECT * FROM author", id="2", question="What is the author?"),
    ]

    request = SqlPairsService.IndexRequest(
        id=id,
        sql_pairs=sql_pairs,
        project_id="fake-id",
    )
    await sql_pairs_service.index(request)

    response = sql_pairs_service[id]

    assert response.status == "finished"

    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components["sql_pairs_indexing"][
        "document_store_provider"
    ]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
    )
    assert await store.count_documents() == 2


@pytest.mark.asyncio
async def test_sql_pairs_deletion(
    sql_pairs_service: SqlPairsService,
):
    id = str(uuid.uuid4())
    sql_pairs = [
        SqlPair(sql="SELECT * FROM book", id="1", question="What is the book?"),
        SqlPair(sql="SELECT * FROM author", id="2", question="What is the author?"),
    ]

    index_request = SqlPairsService.IndexRequest(
        id=id,
        sql_pairs=sql_pairs,
        project_id="fake-id",
    )

    await sql_pairs_service.index(index_request)
    response = sql_pairs_service[id]

    assert response.status == "finished"

    id = str(uuid.uuid4())
    delete_request = SqlPairsService.DeleteRequest(
        id=id,
        sql_pair_ids=["1", "2"],
        project_id="fake-id",
    )

    await sql_pairs_service.delete(delete_request)
    response = sql_pairs_service[id]

    assert response.status == "finished"

    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components["sql_pairs_indexing"][
        "document_store_provider"
    ]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
    )
    assert await store.count_documents() == 0
