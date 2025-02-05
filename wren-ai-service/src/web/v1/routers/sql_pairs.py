import uuid
from dataclasses import asdict
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.pipelines.indexing.sql_pairs import SqlPair
from src.web.v1.services import SqlPairsService

router = APIRouter()


"""
SQL Pairs Router

This router handles endpoints related to preparing and managing SQL pairs.

Endpoints:
1. POST /sql-pairs
   - Prepares SQL pairs for processing
   - Request body: PostRequest
     {
       "sql_pairs": [                          # List of SQL pairs
         {
           "sql": "SELECT * FROM table",        # SQL statement
           "question": "What is the question?", # Question
           "id": "unique-id"                    # Unique identifier for the SQL pair
         }
       ],
       "project_id": "project-id"             # Optional project ID
     }
   - Response: PostResponse
     {
       "id": "unique-uuid"                    # Unique identifier for tracking preparation
     }

2. DELETE /sql-pairs
   - Deletes specified SQL pairs by their IDs
   - Request body: DeleteRequest
     {
       "sql_pair_ids": ["id1", "id2"],       # List of SQL pair IDs to delete
       "project_id": "project-id"            # Optional project ID
     }
   - Response: DeleteResponse
     {
       "id": "unique-uuid"                   # Unique identifier for tracking deletion
     }

3. GET /sql-pairs/{id}
   - Retrieves status of SQL pairs preparation/deletion
   - Path parameter: id (str)
   - Response: GetResponse
     {
       "id": "unique-uuid",                  # Unique identifier
       "status": "indexing" | "deleting" | "finished" | "failed",
       "error": {                            # Present only if status is "failed"
         "code": "OTHERS",
         "message": "Error description"
       }
     }

The SQL pairs preparation and deletion are asynchronous processes. The POST and DELETE endpoints
initiate the operations and return immediately with an ID. The GET endpoint can then be used
to check the status and result.

Usage:
1. Send a POST/DELETE request to start the operation
2. Use the returned ID to poll the GET endpoint until status is "finished" or "failed"

Note: The actual processing is performed in the background using FastAPI's BackgroundTasks.
Results are cached with a TTL of 3600 seconds. Refer to the Settings.query_cache_ttl for more details.
"""


class PostRequest(BaseModel):
    sql_pairs: List[SqlPair]
    project_id: Optional[str] = None


class PostResponse(BaseModel):
    id: str


@router.post("/sql-pairs")
async def prepare(
    request: PostRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    id = str(uuid.uuid4())
    service = service_container.sql_pairs_service
    service[id] = SqlPairsService.Resource(id=id, status="indexing")

    background_tasks.add_task(
        service.index,
        id,
        sql_pairs=request.sql_pairs,
        project_id=request.project_id,
        service_metadata=asdict(service_metadata),
    )
    return PostResponse(id=id)


class DeleteRequest(BaseModel):
    sql_pair_ids: List[str]
    project_id: Optional[str] = None


class DeleteResponse(BaseModel):
    id: str


@router.delete("/sql-pairs")
async def delete(
    request: DeleteRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> DeleteResponse:
    id = str(uuid.uuid4())
    service = service_container.sql_pairs_service
    service[id] = SqlPairsService.Resource(id=id, status="deleting")

    background_tasks.add_task(
        service.delete,
        id,
        sql_pair_ids=request.sql_pair_ids,
        project_id=request.project_id,
        service_metadata=asdict(service_metadata),
    )
    return DeleteResponse(id=id)


class GetResponse(BaseModel):
    id: str
    status: Literal["deleting", "finished", "failed"]
    error: Optional[dict]


@router.get("/sql-pairs/{id}")
async def get(
    id: str,
    container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    resource = container.sql_pairs_service[id]
    return GetResponse(
        id=resource.id,
        status=resource.status,
        error=resource.error and resource.error.model_dump(),
    )
