import uuid

import pytest

from src.config import settings
from src.core.provider import DocumentStoreProvider
from src.globals import create_service_container
from src.providers import generate_components
from src.web.v1.services.sql_pairs_preparation import (
    DeleteSqlPairsRequest,
    SqlPair,
    SqlPairsPreparationRequest,
    SqlPairsPreparationService,
    SqlPairsPreparationStatusRequest,
)


@pytest.fixture
def sql_pairs_preparation_service():
    pipe_components = generate_components(settings.components)
    service_container = create_service_container(pipe_components, settings)

    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_preparation"
    ]["document_store_provider"]
    document_store_provider.get_store(
        dataset_name="sql_pairs",
        recreate_index=True,
    )

    return service_container.sql_pairs_preparation_service


@pytest.fixture
def service_metadata():
    return {
        "pipes_metadata": {
            "mock": {
                "generation_model": "mock-llm-model",
                "generation_model_kwargs": {},
                "embedding_model": "mock-embedding-model",
                "embedding_model_dim": 768,
            },
        },
        "service_version": "0.8.0-mock",
    }


@pytest.mark.asyncio
@pytest.mark.skip(reason="due to pipeline change, this test is not applicable anymore")
async def test_sql_pairs_preparation(
    sql_pairs_preparation_service: SqlPairsPreparationService,
    service_metadata: dict,
):
    request = SqlPairsPreparationRequest(
        sql_pairs=[
            SqlPair(sql="SELECT * FROM book", id="1"),
            SqlPair(sql="SELECT * FROM author", id="2"),
        ],
        project_id="fake-id",
    )
    request.query_id = str(uuid.uuid4())
    await sql_pairs_preparation_service.prepare_sql_pairs(
        request,
        service_metadata=service_metadata,
    )

    sql_pairs_preparation_response = (
        sql_pairs_preparation_service.get_prepare_sql_pairs_status(
            SqlPairsPreparationStatusRequest(sql_pairs_preparation_id=request.query_id)
        )
    )
    while (
        sql_pairs_preparation_response.status != "finished"
        and sql_pairs_preparation_response.status != "failed"
    ):
        sql_pairs_preparation_response = (
            sql_pairs_preparation_service.get_prepare_sql_pairs_status(
                SqlPairsPreparationStatusRequest(
                    sql_pairs_preparation_id=request.query_id
                )
            )
        )

    assert sql_pairs_preparation_response.status == "finished"
    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_preparation"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
    )
    assert await store.count_documents() == 2


@pytest.mark.asyncio
@pytest.mark.skip(reason="due to pipeline change, this test is not applicable anymore")
async def test_sql_pairs_deletion(
    sql_pairs_preparation_service: SqlPairsPreparationService,
    service_metadata: dict,
):
    request = SqlPairsPreparationRequest(
        sql_pairs=[
            SqlPair(sql="SELECT * FROM book", id="1"),
            SqlPair(sql="SELECT * FROM author", id="2"),
        ],
        project_id="fake-id",
    )
    request.query_id = str(uuid.uuid4())
    await sql_pairs_preparation_service.prepare_sql_pairs(
        request,
        service_metadata=service_metadata,
    )

    sql_pairs_preparation_response = (
        sql_pairs_preparation_service.get_prepare_sql_pairs_status(
            SqlPairsPreparationStatusRequest(sql_pairs_preparation_id=request.query_id)
        )
    )
    while (
        sql_pairs_preparation_response.status != "finished"
        and sql_pairs_preparation_response.status != "failed"
    ):
        sql_pairs_preparation_response = (
            sql_pairs_preparation_service.get_prepare_sql_pairs_status(
                SqlPairsPreparationStatusRequest(
                    sql_pairs_preparation_id=request.query_id
                )
            )
        )

    assert sql_pairs_preparation_response.status == "finished"

    deletion_request = DeleteSqlPairsRequest(
        ids=["1", "2"],
        project_id="fake-id",
    )
    deletion_request.query_id = request.query_id
    await sql_pairs_preparation_service.delete_sql_pairs(deletion_request)

    sql_pairs_preparation_response = (
        sql_pairs_preparation_service.get_prepare_sql_pairs_status(
            SqlPairsPreparationStatusRequest(sql_pairs_preparation_id=request.query_id)
        )
    )
    while (
        sql_pairs_preparation_response.status != "finished"
        and sql_pairs_preparation_response.status != "failed"
    ):
        sql_pairs_preparation_response = (
            sql_pairs_preparation_service.get_prepare_sql_pairs_status(
                SqlPairsPreparationStatusRequest(
                    sql_pairs_preparation_id=request.query_id
                )
            )
        )

    assert sql_pairs_preparation_response.status == "finished"
    pipe_components = generate_components(settings.components)
    document_store_provider: DocumentStoreProvider = pipe_components[
        "sql_pairs_preparation"
    ]["document_store_provider"]
    store = document_store_provider.get_store(
        dataset_name="sql_pairs",
    )
    assert await store.count_documents() == 0
