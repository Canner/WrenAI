from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.core import DeepAgentsAskOrchestrator


class PipelineStub(SimpleNamespace):
    def __init__(self, result=None):
        super().__init__(run=AsyncMock(return_value=result if result is not None else {}))


def make_pipelines(
    *,
    historical_documents=None,
    sql_pairs_documents=None,
    instructions_documents=None,
    schema_documents=None,
    valid_sql="SELECT 1",
):
    return {
        "historical_question": PipelineStub(
            {"formatted_output": {"documents": historical_documents or []}}
        ),
        "sql_pairs_retrieval": PipelineStub(
            {"formatted_output": {"documents": sql_pairs_documents or []}}
        ),
        "instructions_retrieval": PipelineStub(
            {"formatted_output": {"documents": instructions_documents or []}}
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
                    "retrieval_results": schema_documents
                    or [
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
                    "valid_generation_result": {"sql": valid_sql},
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


async def run_orchestrator(*, pipelines, ask_request, histories=None):
    orchestrator = DeepAgentsAskOrchestrator(pipelines=pipelines)
    updates = []

    result = await orchestrator.run(
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


@pytest.mark.asyncio
async def test_deepagents_prepares_sql_pairs_and_skill_instructions_before_intent():
    pipelines = make_pipelines(
        sql_pairs_documents=[{"question": "GMV", "sql": "SELECT amount FROM orders"}],
        instructions_documents=[{"instruction": "已有规则"}],
    )
    ask_request = make_request(
        skills=[
            SimpleNamespace(
                skill_id="skill-1",
                skill_name="gmv_skill",
                instruction="只返回 GMV 相关 SQL",
            )
        ]
    )

    result, _ = await run_orchestrator(pipelines=pipelines, ask_request=ask_request)

    expected_instructions = [
        {"instruction": "已有规则"},
        {
            "instruction": "只返回 GMV 相关 SQL",
            "source": "skill_definition",
            "skill_id": "skill-1",
            "skill_name": "gmv_skill",
            "execution_mode": "inject_only",
        },
    ]

    assert pipelines["intent_classification"].run.await_args.kwargs["sql_samples"] == [
        {"question": "GMV", "sql": "SELECT amount FROM orders"}
    ]
    assert pipelines["intent_classification"].run.await_args.kwargs["instructions"] == (
        expected_instructions
    )
    assert pipelines["sql_generation"].run.await_args.kwargs["instructions"] == (
        expected_instructions
    )
    assert result["metadata"]["orchestrator"] == "deepagents"
    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert result["ask_result"][0]["sql"] == "SELECT 1"


@pytest.mark.asyncio
async def test_deepagents_historical_hit_short_circuits_schema_and_generation():
    pipelines = make_pipelines(
        historical_documents=[
            {
                "statement": "SELECT 99",
                "viewId": "view-1",
            }
        ],
        instructions_documents=[{"instruction": "已有规则"}],
    )

    result, updates = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(
            skills=[
                SimpleNamespace(
                    skill_id="skill-1",
                    skill_name="gmv_skill",
                    instruction="仅统计已支付订单",
                )
            ]
        ),
    )

    assert pipelines["intent_classification"].run.await_count == 1
    assert pipelines["historical_question"].run.await_count == 1
    assert pipelines["db_schema_retrieval"].run.await_count == 0
    assert pipelines["sql_generation"].run.await_count == 0
    assert result["metadata"]["ask_path"] == "historical"
    assert result["ask_result"] == [
        {
            "sql": "SELECT 99",
            "type": "view",
            "viewId": "view-1",
        }
    ]
    assert updates[-1]["status"] == "finished"
    assert updates[-1]["type"] == "TEXT_TO_SQL"
