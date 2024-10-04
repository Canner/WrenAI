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
from src.web.v1.services.semantics_description import SemanticsDescription

router = APIRouter()

"""
Semantics Description Router

This router handles endpoints related to generating and retrieving semantic descriptions.

Endpoints:
1. POST /semantics-descriptions
   - Generates a new semantic description
   - Request body: PostRequest
   - Response: PostResponse with a unique ID

2. GET /semantics-descriptions/{id}
   - Retrieves the status and result of a semantic description generation
   - Path parameter: id (str)
   - Response: GetResponse with status, response, and error information

The semantic description generation is an asynchronous process. The POST endpoint
initiates the generation and returns immediately with an ID. The GET endpoint can
then be used to check the status and retrieve the result when it's ready.

Usage:
1. Send a POST request to start the generation process.
2. Use the returned ID to poll the GET endpoint until the status is "finished" or "failed".

Note: The actual generation is performed in the background using FastAPI's BackgroundTasks.
"""


class PostRequest(BaseModel):
    _id: str | None = None
    selected_models: list[str]
    user_prompt: str
    mdl: str

    @property
    def id(self) -> str:
        return self._id

    @id.setter
    def id(self, id: str):
        self._id = id


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
    request.id = id
    service = service_container.semantics_description

    service[id] = SemanticsDescription.Resource(id=id)
    SemanticsDescription.Input(
        id=id,
        selected_models=request.selected_models,
        user_prompt=request.user_prompt,
        mdl=request.mdl,
    )

    background_tasks.add_task(
        service.generate, request, service_metadata=asdict(service_metadata)
    )
    return PostResponse(id=id)


class GetResponse(BaseModel):
    id: str
    status: Literal["generating", "finished", "failed"]
    response: Optional[dict]
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

    return GetResponse(
        id=resource.id,
        status=resource.status,
        response=resource.response,
        error=resource.error and resource.error.model_dump(),
    )
