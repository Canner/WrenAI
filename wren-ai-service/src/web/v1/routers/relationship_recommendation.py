import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.relationship_recommendation import RelationshipRecommendation

router = APIRouter()


@router.post(
    "/relationship-recommendations",
    response_model=RelationshipRecommendation.Response,
)
async def recommend(
    request: RelationshipRecommendation.Request,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> RelationshipRecommendation.Response:
    id = str(uuid.uuid4())
    request.id = id
    service = service_container.relationship_recommendation

    service[request] = RelationshipRecommendation.Response(id=id)

    background_tasks.add_task(
        service.recommend, request, service_metadata=asdict(service_metadata)
    )
    return service[request]


@router.get(
    "/relationship-recommendations/{id}",
    response_model=RelationshipRecommendation.Response,
)
async def get(
    id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> RelationshipRecommendation.Response:
    request = RelationshipRecommendation.Request()
    request.id = id

    return service_container.relationship_recommendation[request]
