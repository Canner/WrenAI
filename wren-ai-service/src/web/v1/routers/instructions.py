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
from src.web.v1.services import BaseRequest, InstructionsService

router = APIRouter()


class PostRequest(BaseRequest):
    instructions: List[InstructionsService.Instruction]


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


class DeleteRequest(BaseRequest):
    instruction_ids: List[str]


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
