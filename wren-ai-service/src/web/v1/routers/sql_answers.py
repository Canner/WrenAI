import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)

router = APIRouter()

from src.web.v1.services.sql_answer import (
    SqlAnswerRequest,
    SqlAnswerResponse,
    SqlAnswerResultRequest,
    SqlAnswerResultResponse,
)

"""
Router for handling SQL answer requests and retrieving results.

This router provides endpoints for initiating an SQL answer operation
and retrieving its results. It uses background tasks to process the
SQL answer requests asynchronously.

Endpoints:
- POST /sql-answers: Initiate an SQL answer operation
- GET /sql-answers/{query_id}/result: Retrieve the result of an SQL answer operation

The router depends on the ServiceContainer and ServiceMetadata, which are
injected using FastAPI's dependency injection system.
"""


@router.post("/sql-answers")
async def sql_answer(
    sql_answer_request: SqlAnswerRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SqlAnswerResponse:
    query_id = str(uuid.uuid4())
    sql_answer_request.query_id = query_id
    service_container.sql_answer_service._sql_answer_results[
        query_id
    ] = SqlAnswerResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        service_container.sql_answer_service.sql_answer,
        sql_answer_request,
        service_metadata=asdict(service_metadata),
    )
    return SqlAnswerResponse(query_id=query_id)


@router.get("/sql-answers/{query_id}/result")
async def get_sql_answer_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SqlAnswerResultResponse:
    return service_container.sql_answer_service.get_sql_answer_result(
        SqlAnswerResultRequest(query_id=query_id)
    )

