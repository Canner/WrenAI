import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.ask_feedback import (
    AskFeedbackRequest,
    AskFeedbackResponse,
    AskFeedbackResultRequest,
    AskFeedbackResultResponse,
    StopAskFeedbackRequest,
    StopAskFeedbackResponse,
)

router = APIRouter()


@router.post("/ask-feedbacks")
async def ask_feedback(
    ask_feedback_request: AskFeedbackRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> AskFeedbackResponse:
    query_id = str(uuid.uuid4())
    ask_feedback_request.query_id = query_id
    service_container.ask_feedback_service._ask_feedback_results[
        query_id
    ] = AskFeedbackResultResponse(
        status="searching",
    )

    background_tasks.add_task(
        service_container.ask_feedback_service.ask_feedback,
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
        service_container.ask_feedback_service.stop_ask_feedback,
        stop_ask_feedback_request,
    )
    return StopAskFeedbackResponse(query_id=query_id)


@router.get("/ask-feedbacks/{query_id}")
async def get_ask_feedback_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> AskFeedbackResultResponse:
    return service_container.ask_feedback_service.get_ask_feedback_result(
        AskFeedbackResultRequest(query_id=query_id)
    )
