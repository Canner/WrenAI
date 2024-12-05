from fastapi import APIRouter

from src.web.v1.routers import (
    ask,
    ask_details,
    chart,
    chart_adjustment,
    model_semantics,
    question_recommendation,
    relationship_recommendation,
    semantics_preparations,
    sql_answers,
    sql_expansions,
    sql_explanations,
    sql_regenerations,
)

router = APIRouter()
router.include_router(ask.router)
router.include_router(ask_details.router)
router.include_router(question_recommendation.router)
router.include_router(relationship_recommendation.router)
router.include_router(model_semantics.router)
router.include_router(semantics_preparations.router)
router.include_router(sql_answers.router)
router.include_router(sql_expansions.router)
router.include_router(sql_explanations.router)
router.include_router(chart.router)
router.include_router(chart_adjustment.router)
router.include_router(sql_regenerations.router)
# connected subrouter
