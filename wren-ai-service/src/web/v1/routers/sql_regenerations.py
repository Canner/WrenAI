import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_regeneration import (
    SQLRegenerationRequest,
    SQLRegenerationResponse,
    SQLRegenerationResultRequest,
    SQLRegenerationResultResponse,
)

router = APIRouter()
"""
Router for handling SQL regeneration requests and retrieving results.

This router provides endpoints for initiating an SQL regeneration operation
and retrieving its results. It uses background tasks to process the
SQL regeneration requests asynchronously.

Endpoints:
- POST /sql-regenerations: Initiate an SQL regeneration operation
- GET /sql-regenerations/{query_id}/result: Retrieve the result of an SQL regeneration operation

"""

@router.post("/sql-regenerations")
async def sql_regeneration(
    sql_regeneration_request: SQLRegenerationRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SQLRegenerationResponse:
    query_id = str(uuid.uuid4())
    sql_regeneration_request.query_id = query_id
    service_container.sql_regeneration_service._sql_regeneration_results[
        query_id
    ] = SQLRegenerationResultResponse(status="understanding")
    background_tasks.add_task(
        service_container.sql_regeneration_service.sql_regeneration,
        sql_regeneration_request,
        service_metadata=asdict(service_metadata),
    )
    return SQLRegenerationResponse(query_id=query_id)


@router.get("/sql-regenerations/{query_id}/result")
async def get_sql_regeneration_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SQLRegenerationResultResponse:
    return service_container.sql_regeneration_service.get_sql_regeneration_result(
        SQLRegenerationResultRequest(query_id=query_id)
    )