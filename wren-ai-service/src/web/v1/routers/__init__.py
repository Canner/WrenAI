from fastapi import APIRouter

from src.web.v1.routers import (
    ask,
    ask_details,
    chart,
    chart_adjustment,
    instructions,
    question_recommendation,
    relationship_recommendation,
    semantics_description,
    semantics_preparation,
    sql_answers,
    sql_expansions,
    sql_pairs,
    sql_question,
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
router.include_router(chart.router)
router.include_router(chart_adjustment.router)
router.include_router(sql_pairs.router)
router.include_router(sql_question.router)
router.include_router(instructions.router)
