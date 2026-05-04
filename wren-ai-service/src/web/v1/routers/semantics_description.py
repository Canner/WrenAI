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
from src.web.v1.services import BaseRequest, SemanticsDescription

router = APIRouter()


class PostRequest(BaseRequest):
    selected_models: list[str]
    user_prompt: str
    mdl: str


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

    generate_request = SemanticsDescription.GenerateRequest(
        id=id, **request.model_dump()
    )

    background_tasks.add_task(
        service.generate,
        generate_request,
        service_metadata=asdict(service_metadata),
    )
    return PostResponse(id=id)


class GetResponse(BaseModel):
    id: str
    status: Literal["generating", "finished", "failed"]
    response: Optional[list[dict]]
    error: Optional[dict]
    trace_id: Optional[str] = None


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
        trace_id=resource.trace_id,
    )
