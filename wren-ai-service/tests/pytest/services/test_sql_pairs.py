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
async def test_preparation(
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
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
    )
    assert await store.count_documents() == 2


@pytest.mark.asyncio
async def test_with_empty_question(
    sql_pairs_service: SqlPairsService,
):
    id = str(uuid.uuid4())

    request = SqlPairsService.IndexRequest(
        id=id,
        sql_pairs=[SqlPair(sql="SELECT * FROM book", id="1", question="")],
        project_id="fake-id",
    )

    await sql_pairs_service.index(request)
    response = sql_pairs_service[id]

    assert response.status == "failed"
    assert response.error is not None
    assert response.error.code == "OTHERS"
    assert "error occurred during SQL pairs indexing" in response.error.message

    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
    )
    assert await store.count_documents() == 0


@pytest.mark.asyncio
async def test_with_empty_sql_pairs(
    sql_pairs_service: SqlPairsService,
):
    id = str(uuid.uuid4())

    request = SqlPairsService.IndexRequest(
        id=id,
        sql_pairs=[],
        project_id="fake-id",
    )

    await sql_pairs_service.index(request)
    response = sql_pairs_service[id]

    assert response.status == "finished"


@pytest.mark.asyncio
async def test_deletion(
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
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
    )
    assert await store.count_documents() == 0


@pytest.mark.asyncio
async def test_delete_single_sql_pair(
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
        sql_pair_ids=["1"],
        project_id="fake-id",
    )

    await sql_pairs_service.delete(delete_request)
    response = sql_pairs_service[id]
    assert response.status == "finished"

    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_indexing"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
    )
    assert await store.count_documents() == 1


@pytest.mark.asyncio
async def test_delete_cross_project_sql_pair(
    sql_pairs_service: SqlPairsService,
):
    async def index_sql_pairs(project_id: str):
        id = str(uuid.uuid4())
        sql_pairs = [
            SqlPair(sql="SELECT * FROM book", id="1", question="What is the book?"),
        ]
        index_request = SqlPairsService.IndexRequest(
            id=id,
            sql_pairs=sql_pairs,
            project_id=project_id,
        )
        await sql_pairs_service.index(index_request)
        response = sql_pairs_service[id]
        assert response.status == "finished"

    await index_sql_pairs("project-a")
    await index_sql_pairs("project-b")

    id = str(uuid.uuid4())
    delete_request = SqlPairsService.DeleteRequest(
        id=id,
        sql_pair_ids=["1"],
        project_id="project-a",
    )
    await sql_pairs_service.delete(delete_request)
    response = sql_pairs_service[id]
    assert response.status == "finished"

    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_indexing"
    ]["document_store_provider"]

    store = document_store_provider.get_store(dataset_name="sql_pairs")
    assert await store.count_documents() == 1
