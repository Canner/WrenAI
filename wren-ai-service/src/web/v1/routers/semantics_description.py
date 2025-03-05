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
from src.web.v1.services.semantics_description import SemanticsDescription

router = APIRouter()

"""
Semantics Description Router

This router handles endpoints related to generating and retrieving semantic descriptions.

Endpoints:
1. POST /semantics-descriptions
   - Generates a new semantic description
   - Request body: PostRequest
     {
       "selected_models": ["model1", "model2"],  # List of model names to describe
       "user_prompt": "Describe these models",   # User's instruction for description
       "mdl": "{ ... }",                         # JSON string of the MDL (Model Definition Language)
       "project_id": "project-id",               # Optional project ID
       "configuration": {                        # Optional configuration settings
         "language": "English"                   # Optional language, defaults to "English"
       }
     }
   - Response: PostResponse
     {
       "id": "unique-uuid"                       # Unique identifier for the generated description
     }

2. GET /semantics-descriptions/{id}
   - Retrieves the status and result of a semantic description generation
   - Path parameter: id (str)
   - Response: GetResponse
     {
       "id": "unique-uuid",                      # Unique identifier of the description
       "status": "generating" | "finished" | "failed",
       "response": [                             # Present only if status is "finished" or "generating"
         {
           "name": "model1",
           "columns": [
             {
               "name": "col1", 
               "description": "Unique identifier for each record in the example model."
             }
           ],
           "description": "This model is used for analysis purposes, capturing key attributes of records."
         },
         {
           "name": "model2", 
           "columns": [
             {
               "name": "col1",
               "description": "Unique identifier for each record in the example model."
             }
           ],
           "description": "This model is used for analysis purposes, capturing key attributes of records."
         }
       ],
       "error": {                                # Present only if status is "failed"
         "code": "OTHERS",
         "message": "Error description"
       }
     }

The semantic description generation is an asynchronous process. The POST endpoint
initiates the generation and returns immediately with an ID. The GET endpoint can
then be used to check the status and retrieve the result when it's ready.

Usage:
1. Send a POST request to start the generation process.
2. Use the returned ID to poll the GET endpoint until the status is "finished" or "failed".

Note: The actual generation is performed in the background using FastAPI's BackgroundTasks.
"""


class PostRequest(BaseModel):
    selected_models: list[str]
    user_prompt: str
    mdl: str
    project_id: Optional[str] = None
    configuration: Optional[Configuration] = Configuration()


class PostResponse(BaseModel):
    id: str


@router.post(
    "/semantics-descriptions",
    response_model=PostResponse,
)
async def generate(
    request: PostRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    id = str(uuid.uuid4())
    service = service_container.semantics_description

    service[id] = SemanticsDescription.Resource(id=id)
    input = SemanticsDescription.Input(
        id=id,
        selected_models=request.selected_models,
        user_prompt=request.user_prompt,
        mdl=request.mdl,
        configuration=request.configuration,
        project_id=request.project_id,
    )

    background_tasks.add_task(
        service.generate, input, service_metadata=asdict(service_metadata)
    )
    return PostResponse(id=id)


class GetResponse(BaseModel):
    id: str
    status: Literal["generating", "finished", "failed"]
    response: Optional[list[dict]]
    error: Optional[dict]


@router.get(
    "/semantics-descriptions/{id}",
    response_model=GetResponse,
)
async def get(
    id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    resource = service_container.semantics_description[id]

    def _formatter(response: Optional[dict]) -> Optional[list[dict]]:
        if response is None:
            return None

        return [
            {
                "name": model_name,
                "columns": [
                    {
                        "name": column["name"],
                        "description": column["properties"].get("description", ""),
                    }
                    for column in model_data["columns"]
                ],
                "description": model_data["properties"].get("description", ""),
            }
            for model_name, model_data in response.items()
        ]

    return GetResponse(
        id=resource.id,
        status=resource.status,
        response=resource.response and _formatter(resource.response),
        error=resource.error and resource.error.model_dump(),
    )
