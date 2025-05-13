import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v2.services import QueueNotFoundError
from src.web.v2.services.conversation import (
    ConversationRequest,
    ConversationResponse,
)

router = APIRouter()


@router.post("/conversations")
async def start_conversation(
    conversation_request: ConversationRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> ConversationResponse:
    query_id = str(uuid.uuid4())
    conversation_request.query_id = query_id

    background_tasks.add_task(
        service_container.conversation_service.start_conversation,
        conversation_request,
        service_metadata=asdict(service_metadata),
    )
    return ConversationResponse(query_id=query_id)


@router.post("/conversations/{query_id}/stop")
async def stop_conversation(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
):
    try:
        service_container.conversation_service.stop_conversation(query_id)
    except QueueNotFoundError:
        return JSONResponse(
            {
                "stopped": False,
            },
            status_code=404,
        )

    return {"stopped": True}


@router.get("/conversations/{query_id}/stream")
async def get_conversation_streaming_result(
    query_id: str,
    request: Request,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StreamingResponse:
    event_generator = (
        await service_container.conversation_service.get_conversation_streaming_result(
            query_id, request
        )
    )

    return StreamingResponse(
        event_generator,
        media_type="text/event-stream",
    )
