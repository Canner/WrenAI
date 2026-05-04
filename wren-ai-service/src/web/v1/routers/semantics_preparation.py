from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationRequest,
    SemanticsPreparationResponse,
    SemanticsPreparationStatusRequest,
    SemanticsPreparationStatusResponse,
)

router = APIRouter()


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


@router.delete("/semantics")
async def delete_semantics(
    project_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> None:
    if not project_id:
        raise HTTPException(status_code=400, detail="Project ID is required")
    await service_container.semantics_preparation_service.delete_semantics(project_id)
