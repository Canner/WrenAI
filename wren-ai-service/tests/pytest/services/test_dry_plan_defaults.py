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
    assert request.ignore_sql_generation_reasoning is True


def test_ask_request_allows_explicit_planner_override():
    request = AskRequest(
        query="How many records are available?",
        id="deploy-id",
        use_dry_plan=False,
        allow_dry_plan_fallback=True,
    )

    assert request.use_dry_plan is False
    assert request.allow_dry_plan_fallback is True


def test_ask_service_defaults_to_column_pruning():
    service = AskService({})

    assert service._enable_column_pruning is True
    assert service._allow_sql_generation_reasoning is False
    assert service._max_sql_correction_retries == 3


@pytest.mark.asyncio
async def test_sql_correction_service_requires_retrieved_tables():
    sql_tables_extraction = AsyncMock(run=AsyncMock(return_value={"post_process": []}))
    service = SqlCorrectionService({"sql_tables_extraction": sql_tables_extraction})
    request = SqlCorrectionService.CorrectionRequest(
        event_id="event-id",
        sql="SELECT 1",
        error="dry run failed",
    )

    await service.correct(request)
    result = service["event-id"]

    assert result.status == "failed"
    assert "retrieved table context" in result.error.message
    assert result.invalid_sql is None
    sql_tables_extraction.run.assert_not_called()


@pytest.mark.asyncio
async def test_ask_service_skips_speculative_reasoning_and_corrects_with_retrieved_schema():
    sql_generation_reasoning = AsyncMock(run=AsyncMock(return_value={}))
    sql_correction = AsyncMock(
        run=AsyncMock(
            return_value={
                "post_process": {
                    "valid_generation_result": {
                        "sql": "SELECT retrieved_field FROM retrieved_model"
                    },
                    "invalid_generation_result": {},
                }
            }
        )
    )
    service = AskService(
        {
            "sql_pairs_retrieval": AsyncMock(
                run=AsyncMock(return_value={"formatted_output": {"documents": []}})
            ),
            "instructions_retrieval": AsyncMock(
                run=AsyncMock(return_value={"formatted_output": {"documents": []}})
            ),
            "db_schema_retrieval": AsyncMock(
                run=AsyncMock(
                    return_value={
                        "construct_retrieval_results": {
                            "retrieval_results": [
                                {
                                    "table_name": "retrieved_model",
                                    "table_ddl": "CREATE TABLE retrieved_model (retrieved_field VARCHAR);",
                                }
                            ],
                            "has_calculated_field": False,
                            "has_metric": False,
                            "has_json_field": False,
                        }
                    }
                )
            ),
            "sql_functions_retrieval": AsyncMock(run=AsyncMock(return_value=[])),
            "sql_knowledge_retrieval": AsyncMock(run=AsyncMock(return_value=None)),
            "sql_generation_reasoning": sql_generation_reasoning,
            "sql_generation": AsyncMock(
                run=AsyncMock(
                    return_value={
                        "post_process": {
                            "valid_generation_result": {},
                            "invalid_generation_result": {
                                "type": "DRY_RUN",
                                "sql": "SELECT 1",
                                "original_sql": "SELECT 1",
                                "error": "dry run failed",
                            },
                        }
                    }
                )
            ),
            "sql_correction": sql_correction,
        },
        allow_intent_classification=False,
        allow_sql_diagnosis=False,
    )
    request = AskRequest(query="Can this be answered?", id="deploy-id")
    request.query_id = "query-id"

    await service.ask(request)
    result = service.get_ask_result(AskResultRequest(query_id="query-id"))

    assert result.status == "finished"
    assert result.response[0].sql == "SELECT retrieved_field FROM retrieved_model"
    assert result.invalid_sql is None
    sql_generation_reasoning.run.assert_not_called()
    sql_correction.run.assert_called_once()
    assert sql_correction.run.call_args.kwargs["contexts"] == [
        "CREATE TABLE retrieved_model (retrieved_field VARCHAR);"
    ]


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
