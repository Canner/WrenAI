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

"""
SQL Answers Router

This router handles endpoints related to initiating SQL answer operations and retrieving their results.

Endpoints:
1. POST /sql-answers
   - Initiates an SQL answer operation
   - Request body: SqlAnswerRequest
     {
       "query": "user's question",
       "sql": "SELECT * FROM table_name WHERE condition",      # Actual SQL statement
       "sql_data": <dictionary>,                                   # Preprocessed SQL data
       "project_id": "unique-project-id",                        # Optional project identifier for tracking
       "thread_id": "unique-thread-id",                        # Optional thread identifier for tracking
     }
   - Response: SqlAnswerResponse
     {
       "query_id": "unique-uuid"                              # Unique identifier for the initiated SQL operation
     }

2. GET /sql-answers/{query_id}
   - Retrieves the status and result of a SQL answer operation
   - Path parameter: query_id (str)
   - Response: SqlAnswerResultResponse
     {
       "query_id": "unique-uuid",                             # Unique identifier of the SQL answer operation
       "status": "preprocessing" | "succeeded" | "failed",
       "num_rows_used_in_llm": int | None,
       "error": {                                             # Present only if status is "failed"
         "code": "OTHERS",
         "message": "Error description"
       }
     }

3. **GET /sql-answers/{query_id}/streaming**
   - Retrieves the streaming result of a SQL answer.
   - **Path Parameter**:
     - `query_id`: The unique identifier of the query.
   - **Response**:
     - Streaming response with the SQL answer.

Note: The actual SQL processing is performed in the background using FastAPI's BackgroundTasks.
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
