import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_question import (
    SqlQuestionRequest,
    SqlQuestionResponse,
    SqlQuestionResultRequest,
    SqlQuestionResultResponse,
)

router = APIRouter()


@router.post("/sql-questions")
async def sql_question(
    sql_question_request: SqlQuestionRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SqlQuestionResponse:
    query_id = str(uuid.uuid4())
    sql_question_request.query_id = query_id
    service_container.sql_question_service._sql_question_results[
        query_id
    ] = SqlQuestionResultResponse(
        status="generating",
    )

    background_tasks.add_task(
        service_container.sql_question_service.sql_question,
        sql_question_request,
        service_metadata=asdict(service_metadata),
    )
    return SqlQuestionResponse(query_id=query_id)


@router.get("/sql-questions/{query_id}")
async def get_sql_question_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SqlQuestionResultResponse:
    return service_container.sql_question_service.get_sql_question_result(
        SqlQuestionResultRequest(query_id=query_id)
    )
