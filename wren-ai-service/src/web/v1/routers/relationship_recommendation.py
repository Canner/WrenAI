import asyncio
import logging
import uuid
from dataclasses import asdict
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services import BaseRequest, RelationshipRecommendation

router = APIRouter()
logger = logging.getLogger("wren-ai-service")


async def _run_recommendation_task(
    service: RelationshipRecommendation,
    input: RelationshipRecommendation.Input,
    service_metadata: dict,
):
    try:
        await service.recommend(input, service_metadata=service_metadata)
    except Exception as e:
        logger.exception("Unexpected relationship recommendation task failure")
        service._handle_exception(
            input,
            f"Unexpected relationship recommendation task failure: {str(e)}",
            request_from=input.request_from,
        )


class PostRequest(BaseRequest):
    mdl: str


class PostResponse(BaseModel):
    id: str


@router.post(
    "/relationship-recommendations",
    response_model=PostResponse,
)
async def recommend(
    request: PostRequest,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    id = str(uuid.uuid4())
    service = service_container.relationship_recommendation

    service[id] = RelationshipRecommendation.Resource(id=id)
    input = RelationshipRecommendation.Input(
        id=id,
        mdl=request.mdl,
        project_id=request.project_id,
        configuration=request.configurations,
    )

    asyncio.create_task(
        _run_recommendation_task(
            service,
            input,
            asdict(service_metadata),
        )
    )

    return PostResponse(id=id)


class GetResponse(BaseModel):
    id: str
    status: Literal["generating", "finished", "failed"]
    response: Optional[dict]
    error: Optional[dict]
    trace_id: Optional[str] = None


@router.get(
    "/relationship-recommendations/{id}",
    response_model=GetResponse,
)
async def get(
    id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    resource = service_container.relationship_recommendation[id]

    return GetResponse(
        id=resource.id,
        status=resource.status,
        response=resource.response,
        error=resource.error and resource.error.model_dump(),
        trace_id=resource.trace_id,
    )
