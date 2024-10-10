import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_explanation import (
    SQLExplanationRequest,
    SQLExplanationResponse,
    SQLExplanationResultRequest,
    SQLExplanationResultResponse,
)

router = APIRouter()

@router.post("/sql-explanations")
async def sql_explanation(
    sql_explanation_request: SQLExplanationRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SQLExplanationResponse:
    query_id = str(uuid.uuid4())
    sql_explanation_request.query_id = query_id
    service_container.sql_explanation_service._sql_explanation_results[
        query_id
    ] = SQLExplanationResultResponse(status="understanding")
    background_tasks.add_task(
        service_container.sql_explanation_service.sql_explanation,
        sql_explanation_request,
        service_metadata=asdict(service_metadata),
    )
    return SQLExplanationResponse(query_id=query_id)


@router.get("/sql-explanations/{query_id}/result")
async def get_sql_explanation_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SQLExplanationResultResponse:
    return service_container.sql_explanation_service.get_sql_explanation_result(
        SQLExplanationResultRequest(query_id=query_id)
    )

