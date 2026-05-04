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
from src.pipelines.indexing.sql_pairs import SqlPair
from src.web.v1.services import BaseRequest, SqlPairsService

router = APIRouter()


class PostRequest(BaseRequest):
    sql_pairs: List[SqlPair]


class PostResponse(BaseModel):
    event_id: str


@router.post("/sql-pairs")
async def prepare(
    request: PostRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    event_id = str(uuid.uuid4())
    service = service_container.sql_pairs_service
    service[event_id] = SqlPairsService.Event(id=event_id, status="indexing")

    index_request = SqlPairsService.IndexRequest(id=event_id, **request.model_dump())

    background_tasks.add_task(
        service.index,
        index_request,
        service_metadata=asdict(service_metadata),
    )
    return PostResponse(event_id=event_id)


class DeleteRequest(BaseRequest):
    sql_pair_ids: List[str]


@router.delete("/sql-pairs")
async def delete(
    request: DeleteRequest,
    response: Response,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> None | SqlPairsService.Event.Error:
    event_id = str(uuid.uuid4())
    service = service_container.sql_pairs_service
    service[event_id] = SqlPairsService.Event(id=event_id, status="deleting")

    delete_request = SqlPairsService.DeleteRequest(
        id=event_id,
        **request.model_dump(),
    )

    await service.delete(delete_request, service_metadata=asdict(service_metadata))

    event: SqlPairsService.Event = service[event_id]

    if event.status == "failed":
        response.status_code = 500
        return event.error


class GetResponse(BaseModel):
    event_id: str
    status: Literal["indexing", "deleting", "finished", "failed"]
    error: Optional[dict]
    trace_id: Optional[str]


@router.get("/sql-pairs/{event_id}")
async def get(
    event_id: str,
    container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    event: SqlPairsService.Event = container.sql_pairs_service[event_id]
    return GetResponse(
        event_id=event.id,
        status=event.status,
        error=event.error and event.error.model_dump(),
        trace_id=event.trace_id,
    )
