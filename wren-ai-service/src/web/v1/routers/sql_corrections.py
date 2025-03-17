import uuid
from dataclasses import asdict
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from haystack import Document
from pydantic import BaseModel

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services import SqlCorrectionService

router = APIRouter()


"""
SQL Correction Router

This router handles endpoints related to correcting invalid SQL queries.

Endpoints:
1. POST /sql-correction
   - Initiates SQL correction process for invalid SQL queries
   - Request body: PostRequest
     {
       "contexts": [Document],                  # List of context documents
       "invalid_generation_results": [          # List of invalid SQL generation results
         {
           "sql": "SELECT * FROM table",        # Invalid SQL statement
           "error": "Error message"             # Error message
         }
       ],
       "project_id": "project-id"              # Optional project ID
     }
   - Response: PostResponse
     {
       "event_id": "unique-uuid"               # Unique identifier for tracking correction
     }

2. GET /sql-correction/{event_id}
   - Retrieves status and results of SQL correction process
   - Path parameter: event_id (str)
   - Response: GetResponse
     {
       "event_id": "unique-uuid",              # Unique identifier
       "status": "correcting" | "finished" | "failed",
       "response": {},                         # Correction results (when status is "finished")
       "error": {                              # Present only if status is "failed"
         "code": "OTHERS",
         "message": "Error description"
       },
       "trace_id": "trace-id"                  # Optional trace ID for debugging
     }

The SQL correction is an asynchronous process. The POST endpoint initiates the operation
and returns immediately with an event_id. The GET endpoint can then be used to check the
status and retrieve the results.

Usage:
1. Send a POST request to start the correction process
2. Use the returned event_id to poll the GET endpoint until status is "finished" or "failed"

Note: The actual processing is performed in the background using FastAPI's BackgroundTasks.
Results are cached with a TTL defined in the service configuration.
"""


class PostRequest(BaseModel):
    # todo: check the contexts
    contexts: List[Document]
    invalid_generation_results: List[Dict[str, str]]
    project_id: Optional[str] = None


class PostResponse(BaseModel):
    event_id: str


@router.post("/sql-correction")
async def correct(
    request: PostRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    event_id = str(uuid.uuid4())
    service = service_container.sql_correction_service
    service[event_id] = SqlCorrectionService.Event(id=event_id, status="correcting")

    correction_request = SqlCorrectionService.CorrectionRequest(
        id=event_id, **request.model_dump()
    )

    background_tasks.add_task(
        service.correct,
        correction_request,
        service_metadata=asdict(service_metadata),
    )
    return PostResponse(event_id=event_id)


class GetResponse(BaseModel):
    event_id: str
    status: Literal["correcting", "finished", "failed"]
    response: Optional[Dict] = None
    error: Optional[dict] = None
    trace_id: Optional[str] = None


@router.get("/sql-correction/{event_id}")
async def get(
    event_id: str,
    container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    event: SqlCorrectionService.Event = container.sql_correction_service[event_id]
    return GetResponse(
        event_id=event.id,
        status=event.status,
        response=event.response,
        error=event.error and event.error.model_dump(),
        trace_id=event.trace_id,
    )
