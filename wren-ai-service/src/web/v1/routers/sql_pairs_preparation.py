import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_pairs_preparation import (
    SqlPairsPreparationRequest,
    SqlPairsPreparationResponse,
    SqlPairsPreparationStatusRequest,
    SqlPairsPreparationStatusResponse,
)

router = APIRouter()


"""
Sql Pairs Preparation Router

This router manages the endpoints related to users uploading SQL pairs and retrieving their status.
"""


@router.post("/sql-pairs-preparations")
async def prepare_sql_pairs(
    prepare_sql_pairs_request: SqlPairsPreparationRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SqlPairsPreparationResponse:
    sql_pairs_preparation_id = str(uuid.uuid4())
    prepare_sql_pairs_request.query_id = sql_pairs_preparation_id
    service_container.sql_pairs_preparation_service._prepare_sql_pairs_statuses[
        sql_pairs_preparation_id
    ] = SqlPairsPreparationStatusResponse(
        status="indexing",
    )

    background_tasks.add_task(
        service_container.sql_pairs_preparation_service.prepare_sql_pairs,
        prepare_sql_pairs_request,
        service_metadata=asdict(service_metadata),
    )
    return SqlPairsPreparationResponse(
        sql_pairs_preparation_id=sql_pairs_preparation_id
    )


@router.get("/sql-pairs-preparations/{sql_pairs_preparation_id}/status")
async def get_sql_pairs_preparation_status(
    sql_pairs_preparation_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SqlPairsPreparationStatusResponse:
    return service_container.sql_pairs_preparation_service.get_prepare_sql_pairs_status(
        SqlPairsPreparationStatusRequest(
            sql_pairs_preparation_id=sql_pairs_preparation_id
        )
    )
