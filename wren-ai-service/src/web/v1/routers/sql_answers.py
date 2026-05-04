import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_answer import (
    SqlAnswerRequest,
    SqlAnswerResponse,
    SqlAnswerResultRequest,
    SqlAnswerResultResponse,
)

router = APIRouter()


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
        status="preprocessing",
    )

    background_tasks.add_task(
        service_container.sql_answer_service.sql_answer,
        sql_answer_request,
        service_metadata=asdict(service_metadata),
    )
    return SqlAnswerResponse(query_id=query_id)


@router.get("/sql-answers/{query_id}")
async def get_sql_answer_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SqlAnswerResultResponse:
    return service_container.sql_answer_service.get_sql_answer_result(
        SqlAnswerResultRequest(query_id=query_id)
    )


@router.get("/sql-answers/{query_id}/streaming")
async def get_sql_answer_streaming_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StreamingResponse:
    return StreamingResponse(
        service_container.sql_answer_service.get_sql_answer_streaming_result(query_id),
        media_type="text/event-stream",
    )
