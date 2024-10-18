import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.routers import relationship_recommendation, semantics_description, asking,semantics_preparations,ask_details,sql_expansions,sql_answers,sql_regenerations,sql_explanations

router = APIRouter()
router.include_router(semantics_description.router)
router.include_router(relationship_recommendation.router)
router.include_router(asking.router)
router.include_router(ask_details.router)
router.include_router(semantics_preparations.router)
router.include_router(sql_expansions.router)
router.include_router(sql_answers.router)
router.include_router(sql_regenerations.router)
router.include_router(sql_explanations.router)
#connected subrouter







