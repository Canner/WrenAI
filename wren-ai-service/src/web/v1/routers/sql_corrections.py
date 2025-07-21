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
from src.web.v1.services import BaseRequest, SqlCorrectionService

router = APIRouter()


class PostRequest(BaseRequest):
    sql: str
    error: str
    retrieved_tables: Optional[List[str]] = None
    use_dry_plan: bool = False
    allow_dry_plan_fallback: bool = True


class PostResponse(BaseModel):
    event_id: str


@router.post("/sql-corrections")
async def correct(
    request: PostRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    event_id = str(uuid.uuid4())
    service = service_container.sql_correction_service
    service[event_id] = SqlCorrectionService.Event(event_id=event_id)

    _request = SqlCorrectionService.CorrectionRequest(
        event_id=event_id, **request.model_dump()
    )

    background_tasks.add_task(
        service.correct,
        _request,
        service_metadata=asdict(service_metadata),
    )
    return PostResponse(event_id=event_id)


class GetResponse(BaseModel):
    event_id: str
    status: Literal["correcting", "finished", "failed"]
    response: Optional[str] = None
    error: Optional[dict] = None
    trace_id: Optional[str] = None
    invalid_sql: Optional[str] = None


@router.get("/sql-corrections/{event_id}")
async def get(
    event_id: str,
    container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    event: SqlCorrectionService.Event = container.sql_correction_service[event_id]
    return GetResponse(**event.model_dump())
