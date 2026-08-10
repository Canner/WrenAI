import pytest
from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.followup_sql_generation import (
    generate_sql_in_followup,
    text_to_sql_with_followup_user_prompt_template,
)
from src.pipelines.generation.followup_sql_generation import (
    prompt as build_followup_sql_generation_prompt,
)
from src.pipelines.generation.followup_sql_generation_reasoning import (
    prompt as build_followup_sql_generation_reasoning_prompt,
)
from src.pipelines.generation.followup_sql_generation_reasoning import (
    sql_generation_reasoning_user_prompt_template as followup_reasoning_prompt_template,
)
from src.pipelines.generation.sql_correction import (
    generate_sql_correction,
    get_sql_correction_system_prompt,
    sql_correction_user_prompt_template,
)
from src.pipelines.generation.sql_correction import (
    prompt as build_sql_correction_prompt,
)
from src.pipelines.generation.sql_generation import (
    generate_sql,
    get_sql_generation_system_prompt,
    sql_generation_user_prompt_template,
)
from src.pipelines.generation.sql_generation import (
    prompt as build_sql_generation_prompt,
)
from src.pipelines.generation.sql_generation_reasoning import (
    prompt as build_sql_generation_reasoning_prompt,
)
from src.pipelines.generation.sql_generation_reasoning import (
    sql_generation_reasoning_user_prompt_template,
)
from src.pipelines.generation.sql_regeneration import (
    get_sql_regeneration_system_prompt,
    regenerate_sql,
    sql_regeneration_user_prompt_template,
)
from src.pipelines.generation.sql_regeneration import (
    prompt as build_sql_regeneration_prompt,
)
from src.pipelines.generation.sql_regeneration import (
    post_process as sql_regeneration_post_process,
)
from src.pipelines.generation.utils.sql import SQL_GENERATION_MODEL_KWARGS
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge


def test_sql_generation_system_prompt_uses_legacy_json_sql_contract():
    prompt = get_sql_generation_system_prompt()

    assert "<SQL_QUERY_STRING>" in prompt
    assert "The final answer must be a ANSI SQL query in JSON format" in prompt
    assert "return null for sql" not in prompt
    assert "RETRIEVED SCHEMA CONTRACT" not in prompt


def test_sql_generation_model_kwargs_require_sql_string():
    json_schema = SQL_GENERATION_MODEL_KWARGS["response_format"]["json_schema"]

    assert SQL_GENERATION_MODEL_KWARGS["preserve_json_schema"] is True
    assert json_schema["strict"] is True
    assert json_schema["schema"]["properties"]["sql"]["type"] == "string"
    assert json_schema["schema"]["additionalProperties"] is False


def test_sql_generation_prompt_uses_database_schema_documents():
    result = build_sql_generation_prompt(
        query="show orders from India",
        documents=['CREATE TABLE dbo_xStageNewOrders (ShipCountry VARCHAR)'],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_samples=[
            {
                "question": "show orders from Taiwan",
                "sql": "SELECT * FROM orders WHERE country = 'Taiwan'",
            }
        ],
    )

    built_prompt = result["prompt"]

    assert "CREATE TABLE dbo_xStageNewOrders" in built_prompt
    assert "ShipCountry" in built_prompt
    assert "SELECT * FROM orders" in built_prompt
    assert "RETRIEVED EXECUTABLE SCHEMA" not in built_prompt


def test_sql_generation_prompt_does_not_inject_datasource_dialect_section():
    result = build_sql_generation_prompt(
        query="show orders from last week",
        documents=['CREATE TABLE dbo_xStageNewOrders (OrderDate TIMESTAMP)'],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_functions=[
            SqlFunction(
                {
                    "name": "date_trunc",
                    "function_type": "scalar",
                    "description": "Truncates a timestamp to the specified precision.",
                }
            )
        ],
    )

    built_prompt = result["prompt"]

    assert "### SQL DIALECT ###" not in built_prompt
    assert "Configured data source: trino" not in built_prompt
    assert (
        "type: scalar, name: DATE_TRUNC, description: Truncates a timestamp to the specified precision."
        in built_prompt
    )


def test_reasoning_prompt_uses_schema_documents_only():
    result = build_sql_generation_reasoning_prompt(
        query="show orders from India",
        documents=['CREATE TABLE dbo_xStageNewOrders (ShipCountry VARCHAR)'],
        sql_samples=[
            {
                "question": "show orders from Taiwan",
                "sql": "SELECT * FROM orders WHERE country = 'Taiwan'",
            }
        ],
        instructions=[],
        prompt_builder=PromptBuilder(
            template=sql_generation_reasoning_user_prompt_template
        ),
    )

    built_prompt = result["prompt"]

    assert "CREATE TABLE dbo_xStageNewOrders" in built_prompt
    assert "SELECT * FROM orders" in built_prompt
    assert "RETRIEVED EXECUTABLE SCHEMA" not in built_prompt


def test_followup_reasoning_prompt_uses_history_and_schema_documents():
    result = build_followup_sql_generation_reasoning_prompt(
        query="from India",
        documents=['CREATE TABLE dbo_xStageNewOrders (ShipCountry VARCHAR)'],
        histories=[{"question": "show orders", "sql": "SELECT * FROM orders"}],
        sql_samples=[],
        instructions=[],
        prompt_builder=PromptBuilder(template=followup_reasoning_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "CREATE TABLE dbo_xStageNewOrders" in built_prompt
    assert "Question:\nshow orders" in built_prompt
    assert "SQL:\nSELECT * FROM orders" in built_prompt
    assert "RETRIEVED EXECUTABLE SCHEMA" not in built_prompt


def test_followup_sql_generation_prompt_uses_database_schema_documents():
    result = build_followup_sql_generation_prompt(
        query="show related orders",
        documents=["CREATE TABLE dbo_xStageNewOrders (ShipCountry VARCHAR)"],
        sql_generation_reasoning="",
        sql_samples=[
            {
                "summary": "show orders from Taiwan",
                "sql": "SELECT * FROM orders WHERE country = 'Taiwan'",
            }
        ],
        prompt_builder=PromptBuilder(
            template=text_to_sql_with_followup_user_prompt_template
        ),
    )

    built_prompt = result["prompt"]

    assert "CREATE TABLE dbo_xStageNewOrders" in built_prompt
    assert "SELECT * FROM orders" in built_prompt
    assert "RETRIEVED EXECUTABLE SCHEMA" not in built_prompt


def test_sql_correction_prompt_uses_failed_sql_and_error():
    result = build_sql_correction_prompt(
        documents=["CREATE TABLE model_1 (attribute_1 VARCHAR)"],
        invalid_generation_result={"sql": "SELECT 1", "error": "dry run failed"},
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "CREATE TABLE model_1" in built_prompt
    assert "SQL: SELECT 1" in built_prompt
    assert "Error Message: dry run failed" in built_prompt
    assert "RETRIEVED EXECUTABLE SCHEMA" not in built_prompt


def test_sql_correction_system_prompt_preserves_datasource_knowledge():
    sql_knowledge = SqlKnowledge(
        {
            "text_to_sql_rule": "Use Wren SQL from the engine.",
            "instructions": {
                "date_and_time_functionality": "Use CAST(<expr> AS DATE) for date casts.",
            },
        }
    )

    prompt = get_sql_correction_system_prompt(sql_knowledge)

    assert "Use Wren SQL from the engine." in prompt


def test_sql_regeneration_prompt_uses_legacy_inputs_without_datasource_dialect():
    result = build_sql_regeneration_prompt(
        documents=["CREATE TABLE model_1 (attribute_1 VARCHAR)"],
        sql_generation_reasoning="reason about the schema",
        sql="SELECT 1",
        prompt_builder=PromptBuilder(template=sql_regeneration_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "CREATE TABLE model_1" in built_prompt
    assert "SQL generation reasoning: reason about the schema" in built_prompt
    assert "Original SQL query: SELECT 1" in built_prompt
    assert "Configured data source: trino" not in built_prompt
    assert "RETRIEVED EXECUTABLE SCHEMA" not in built_prompt


def test_sql_regeneration_system_prompt_uses_json_sql_contract():
    prompt = get_sql_regeneration_system_prompt()

    assert "<SQL_QUERY_STRING>" in prompt
    assert "The final answer must be a ANSI SQL query in JSON format" in prompt


@pytest.mark.asyncio
async def test_sql_regeneration_post_process_preserves_deployment_hash():
    captured = {}

    class CapturingPostProcessor:
        async def run(self, replies, **kwargs):
            captured["replies"] = replies
            captured.update(kwargs)
            return {
                "valid_generation_result": {"sql": "SELECT 1"},
                "invalid_generation_result": {},
            }

    await sql_regeneration_post_process(
        regenerate_sql={"replies": ['{"sql": "SELECT 1"}']},
        post_processor=CapturingPostProcessor(),
        project_id="project-id",
        mdl_hash="deployment-hash",
    )

    assert captured["replies"] == ['{"sql": "SELECT 1"}']
    assert captured["project_id"] == "project-id"
    assert captured["mdl_hash"] == "deployment-hash"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "generate_fn,extra_kwargs",
    [
        (generate_sql, {}),
        (generate_sql_in_followup, {"histories": []}),
        (generate_sql_correction, {}),
        (regenerate_sql, {}),
    ],
)
async def test_sql_generation_calls_do_not_inject_runtime_output_budget(
    generate_fn,
    extra_kwargs,
):
    captured_kwargs = {}

    async def fake_generator(**kwargs):
        captured_kwargs.update(kwargs)
        return {"replies": ['{"sql": "SELECT 1"}'], "meta": [{"finish_reason": "stop"}]}

    await generate_fn(
        prompt={"prompt": "Return SQL"},
        generator=fake_generator,
        generator_name="test-model",
        **extra_kwargs,
    )

    assert "generation_kwargs" not in captured_kwargs
