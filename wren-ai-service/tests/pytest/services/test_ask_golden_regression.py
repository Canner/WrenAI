import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.web.v1.services.ask import AskRequest, AskResultRequest, AskService


class RecordingPipeline(SimpleNamespace):
    def __init__(self, result=None):
        super().__init__(run=AsyncMock(return_value=result if result is not None else {}))


def _sql_generation_result(valid_sql=None, invalid_generation_result=None):
    return {
        "post_process": {
            "valid_generation_result": {"sql": valid_sql} if valid_sql else None,
            "invalid_generation_result": invalid_generation_result,
        }
    }


def build_ask_pipelines(scenario: dict) -> dict[str, RecordingPipeline]:
    return {
        "historical_question": RecordingPipeline(
            {"formatted_output": {"documents": scenario.get("historical_documents", [])}}
        ),
        "sql_pairs_retrieval": RecordingPipeline(
            {"formatted_output": {"documents": scenario.get("sql_pairs_documents", [])}}
        ),
        "instructions_retrieval": RecordingPipeline(
            {
                "formatted_output": {
                    "documents": scenario.get("instructions_documents", [])
                }
            }
        ),
        "intent_classification": RecordingPipeline(
            {
                "post_process": {
                    "intent": scenario.get("intent", "TEXT_TO_SQL"),
                    "db_schemas": scenario.get("db_schemas", []),
                    "reasoning": scenario.get("intent_reasoning", "needs sql"),
                    "rephrased_question": scenario.get("rephrased_question"),
                }
            }
        ),
        "db_schema_retrieval": RecordingPipeline(
            {
                "construct_retrieval_results": {
                    "retrieval_results": scenario.get("schema_documents", []),
                    "has_calculated_field": scenario.get(
                        "has_calculated_field", False
                    ),
                    "has_metric": scenario.get("has_metric", False),
                    "has_json_field": scenario.get("has_json_field", False),
                }
            }
        ),
        "sql_generation_reasoning": RecordingPipeline(
            {"post_process": scenario.get("sql_generation_reasoning", "reasoning")}
        ),
        "followup_sql_generation_reasoning": RecordingPipeline(
            {
                "post_process": scenario.get(
                    "followup_sql_generation_reasoning", "followup reasoning"
                )
            }
        ),
        "sql_generation": RecordingPipeline(
            _sql_generation_result(
                valid_sql=scenario.get("sql_generation", {}).get("valid_sql"),
                invalid_generation_result=scenario.get("sql_generation", {}).get(
                    "invalid_generation_result"
                ),
            )
        ),
        "followup_sql_generation": RecordingPipeline(
            _sql_generation_result(
                valid_sql=scenario.get("followup_sql_generation", {}).get("valid_sql"),
                invalid_generation_result=scenario.get(
                    "followup_sql_generation", {}
                ).get("invalid_generation_result"),
            )
        ),
        "sql_functions_retrieval": RecordingPipeline([]),
        "sql_knowledge_retrieval": RecordingPipeline([]),
        "sql_diagnosis": RecordingPipeline(
            {
                "post_process": {
                    "reasoning": scenario.get("sql_diagnosis_reasoning", "diagnosis")
                }
            }
        ),
        "sql_correction": RecordingPipeline(
            _sql_generation_result(
                valid_sql=scenario.get("sql_correction", {}).get("valid_sql"),
                invalid_generation_result=scenario.get("sql_correction", {}).get(
                    "invalid_generation_result"
                ),
            )
        ),
        "misleading_assistance": RecordingPipeline({"status": "ok"}),
        "data_assistance": RecordingPipeline({"status": "ok"}),
        "user_guide_assistance": RecordingPipeline({"status": "ok"}),
    }


def make_request(case: dict) -> AskRequest:
    request = AskRequest.model_validate(
        {
            "query": case["query"],
            "mdl_hash": "mdl-1",
            "histories": case.get("histories", []),
            "skills": case.get("skills", []),
        }
    )
    request.query_id = str(uuid.uuid4())
    return request


ASK_CASES = [
    {
        "name": "historical",
        "query": "本月 GMV",
        "scenario": {
            "historical_documents": [{"statement": "SELECT 1", "viewId": None}],
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "historical",
            "sql": "SELECT 1",
        },
    },
    {
        "name": "sql_pairs",
        "query": "本月 GMV",
        "scenario": {
            "sql_pairs_documents": [{"question": "GMV", "sql": "SELECT amount"}],
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "sql_generation": {"valid_sql": "SELECT amount FROM orders"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "sql_pairs",
            "sql": "SELECT amount FROM orders",
        },
    },
    {
        "name": "instructions",
        "query": "本月 GMV",
        "scenario": {
            "instructions_documents": [{"instruction": "仅统计已支付订单"}],
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "sql_generation": {"valid_sql": "SELECT paid_amount FROM orders"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "instructions",
            "sql": "SELECT paid_amount FROM orders",
        },
    },
    {
        "name": "nl2sql",
        "query": "本月 GMV",
        "scenario": {
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "sql_generation": {"valid_sql": "SELECT count(*) FROM orders"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "nl2sql",
            "sql": "SELECT count(*) FROM orders",
        },
    },
    {
        "name": "followup",
        "query": "那上个月呢",
        "histories": [{"question": "本月 GMV", "sql": "SELECT 1"}],
        "scenario": {
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "followup_sql_generation": {"valid_sql": "SELECT 2"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "followup",
            "sql": "SELECT 2",
            "isFollowup": True,
        },
    },
    {
        "name": "correction",
        "query": "本月 GMV",
        "scenario": {
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "sql_generation": {
                "invalid_generation_result": {
                    "type": "EXECUTION_ERROR",
                    "original_sql": "SELECT broken",
                    "sql": "SELECT broken",
                    "error": "syntax error",
                }
            },
            "sql_correction": {"valid_sql": "SELECT fixed_sql"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "correction",
            "sql": "SELECT fixed_sql",
        },
    },
    {
        "name": "general",
        "query": "你是谁",
        "scenario": {
            "intent": "GENERAL",
        },
        "expected": {
            "status": "finished",
            "type": "GENERAL",
            "path": "general",
            "generalType": "DATA_ASSISTANCE",
        },
    },
]


def assert_runtime_metadata(metadata: dict) -> None:
    assert metadata["ask_runtime_mode"] == "deepagents"
    assert metadata["primary_runtime"] == "deepagents"
    assert metadata["resolved_runtime"] == "deepagents"
    assert metadata["deepagents_fallback"] is False
    assert metadata.get("fallback_reason") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ASK_CASES, ids=lambda case: case["name"])
async def test_ask_golden_regression_baseline(case: dict):
    pipelines = build_ask_pipelines(case["scenario"])
    service = AskService(
        pipelines=pipelines,
        ask_runtime_mode="deepagents",
    )
    request = make_request(case)

    result = await service.ask(request)
    await asyncio.sleep(0)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))
    expected = case["expected"]

    assert ask_result.status == expected["status"]
    assert ask_result.type == expected["type"]
    assert result["metadata"]["type"] == expected["type"]
    assert result["metadata"]["ask_path"] == expected["path"]
    assert ask_result.ask_path == expected["path"]

    if expected["type"] == "TEXT_TO_SQL":
        assert ask_result.response is not None
        assert ask_result.response[0].sql == expected["sql"]
    else:
        assert ask_result.response is None
        assert ask_result.general_type == expected["generalType"]

    if expected.get("isFollowup") is not None:
        assert ask_result.is_followup == expected["isFollowup"]

    assert_runtime_metadata(result["metadata"])
