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
from src.web.v1.services.relationship_recommendation import RelationshipRecommendation

router = APIRouter()

"""
Relationship Recommendation Router

This router handles endpoints related to generating and retrieving relationship recommendations.

Endpoints:
1. POST /relationship-recommendations
   - Generates a new relationship recommendation
   - Request body: PostRequest
     {
       "mdl": "{ ... }",                           # JSON string of the MDL (Model Definition Language)
       "project_id": "project-id",                 # Optional project ID
       "configuration": {                           # Optional configuration settings
         "language": "English",                     # Language for the recommendation
       }
     }
   - Response: PostResponse
     {
       "id": "unique-uuid"                       # Unique identifier for the generated recommendation
     }

2. GET /relationship-recommendations/{id}
   - Retrieves the status and result of a relationship recommendation generation
   - Path parameter: id (str)
   - Response: GetResponse
     {
       "id": "unique-uuid",                      # Unique identifier of the recommendation
       "status": "generating" | "finished" | "failed",
       "response": {                             # Present only if status is "finished"
         "relationships": [...]                  # List of relationship recommendations
       },
       "error": {                                # Present only if status is "failed"
         "code": "OTHERS",
         "message": "Error description"
       }
     }

The relationship recommendation generation is an asynchronous process. The POST endpoint
initiates the generation and returns immediately with an ID. The GET endpoint can
then be used to check the status and retrieve the result when it's ready.

Usage:
1. Send a POST request to start the generation process.
2. Use the returned ID to poll the GET endpoint until the status is "finished" or "failed".

Note: The actual generation is performed in the background using FastAPI's BackgroundTasks.
"""


class PostRequest(BaseModel):
    mdl: str
    project_id: Optional[str] = None
    configuration: Optional[Configuration] = Configuration()


class PostResponse(BaseModel):
    id: str


@router.post(
    "/relationship-recommendations",
    response_model=PostResponse,
)
async def recommend(
    request: PostRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    id = str(uuid.uuid4())
    service = service_container.relationship_recommendation

    service[id] = RelationshipRecommendation.Resource(id=id)
    input = RelationshipRecommendation.Input(
        id=id,
        mdl=request.mdl,
        project_id=request.project_id,
        configuration=request.configuration,
    )

    background_tasks.add_task(
        service.recommend, input, service_metadata=asdict(service_metadata)
    )

    return PostResponse(id=id)


class GetResponse(BaseModel):
    id: str
    status: Literal["generating", "finished", "failed"]
    response: Optional[dict]
    error: Optional[dict]


@router.get(
    "/relationship-recommendations/{id}",
    response_model=GetResponse,
)
async def get(
    id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    resource = service_container.relationship_recommendation[id]

    return GetResponse(
        id=resource.id,
        status=resource.status,
        response=resource.response,
        error=resource.error and resource.error.model_dump(),
    )
