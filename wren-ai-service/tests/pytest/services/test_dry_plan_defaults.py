from unittest.mock import AsyncMock

import pytest

from src.web.v1.routers.question_recommendation import (
    PostRequest as QuestionRecommendationPostRequest,
)
from src.web.v1.routers.sql_corrections import PostRequest as SqlCorrectionPostRequest
from src.web.v1.services.ask import AskRequest, AskResultRequest, AskService
from src.web.v1.services.question_recommendation import QuestionRecommendation
from src.web.v1.services.sql_corrections import SqlCorrectionService


def test_ask_request_defaults_to_planner_validation_without_fallback():
    request = AskRequest(query="How many records are available?", id="deploy-id")

    assert request.use_dry_plan is True
    assert request.allow_dry_plan_fallback is False


def test_ask_request_allows_explicit_planner_override():
    request = AskRequest(
        query="How many records are available?",
        id="deploy-id",
        use_dry_plan=False,
        allow_dry_plan_fallback=True,
    )

    assert request.use_dry_plan is False
    assert request.allow_dry_plan_fallback is True


def test_sql_correction_router_defaults_to_planner_validation_without_fallback():
    request = SqlCorrectionPostRequest(sql="SELECT 1", error="dry run failed")

    assert request.use_dry_plan is True
    assert request.allow_dry_plan_fallback is False


def test_sql_correction_service_defaults_to_planner_validation_without_fallback():
    request = SqlCorrectionService.CorrectionRequest(
        event_id="event-id",
        sql="SELECT 1",
        error="dry run failed",
    )

    assert request.use_dry_plan is True
    assert request.allow_dry_plan_fallback is False


def test_question_recommendation_router_defaults_to_planner_validation_without_fallback():
    request = QuestionRecommendationPostRequest(mdl='{"models":[]}')

    assert request.allow_data_preview is False
    assert request.use_dry_plan is True
    assert request.allow_dry_plan_fallback is False


def test_question_recommendation_service_defaults_to_planner_validation_without_fallback():
    request = QuestionRecommendation.Request(event_id="event-id", mdl='{"models":[]}')

    assert request.allow_data_preview is False
    assert request.use_dry_plan is True
    assert request.allow_dry_plan_fallback is False


@pytest.mark.asyncio
async def test_ask_service_does_not_require_historical_sql_shortcut():
    service = AskService(
        {
            "sql_pairs_retrieval": AsyncMock(
                run=AsyncMock(return_value={"formatted_output": {"documents": []}})
            ),
            "instructions_retrieval": AsyncMock(
                run=AsyncMock(return_value={"formatted_output": {"documents": []}})
            ),
            "intent_classification": AsyncMock(
                run=AsyncMock(
                    return_value={
                        "post_process": {
                            "intent": "MISLEADING_QUERY",
                            "reasoning": "No matching schema context.",
                        }
                    }
                )
            ),
            "misleading_assistance": AsyncMock(run=AsyncMock(return_value={})),
        }
    )
    request = AskRequest(query="Can this be answered?", id="deploy-id")
    request.query_id = "query-id"

    await service.ask(request)
    result = service.get_ask_result(AskResultRequest(query_id="query-id"))

    assert result.status == "finished"
    assert result.type == "GENERAL"
