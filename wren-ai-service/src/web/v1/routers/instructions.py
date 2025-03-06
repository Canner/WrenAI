import uuid
from dataclasses import asdict
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Response
from pydantic import BaseModel

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.pipelines.indexing.instructions import Instruction
from src.web.v1.services import InstructionsService

router = APIRouter()


"""
Instructions Router

This router handles endpoints related to preparing and managing instructions.

Endpoints:
1. POST /instructions
   - Indexes instructions for retrieval
   - Request body: PostRequest
     {
       "instructions": [                      # List of instructions
         {
           "id": "unique-id",                 # Unique identifier for the instruction
           "content": "Instruction content",  # Content of the instruction
           "metadata": {}                     # Optional metadata for the instruction
         }
       ],
       "project_id": "project-id"             # Optional project ID
     }
   - Response: PostResponse
     {
       "event_id": "unique-uuid"              # Unique identifier for tracking indexing
     }

2. DELETE /instructions
   - Deletes specified instructions by their IDs
   - Request body: DeleteRequest
     {
       "instruction_ids": ["id1", "id2"],     # List of instruction IDs to delete
       "project_id": "project-id"             # Optional project ID
     }
   - Response: None or Error object if failed

3. GET /instructions/{event_id}
   - Retrieves status of instructions indexing/deletion
   - Path parameter: event_id (str)
   - Response: GetResponse
     {
       "event_id": "unique-uuid",             # Unique identifier
       "status": "indexing" | "deleting" | "finished" | "failed",
       "error": {                             # Present only if status is "failed"
         "code": "OTHERS",
         "message": "Error description"
       },
       "trace_id": "trace-id"                 # Optional trace ID for tracking
     }

The instructions indexing and deletion are asynchronous processes. The POST endpoint
initiates the operation and returns immediately with an ID. The GET endpoint can then be used
to check the status and result.

Usage:
1. Send a POST/DELETE request to start the operation
2. Use the returned ID to poll the GET endpoint until status is "finished" or "failed"

Note: The actual processing is performed in the background using FastAPI's BackgroundTasks.
Results are cached with a TTL defined in the service configuration.
"""


class PostRequest(BaseModel):
    instructions: List[Instruction]
    project_id: Optional[str] = None


class PostResponse(BaseModel):
    event_id: str


@router.post("/instructions")
async def index(
    request: PostRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    event_id = str(uuid.uuid4())
    service = service_container.instructions_service
    service[event_id] = InstructionsService.Event(event_id=event_id)

    index_request = InstructionsService.IndexRequest(
        event_id=event_id, **request.model_dump()
    )

    background_tasks.add_task(
        service.index,
        index_request,
        service_metadata=asdict(service_metadata),
    )
    return PostResponse(event_id=event_id)


class DeleteRequest(BaseModel):
    instruction_ids: List[str]
    project_id: Optional[str] = None


@router.delete("/instructions")
async def delete(
    request: DeleteRequest,
    response: Response,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> None | InstructionsService.Error:
    event_id = str(uuid.uuid4())
    service = service_container.instructions_service
    service[event_id] = InstructionsService.Event(event_id=event_id, status="deleting")

    delete_request = InstructionsService.DeleteRequest(
        event_id=event_id,
        **request.model_dump(),
    )

    await service.delete(delete_request, service_metadata=asdict(service_metadata))

    event: InstructionsService.Event = service[event_id]

    if event.status == "failed":
        response.status_code = 500
        return event.error


class GetResponse(BaseModel):
    event_id: str
    status: Literal["indexing", "deleting", "finished", "failed"]
    error: Optional[dict]
    trace_id: Optional[str]


@router.get("/instructions/{event_id}")
async def get(
    event_id: str,
    container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    event: InstructionsService.Event = container.instructions_service[event_id]
    return GetResponse(**event.model_dump())
