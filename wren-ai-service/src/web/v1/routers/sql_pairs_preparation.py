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
    DeleteSqlPairsRequest,
    DeleteSqlPairsResponse,
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
    id = str(uuid.uuid4())
    prepare_sql_pairs_request.query_id = id
    service_container.sql_pairs_preparation_service._prepare_sql_pairs_statuses[
        id
    ] = SqlPairsPreparationStatusResponse(
        status="indexing",
    )

    background_tasks.add_task(
        service_container.sql_pairs_preparation_service.prepare_sql_pairs,
        prepare_sql_pairs_request,
        service_metadata=asdict(service_metadata),
    )
    return SqlPairsPreparationResponse(sql_pairs_preparation_id=id)


@router.delete("/sql-pairs-preparations")
async def delete_sql_pairs(
    delete_sql_pairs_request: DeleteSqlPairsRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> DeleteSqlPairsResponse:
    id = str(uuid.uuid4())
    delete_sql_pairs_request.query_id = id
    service_container.sql_pairs_preparation_service._prepare_sql_pairs_statuses[
        id
    ] = SqlPairsPreparationStatusResponse(
        status="deleting",
    )

    background_tasks.add_task(
        service_container.sql_pairs_preparation_service.delete_sql_pairs,
        delete_sql_pairs_request,
        service_metadata=asdict(service_metadata),
    )
    return DeleteSqlPairsResponse(sql_pairs_preparation_id=id)


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
