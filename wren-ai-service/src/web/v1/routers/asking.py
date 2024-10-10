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

#added imports
from src.web.v1.services.ask import (
    AskRequest,
    AskResponse,
    AskResultRequest,
    AskResultResponse,
    StopAskRequest,
    StopAskResponse,
)

router = APIRouter()

#shift to asks file
@router.post("/asks")
async def ask(
    ask_request: AskRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> AskResponse:
    query_id = str(uuid.uuid4())
    ask_request.query_id = query_id
    service_container.ask_service._ask_results[query_id] = AskResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        service_container.ask_service.ask,
        ask_request,
        service_metadata=asdict(service_metadata),
    )
    return AskResponse(query_id=query_id)

#shift to asks file
@router.patch("/asks/{query_id}")
async def stop_ask(
    query_id: str,
    stop_ask_request: StopAskRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StopAskResponse:
    stop_ask_request.query_id = query_id
    background_tasks.add_task(
        service_container.ask_service.stop_ask,
        stop_ask_request,
    )
    return StopAskResponse(query_id=query_id)


#shift to asks file
@router.get("/asks/{query_id}/result")
async def get_ask_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> AskResultResponse:
    return service_container.ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )


