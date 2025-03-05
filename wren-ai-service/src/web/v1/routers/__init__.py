from fastapi import APIRouter

from src.web.v1.routers import (
    ask,
    ask_details,
    chart,
    chart_adjustment,
    question_recommendation,
    relationship_recommendation,
    semantics_description,
    semantics_preparation,
    sql_answers,
    sql_expansions,
    sql_explanations,
    sql_pairs_preparation,
    sql_question,
    sql_regenerations,
)

router = APIRouter()
router.include_router(ask.router)
router.include_router(ask_details.router)
router.include_router(question_recommendation.router)
router.include_router(relationship_recommendation.router)
router.include_router(semantics_description.router)
router.include_router(semantics_preparation.router)
router.include_router(sql_answers.router)
router.include_router(sql_expansions.router)
router.include_router(sql_explanations.router)
router.include_router(chart.router)
router.include_router(chart_adjustment.router)
router.include_router(sql_regenerations.router)
router.include_router(sql_pairs_preparation.router)
router.include_router(sql_question.router)
# connected subrouter
