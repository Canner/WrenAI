from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.semantics_preparation import (
    DeleteSemanticsRequest,
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
    delete_semantics_request: DeleteSemanticsRequest | None = Body(default=None),
    runtime_scope_id: str | None = Query(default=None),
    runtimeScopeId: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    projectId: str | None = Query(default=None),
    service_container: ServiceContainer = Depends(get_service_container),
) -> None:
    payload = (
        delete_semantics_request.model_dump(mode="python")
        if delete_semantics_request
        else {}
    )
    resolved_runtime_scope_id = runtime_scope_id or runtimeScopeId
    compatibility_scope_id = project_id or projectId
    payload.setdefault("runtime_scope_id", resolved_runtime_scope_id)
    if not payload.get("runtime_scope_id"):
        payload.setdefault("project_id", compatibility_scope_id)
    request = DeleteSemanticsRequest.model_validate(payload)
    runtime_scope_id = request.resolve_runtime_scope_id()

    if not runtime_scope_id:
        raise HTTPException(status_code=400, detail="Runtime scope is required")
    await service_container.semantics_preparation_service.delete_semantics(request)
