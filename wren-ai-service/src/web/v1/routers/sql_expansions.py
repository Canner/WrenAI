import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_expansion import (
    SqlExpansionRequest,
    SqlExpansionResponse,
    SqlExpansionResultRequest,
    SqlExpansionResultResponse,
    StopSqlExpansionRequest,
    StopSqlExpansionResponse,
)

router = APIRouter()

"""
Router for handling SQL expansion requests and retrieving results.

This router provides endpoints for initiating an SQL expansion operation
and retrieving its results. It uses background tasks to process the
SQL expansion requests asynchronously.

Endpoints:
- POST /sql-expansions: Initiate an SQL expansion operation
- GET /sql-expansions/{query_id}/result: Retrieve the result of an SQL expansion operation

The router depends on the ServiceContainer and ServiceMetadata, which are
injected using FastAPI's dependency injection system.
"""

@router.post("/sql-expansions")
async def sql_expansion(
    sql_expansion_request: SqlExpansionRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SqlExpansionResponse:
    query_id = str(uuid.uuid4())
    sql_expansion_request.query_id = query_id
    service_container.sql_expansion_service._sql_expansion_results[
        query_id
    ] = SqlExpansionResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        service_container.sql_expansion_service.sql_expansion,
        sql_expansion_request,
        service_metadata=asdict(service_metadata),
    )
    return SqlExpansionResponse(query_id=query_id)


@router.patch("/sql-expansions/{query_id}")
async def stop_sql_expansion(
    query_id: str,
    stop_sql_expansion_request: StopSqlExpansionRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StopSqlExpansionResponse:
    stop_sql_expansion_request.query_id = query_id
    background_tasks.add_task(
        service_container.sql_expansion_service.stop_sql_expansion,
        stop_sql_expansion_request,
    )
    return StopSqlExpansionResponse(query_id=query_id)


@router.get("/sql-expansions/{query_id}/result")
async def get_sql_expansion_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SqlExpansionResultResponse:
    return service_container.sql_expansion_service.get_sql_expansion_result(
        SqlExpansionResultRequest(query_id=query_id)
    )