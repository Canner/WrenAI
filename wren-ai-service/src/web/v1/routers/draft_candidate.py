import uuid
from dataclasses import asdict
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services import Configuration
from src.web.v1.services.draft_candidate import DraftCandidate

router = APIRouter()

"""
Draft Candidate Router

This router handles endpoints related to generating and retrieving draft candidates.

Endpoints:
1. POST /draft-candidates
   - Generates new draft candidates
   - Request body: PostRequest
     {
       "sql": "SELECT * FROM table",                     # SQL query string
       "question": "What does this query do?",           # Question about the SQL query
       "num_candidates": 2,                              # Optional number of candidates to generate (default: 2)
       "project_id": "project-id",                       # Optional project ID
       "configuration": {                                # Optional configuration settings
         "language": "English",                          # Optional language, defaults to "English"
         "timezone": {                                   # Optional timezone settings
           "name": "Asia/Taipei",                        # Timezone name, defaults to "Asia/Taipei"
         }
       }
     }
   - Response: PostResponse
     {
       "id": "unique-uuid"                               # Unique identifier for the generated candidates
     }

2. GET /draft-candidates/{id}
   - Retrieves the status and result of draft candidates generation
   - Path parameter: id (str)
   - Response: GetResponse
     {
       "id": "unique-uuid",                             # Unique identifier of the candidates
       "status": "generating" | "finished" | "failed",  # Current status of generation
       "response": {                                    # Present only if status is "finished"
         "candidates": [                                # List of draft candidates
           {
             "sql": "SELECT ...",                      # SQL query variant
             "summary": "This query..."                # Summary of what the query does
           }
         ]
       },
       "error": {                                      # Present only if status is "failed"
         "code": "OTHERS" | "SQL_PARSE_ERROR" | "RESOURCE_NOT_FOUND",
         "message": "Error description"
       }
     }

The draft candidate generation is an asynchronous process. The POST endpoint
initiates the generation and returns immediately with an ID. The GET endpoint can
then be used to check the status and retrieve the result when it's ready.
"""


class PostRequest(BaseModel):
    sql: str
    question: str
    project_id: Optional[str] = None
    configuration: Optional[Configuration] = Configuration()


class PostResponse(BaseModel):
    id: str


@router.post(
    "/draft-candidates",
    response_model=PostResponse,
)
async def generate(
    request: PostRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    id = str(uuid.uuid4())
    service = service_container.draft_candidate

    service[id] = DraftCandidate.Resource(id=id)
    input = DraftCandidate.Input(
        id=id,
        mdl=request.mdl,
        project_id=request.project_id,
        configuration=request.configuration,
    )

    background_tasks.add_task(
        service.generate, input, service_metadata=asdict(service_metadata)
    )

    return PostResponse(id=id)


class GetResponse(BaseModel):
    id: str
    status: Literal["generating", "finished", "failed"]
    response: Optional[dict]
    error: Optional[dict]


@router.get(
    "/draft-candidates/{id}",
    response_model=GetResponse,
)
async def get(
    id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    resource = service_container.draft_candidate[id]

    return GetResponse(
        id=resource.id,
        status=resource.status,
        response=resource.response,
        error=resource.error and resource.error.model_dump(),
    )
