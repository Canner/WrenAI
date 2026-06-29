import asyncio
import uuid
from dataclasses import asdict

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.ask import (
    AskError,
    AskRequest,
    AskResponse,
    AskResultRequest,
    AskResultResponse,
    StopAskRequest,
    StopAskResponse,
)

router = APIRouter()


@router.post("/asks")
async def ask(
    ask_request: AskRequest,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> AskResponse:
    query_id = str(uuid.uuid4())
    ask_request.query_id = query_id
    ask_service = service_container.ask_service

    if ask_service._is_greeting_query(ask_request.query):
        ask_service._general_streaming_results[query_id] = (
            ask_service._build_greeting_response(ask_request.query)
        )
        ask_service._ask_results[query_id] = AskResultResponse(
            status="finished",
            type="GENERAL",
        )
        return AskResponse(query_id=query_id)

    if not ask_request.project_id and ask_request.mdl_hash:
        ask_request.project_id = (
            service_container.semantics_preparation_service.get_project_id(
                ask_request.mdl_hash
            )
        )

    if not ask_request.project_id:
        ask_service._ask_results[query_id] = AskResultResponse(
            status="failed",
            type="TEXT_TO_SQL",
            error=AskError(
                code="OTHERS",
                message=(
                    "project_id is required for /v1/asks. Include the project_id "
                    "used for semantics preparation, or run semantics preparation "
                    "again so project_id can be inferred from mdl_hash."
                ),
            ),
        )
        return AskResponse(query_id=query_id)

    ask_service._ask_results[query_id] = AskResultResponse(
        status="understanding",
    )

    task = asyncio.create_task(
        ask_service.ask(
            ask_request,
            service_metadata=asdict(service_metadata),
        )
    )

    def _handle_task_done(completed_task: asyncio.Task):
        try:
            completed_task.result()
        except Exception:
            # ask() already captures and records task failures, but we still
            # log unexpected task-level exceptions instead of dropping them.
            import logging

            logging.getLogger("wren-ai-service").exception(
                "Unhandled exception in ask background task for query_id %s",
                query_id,
            )

    task.add_done_callback(_handle_task_done)
    return AskResponse(query_id=query_id)


@router.patch("/asks/{query_id}")
async def stop_ask(
    query_id: str,
    stop_ask_request: StopAskRequest,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StopAskResponse:
    stop_ask_request.query_id = query_id
    service_container.ask_service.stop_ask(stop_ask_request)
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
