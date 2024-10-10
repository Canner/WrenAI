import uuid
from dataclasses import asdict
# from typing import Literal, Optional  # Unnecessary import

from fastapi import APIRouter, BackgroundTasks, Depends
# from pydantic import BaseModel  # Unnecessary import

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)

from src.web.v1.services.ask_details import (
    AskDetailsRequest,
    AskDetailsResponse,
    AskDetailsResultRequest,
    AskDetailsResultResponse,
)

router = APIRouter()
"""
Router for handling SQL query details requests and retrieving results.

This router provides endpoints for initiating an ask-details operation
and retrieving its results. It uses background tasks to process the
ask-details requests asynchronously.

Endpoints:
- POST /ask-details: Initiate an ask-details operation
- GET /ask-details/{query_id}/result: Retrieve the result of an ask-details operation

The router depends on the ServiceContainer and ServiceMetadata, which are
injected using FastAPI's dependency injection system.
"""


@router.post("/ask-details")
async def ask_details(
    ask_details_request: AskDetailsRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> AskDetailsResponse:
    query_id = str(uuid.uuid4())
    ask_details_request.query_id = query_id
    service_container.ask_details_service._ask_details_results[
        query_id
    ] = AskDetailsResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        service_container.ask_details_service.ask_details,
        ask_details_request,
        service_metadata=asdict(service_metadata),
    )
    return AskDetailsResponse(query_id=query_id)


@router.get("/ask-details/{query_id}/result")
async def get_ask_details_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> AskDetailsResultResponse:
    return service_container.ask_details_service.get_ask_details_result(
        AskDetailsResultRequest(query_id=query_id)
    )

