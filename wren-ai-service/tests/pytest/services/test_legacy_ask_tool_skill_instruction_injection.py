from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.core.deepagents_orchestrator import DeepAgentsAskOrchestrator
from src.core.legacy_ask_tool import LegacyAskTool, extract_skill_instructions


class PipelineStub(SimpleNamespace):
    def __init__(self, result=None):
        super().__init__(run=AsyncMock(return_value=result if result is not None else {}))


def make_pipelines(*, historical_documents=None, instructions=None):
    return {
        "historical_question": PipelineStub(
            {
                "formatted_output": {
                    "documents": historical_documents or [],
                }
            }
        ),
        "sql_pairs_retrieval": PipelineStub({"formatted_output": {"documents": []}}),
        "instructions_retrieval": PipelineStub(
            {"formatted_output": {"documents": instructions or []}}
        ),
        "intent_classification": PipelineStub(
            {
                "post_process": {
                    "intent": "TEXT_TO_SQL",
                    "reasoning": "needs sql",
                    "db_schemas": [],
                }
            }
        ),
        "db_schema_retrieval": PipelineStub(
            {
                "construct_retrieval_results": {
                    "retrieval_results": [
                        {
                            "table_name": "orders",
                            "table_ddl": "CREATE TABLE orders (id bigint);",
                        }
                    ],
                    "has_calculated_field": False,
                    "has_metric": False,
                    "has_json_field": False,
                }
            }
        ),
        "sql_generation_reasoning": PipelineStub({"post_process": "reasoning"}),
        "followup_sql_generation_reasoning": PipelineStub(
            {"post_process": "followup reasoning"}
        ),
        "sql_generation": PipelineStub(
            {
                "post_process": {
                    "valid_generation_result": {"sql": "SELECT 1"},
                    "invalid_generation_result": None,
                }
            }
        ),
        "followup_sql_generation": PipelineStub(
            {
                "post_process": {
                    "valid_generation_result": {"sql": "SELECT 2"},
                    "invalid_generation_result": None,
                }
            }
        ),
        "sql_functions_retrieval": PipelineStub([]),
        "sql_knowledge_retrieval": PipelineStub([]),
        "sql_diagnosis": PipelineStub({"post_process": {"reasoning": "diagnosis"}}),
        "sql_correction": PipelineStub(
            {
                "post_process": {
                    "valid_generation_result": {"sql": "SELECT 3"},
                    "invalid_generation_result": None,
                }
            }
        ),
        "misleading_assistance": PipelineStub({"status": "ok"}),
        "data_assistance": PipelineStub({"status": "ok"}),
        "user_guide_assistance": PipelineStub({"status": "ok"}),
    }


def make_request(*, skills=None):
    return SimpleNamespace(
        query="本月 GMV",
        query_id="query-1",
        configurations=SimpleNamespace(language="zh-CN"),
        custom_instruction=None,
        ignore_sql_generation_reasoning=False,
        enable_column_pruning=False,
        use_dry_plan=False,
        allow_dry_plan_fallback=True,
        request_from="ui",
        skills=skills or [],
    )


async def run_tool(tool, *, ask_request, histories=None):
    updates = []
    result = await tool.run(
        ask_request=ask_request,
        query_id=ask_request.query_id,
        trace_id="trace-1",
        histories=histories or [],
        runtime_scope_id="kb-1",
        retrieval_scope_id="kb-1",
        is_followup=bool(histories),
        is_stopped=lambda: False,
        set_result=lambda **payload: updates.append(payload),
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )
    return result, updates


def test_extract_skill_instructions_only_keeps_non_empty_skill_definition_instructions():
    instructions = extract_skill_instructions(
        [
            SimpleNamespace(
                skill_id="inject-1",
                skill_name="inject",
                instruction="  仅回答 GMV  ",
                execution_mode="inject_only",
            ),
            SimpleNamespace(
                skill_id="blank-1",
                skill_name="blank",
                instruction="   ",
                execution_mode="inject_only",
            ),
            SimpleNamespace(
                skill_id="none-1",
                skill_name="none",
                instruction=None,
                execution_mode="inject_only",
            ),
        ]
    )

    assert instructions == [
        {
            "instruction": "仅回答 GMV",
            "source": "skill_definition",
            "skill_id": "inject-1",
            "skill_name": "inject",
            "execution_mode": "inject_only",
        }
    ]


@pytest.mark.asyncio
async def test_legacy_runtime_short_circuits_historical_before_intent_and_instruction_merge():
    pipelines = make_pipelines(
        historical_documents=[
            {"statement": "SELECT 1", "viewId": None},
        ]
    )
    ask_request = make_request(
        skills=[
            SimpleNamespace(
                skill_id="skill-1",
                skill_name="gmv_skill",
                instruction="只返回 GMV 相关 SQL",
                execution_mode="inject_only",
            )
        ]
    )

    result, _ = await run_tool(LegacyAskTool(pipelines=pipelines), ask_request=ask_request)

    assert pipelines["intent_classification"].run.await_count == 0
    assert pipelines["sql_pairs_retrieval"].run.await_count == 0
    assert pipelines["instructions_retrieval"].run.await_count == 0
    assert pipelines["db_schema_retrieval"].run.await_count == 0
    assert result["metadata"]["ask_path"] == "historical"
    assert result["metadata"]["orchestrator"] == "legacy"


@pytest.mark.asyncio
async def test_deepagents_runtime_merges_skill_instructions_before_historical_short_circuit():
    pipelines = make_pipelines(
        historical_documents=[
            {"statement": "SELECT 1", "viewId": None},
        ],
        instructions=[{"instruction": "已有规则"}],
    )
    ask_request = make_request(
        skills=[
            SimpleNamespace(
                skill_id="skill-1",
                skill_name="gmv_skill",
                instruction="只返回 GMV 相关 SQL",
                execution_mode="inject_only",
            )
        ]
    )

    result, _ = await run_tool(
        DeepAgentsAskOrchestrator(pipelines=pipelines),
        ask_request=ask_request,
    )

    assert pipelines["intent_classification"].run.await_count == 1
    assert pipelines["historical_question"].run.await_count == 1
    assert pipelines["db_schema_retrieval"].run.await_count == 0
    assert pipelines["intent_classification"].run.await_args.kwargs["instructions"] == [
        {"instruction": "已有规则"},
        {
            "instruction": "只返回 GMV 相关 SQL",
            "source": "skill_definition",
            "skill_id": "skill-1",
            "skill_name": "gmv_skill",
            "execution_mode": "inject_only",
        },
    ]
    assert result["metadata"]["ask_path"] == "historical"
    assert result["metadata"]["orchestrator"] == "deepagents"
