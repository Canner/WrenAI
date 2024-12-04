from fastapi import APIRouter

from src.web.v1.routers import (
    ask,
    ask_details,
    question_recommendation,
    relationship_recommendation,
    semantics_description,
    semantics_preparation,
    sql_answer,
    sql_expansion,
    sql_explanation,
    sql_regeneration,
)

router = APIRouter()
router.include_router(ask.router)
router.include_router(ask_details.router)
router.include_router(question_recommendation.router)
router.include_router(relationship_recommendation.router)
router.include_router(semantics_description.router)
router.include_router(semantics_preparation.router)
router.include_router(sql_answer.router)
router.include_router(sql_expansion.router)
router.include_router(sql_explanation.router)
router.include_router(sql_regeneration.router)
# connected subrouter
