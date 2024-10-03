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

"""
RelationshipRecommendation Service

This service provides endpoints for generating and retrieving relationship recommendations
based on data models.

Endpoints:
1. POST /v1/relationship-recommendations
    Generate new relationship recommendations.

    Request body:
    {
        "mdl": "..."  # MDL (Model Definition Language) string
    }

    Response:
    {
        "id": "unique_id",  # Unique identifier for the generated recommendations
        "status": "generating"  # Initial status
    }

2. GET /v1/relationship-recommendations/{id}
    Retrieve the status and result of relationship recommendations generation.

    Path parameter:
    - id: Unique identifier of the relationship recommendations resource.

    Response:
    {
        "id": "unique_id",
        "status": "finished",  # Can be "generating", "finished", or "failed"
        "response": {  # Present only if status is "finished"
            // Generated relationship recommendations
        },
        "error": {  # Present only if status is "failed"
            "code": "OTHERS",
            "message": "Error description"
        }
    }

Usage:
1. Call the POST endpoint to initiate relationship recommendations generation.
2. Use the returned ID to poll the GET endpoint until the status is "finished" or "failed".
3. Once finished, retrieve the generated recommendations from the "response" field.

Note: The generation process may take some time, so implement appropriate polling
intervals when checking the status.
"""


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
