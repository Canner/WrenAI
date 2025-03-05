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
from src.web.v1.services.ask import (
    AskRequest,
    AskResponse,
    AskResultRequest,
    AskResultResponse,
    StopAskRequest,
    StopAskResponse,
)

router = APIRouter()

"""
Ask Router

This router manages the endpoints related to submitting, stopping, and retrieving the results of SQL queries.

Endpoints:
1. **POST /asks**
   - Submits a new query for processing.
   - **Request Body**:
     - `query`: The natural language query to be processed.
     - `project_id`: (Optional) Identifier for the project to fetch relevant data.
     - `mdl_hash`: (Optional) Hash or ID related to the model to be used for the query.
     - `thread_id`: (Optional) Thread identifier for the query.
     - `history`: (Optional) Query history (SQL steps).
     - `configurations`: (Optional) Configuration such as fiscal year.
   - **Response**:
     - `query_id`: A unique identifier (UUID) for tracking the query.

2. **PATCH /asks/{query_id}**
   - Stops an ongoing query.
   - **Path Parameter**:
     - `query_id`: The unique identifier of the query to be stopped.
   - **Request Body**:
     - `status`: Must be set to `"stopped"`.
   - **Response**:
     - `query_id`: The unique identifier of the stopped query.

3. **GET /asks/{query_id}/result**
   - Retrieves the status and result of a submitted query.
   - **Path Parameter**:
     - `query_id`: The unique identifier of the query.
   - **Response**:
     - `status`: The current status of the query (`"understanding"`, `"searching"`, `"generating"`, `"correcting"`, `"finished"`, `"failed"`, or `"stopped"`).
     - `type`: The type of result (`"MISLEADING_QUERY"`, `"GENERAL"`, or `"TEXT_TO_SQL"`).
     - `response`: (Optional) A list of SQL results, each containing:
       - `sql`: The generated SQL statement.
       - `type`: The type of result (`"llm"` or `"view"`).
       - `viewId`: (Optional) The ID of the view, if applicable.
     - `error`: (Optional) Error information if the query failed, including:
       - `code`: The error code (e.g., `"NO_RELEVANT_DATA"`, `"NO_RELEVANT_SQL"`, `"OTHERS"`).
       - `message`: A detailed error message.

4. **GET /asks/{query_id}/streaming-result**
   - Retrieves the streaming result of a submitted query.
   - **Path Parameter**:
     - `query_id`: The unique identifier of the query.
   - **Response**:
     - Streaming response with the query result.

Process:
1. Use the POST endpoint to submit a new query. This returns a `query_id` to track the query.
2. To stop an ongoing query, use the PATCH endpoint with the `query_id`.
3. Use the GET endpoint to check the query status or retrieve the result once the query is processed.
4. Use the GET endpoint to retrieve the streaming result if the query generates a "GENERAL" type result from the `/asks/{query_id}/result` endpoint.

Note: The query processing is asynchronous, and status updates can be polled via the GET endpoint.
"""


@router.post("/asks")
async def ask(
    ask_request: AskRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> AskResponse:
    query_id = str(uuid.uuid4())
    ask_request.query_id = query_id
    service_container.ask_service._ask_results[query_id] = AskResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        service_container.ask_service.ask,
        ask_request,
        service_metadata=asdict(service_metadata),
    )
    return AskResponse(query_id=query_id)


@router.patch("/asks/{query_id}")
async def stop_ask(
    query_id: str,
    stop_ask_request: StopAskRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StopAskResponse:
    stop_ask_request.query_id = query_id
    background_tasks.add_task(
        service_container.ask_service.stop_ask,
        stop_ask_request,
    )
    return StopAskResponse(query_id=query_id)


@router.get("/asks/{query_id}/result")
async def get_ask_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> AskResultResponse:
    return service_container.ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )


@router.get("/asks/{query_id}/streaming-result")
async def get_ask_streaming_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StreamingResponse:
    return StreamingResponse(
        service_container.ask_service.get_ask_streaming_result(query_id),
        media_type="text/event-stream",
    )
