import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.semantics_description import SemanticsDescription

router = APIRouter()


@router.post("/semantics-descriptions", response_model=SemanticsDescription.Response)
async def generate(
    request: SemanticsDescription.Request,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SemanticsDescription.Response:
    id = str(uuid.uuid4())
    request.id = id
    service = service_container.semantics_description

    service[request] = SemanticsDescription.Response(id=id)

    background_tasks.add_task(
        service.generate, request, service_metadata=asdict(service_metadata)
    )
    return service[request]


@router.get(
    "/semantics-descriptions/{id}",
    response_model=SemanticsDescription.Response,
)
async def get(
    id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SemanticsDescription.Response:
    request = SemanticsDescription.Request()
    request.id = id

    return service_container.semantics_description[request]
