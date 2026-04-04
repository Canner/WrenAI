import asyncio
import json
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.core import SkillRunnerExecutionResponse
from src.web.v1.services.ask import AskRequest, AskResultRequest, AskService

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "data"


class RecordingPipeline(SimpleNamespace):
    def __init__(self, result=None):
        super().__init__(run=AsyncMock(return_value=result if result is not None else {}))


class SkillRunnerClientStub:
    def __init__(self, config: dict | None):
        self.enabled = bool(config and config.get("enabled", True))
        self.run = AsyncMock()
        self.get_result = AsyncMock()

        if not config:
            return

        run_response = config.get("run_response")
        result_response = config.get("result_response")

        if run_response is not None:
            self.run.return_value = SkillRunnerExecutionResponse.model_validate(
                run_response
            )

        if result_response is not None:
            self.get_result.return_value = SkillRunnerExecutionResponse.model_validate(
                result_response
            )


def load_cases(file_name: str) -> list[dict]:
    return json.loads((FIXTURES_DIR / file_name).read_text())


ASK_GOLDEN_CASES = load_cases("ask_golden_cases.json")


def _sql_generation_result(config: dict | None) -> dict:
    config = config or {}
    valid_sql = config.get("valid_sql")
    return {
        "post_process": {
            "valid_generation_result": {"sql": valid_sql} if valid_sql else None,
            "invalid_generation_result": config.get("invalid_generation_result"),
        }
    }


def build_ask_pipelines(case: dict) -> dict[str, RecordingPipeline]:
    scenario = case.get("scenario", {})
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
            _sql_generation_result(scenario.get("sql_generation"))
        ),
        "followup_sql_generation": RecordingPipeline(
            _sql_generation_result(scenario.get("followup_sql_generation"))
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
            _sql_generation_result(scenario.get("sql_correction"))
        ),
        "misleading_assistance": RecordingPipeline({"status": "ok"}),
        "data_assistance": RecordingPipeline({"status": "ok"}),
        "user_guide_assistance": RecordingPipeline({"status": "ok"}),
    }


def make_request(case: dict) -> AskRequest:
    payload = {
        "query": case["query"],
        "mdl_hash": "mdl-1",
        "histories": case.get("histories", []),
        "skills": case.get("skills", []),
    }
    if case.get("runtimeIdentity") is not None:
        payload["runtimeIdentity"] = case["runtimeIdentity"]
    if case.get("actorClaims") is not None:
        payload["actorClaims"] = case["actorClaims"]
    if case.get("skillConfig") is not None:
        payload["skillConfig"] = case["skillConfig"]
    request = AskRequest.model_validate(payload)
    request.query_id = str(uuid.uuid4())
    return request


def assert_path_specific_signals(case: dict, pipelines: dict, skill_runner_client):
    expected_path = case["expected"]["path"]
    scenario = case.get("scenario", {})

    if expected_path == "historical":
        assert pipelines["db_schema_retrieval"].run.await_count == 0
        assert pipelines["sql_generation"].run.await_count == 0
    elif expected_path == "sql_pairs":
        assert pipelines["sql_generation"].run.await_count == 1
        assert (
            pipelines["sql_generation"].run.await_args.kwargs["sql_samples"]
            == scenario["sql_pairs_documents"]
        )
        assert (
            pipelines["sql_generation"].run.await_args.kwargs["instructions"] == []
        )
    elif expected_path == "instructions":
        assert pipelines["sql_generation"].run.await_count == 1
        assert (
            pipelines["sql_generation"].run.await_args.kwargs["instructions"]
            == scenario["instructions_documents"]
        )
    elif expected_path == "nl2sql":
        assert pipelines["sql_generation"].run.await_count == 1
        assert pipelines["sql_generation"].run.await_args.kwargs["sql_samples"] == []
        assert pipelines["sql_generation"].run.await_args.kwargs["instructions"] == []
    elif expected_path == "correction":
        assert pipelines["sql_generation"].run.await_count == 1
        assert pipelines["sql_diagnosis"].run.await_count == 1
        assert pipelines["sql_correction"].run.await_count == 1
        assert (
            pipelines["sql_correction"].run.await_args.kwargs[
                "invalid_generation_result"
            ]["sql"]
            == scenario["sql_generation"]["invalid_generation_result"]["original_sql"]
        )
    elif expected_path == "general":
        assert pipelines["db_schema_retrieval"].run.await_count == 0
        assert pipelines["sql_generation"].run.await_count == 0
        assert pipelines["data_assistance"].run.await_count == 1
    elif expected_path == "followup":
        assert pipelines["followup_sql_generation_reasoning"].run.await_count == 1
        assert pipelines["followup_sql_generation"].run.await_count == 1
        assert pipelines["sql_generation"].run.await_count == 0
    elif expected_path == "skill":
        assert skill_runner_client is not None
        assert skill_runner_client.run.await_count == 1
        assert skill_runner_client.get_result.await_count == 1
        assert pipelines["db_schema_retrieval"].run.await_count == 0
        assert pipelines["sql_generation"].run.await_count == 0


def assert_runtime_signals(case: dict, metadata: dict):
    expected_path = case["expected"]["path"]

    assert metadata["ask_runtime_mode"] == "deepagents"
    assert metadata["primary_runtime"] == "deepagents"

    if expected_path == "skill":
        assert metadata["resolved_runtime"] == "deepagents"
        assert metadata["deepagents_fallback"] is False
        assert metadata.get("fallback_reason") is None
        assert metadata.get("deepagents_routing_reason") is None
    else:
        assert metadata["resolved_runtime"] == "legacy"
        assert metadata["deepagents_fallback"] is True
        assert metadata["fallback_reason"] == "skill_runner_unavailable"
        assert metadata["deepagents_routing_reason"] == "skill_runner_unavailable"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ASK_GOLDEN_CASES, ids=lambda case: case["name"])
async def test_ask_golden_regression_baseline(case: dict):
    pipelines = build_ask_pipelines(case)
    skill_runner_config = case.get("scenario", {}).get("skill_runner")
    skill_runner_client = (
        SkillRunnerClientStub(skill_runner_config) if skill_runner_config else None
    )
    service = AskService(
        pipelines=pipelines,
        ask_runtime_mode="deepagents",
        skill_runner_client=skill_runner_client,
    )
    request = make_request(case)

    result = await service.ask(request)
    await asyncio.sleep(0)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))
    expected = case["expected"]

    assert ask_result.status == expected["status"], case["allowed_variance"]
    assert ask_result.type == expected["type"], case["allowed_variance"]
    assert result["metadata"]["type"] == expected["type"], case["allowed_variance"]
    assert result["metadata"]["ask_path"] == expected["path"], case["allowed_variance"]
    assert ask_result.ask_path == expected["path"], case["allowed_variance"]

    if expected["type"] == "TEXT_TO_SQL":
        assert ask_result.response is not None
        assert ask_result.response[0].sql == expected["sql"]
        if "resultType" in expected:
            assert ask_result.response[0].type == expected["resultType"]
        if "viewId" in expected:
            assert ask_result.response[0].viewId == expected["viewId"]
        if "retrievedTables" in expected:
            assert ask_result.retrieved_tables == expected["retrievedTables"]
    elif expected["type"] == "GENERAL":
        assert ask_result.general_type == expected["generalType"]
        assert ask_result.response is None
    elif expected["type"] == "SKILL":
        assert ask_result.skill_result is not None
        assert ask_result.skill_result.result_type == expected["skillResultType"]
        assert ask_result.skill_result.text == expected["skillText"]

    if expected.get("isFollowup") is not None:
        assert ask_result.is_followup == expected["isFollowup"]

    assert_runtime_signals(case, result["metadata"])
    assert_path_specific_signals(case, pipelines, skill_runner_client)
