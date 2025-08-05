import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.ask import (
    AskFeedbackRequest,
    AskFeedbackResponse,
    AskFeedbackResultRequest,
    AskFeedbackResultResponse,
    AskRequest,
    AskResponse,
    AskResultRequest,
    AskResultResponse,
    StopAskFeedbackRequest,
    StopAskFeedbackResponse,
    StopAskRequest,
    StopAskResponse,
)

router = APIRouter()


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


@router.get("/asks/{query_id}/result")
async def get_ask_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> AskResultResponse:
    return service_container.ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )


@router.get("/asks/{query_id}/streaming-result")
async def get_ask_streaming_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StreamingResponse:
    return StreamingResponse(
        service_container.ask_service.get_ask_streaming_result(query_id),
        media_type="text/event-stream",
    )


@router.post("/ask-feedbacks")
async def ask_feedback(
    ask_feedback_request: AskFeedbackRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> AskFeedbackResponse:
    query_id = str(uuid.uuid4())
    ask_feedback_request.query_id = query_id
    service_container.ask_service._ask_feedback_results[
        query_id
    ] = AskFeedbackResultResponse(
        status="searching",
    )

    background_tasks.add_task(
        service_container.ask_service.ask_feedback,
        ask_feedback_request,
        service_metadata=asdict(service_metadata),
    )
    return AskFeedbackResponse(query_id=query_id)


@router.patch("/ask-feedbacks/{query_id}")
async def stop_ask_feedback(
    query_id: str,
    stop_ask_feedback_request: StopAskFeedbackRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StopAskFeedbackResponse:
    stop_ask_feedback_request.query_id = query_id
    background_tasks.add_task(
        service_container.ask_service.stop_ask_feedback,
        stop_ask_feedback_request,
    )
    return StopAskFeedbackResponse(query_id=query_id)


@router.get("/ask-feedbacks/{query_id}")
async def get_ask_feedback_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> AskFeedbackResultResponse:
    return service_container.ask_service.get_ask_feedback_result(
        AskFeedbackResultRequest(query_id=query_id)
    )
