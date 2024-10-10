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

router = APIRouter()


from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationRequest,
    SemanticsPreparationResponse,
    SemanticsPreparationStatusRequest,
    SemanticsPreparationStatusResponse,
)
"""
Router for handling semantics preparations requests and retrieving results.

This router provides endpoints for initiating a semantics preparation operation
and retrieving its results. It uses background tasks to process the
semantics preparation requests asynchronously.

Endpoints:
- POST /semantics-preparations: Initiate a semantics preparation operation
- GET /semantics-preparations/{mdl_hash}/status: Retrieve the status of a semantics preparation operation

The router depends on the ServiceContainer and ServiceMetadata, which are
injected using FastAPI's dependency injection system.


"""

@router.post("/semantics-preparations")
async def prepare_semantics(
    prepare_semantics_request: SemanticsPreparationRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SemanticsPreparationResponse:
    service_container.semantics_preparation_service._prepare_semantics_statuses[
        prepare_semantics_request.mdl_hash
    ] = SemanticsPreparationStatusResponse(
        status="indexing",
    )

    background_tasks.add_task(
        service_container.semantics_preparation_service.prepare_semantics,
        prepare_semantics_request,
        service_metadata=asdict(service_metadata),
    )
    return SemanticsPreparationResponse(mdl_hash=prepare_semantics_request.mdl_hash)


@router.get("/semantics-preparations/{mdl_hash}/status")
async def get_prepare_semantics_status(
    mdl_hash: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SemanticsPreparationStatusResponse:
    return service_container.semantics_preparation_service.get_prepare_semantics_status(
        SemanticsPreparationStatusRequest(mdl_hash=mdl_hash)
    )


