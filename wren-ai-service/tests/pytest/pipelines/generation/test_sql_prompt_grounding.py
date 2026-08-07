import pytest
from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.sql_correction import (
    generate_sql_correction,
    get_sql_correction_system_prompt,
    prompt as build_sql_correction_prompt,
    sql_correction_user_prompt_template,
)
from src.pipelines.generation.followup_sql_generation import (
    generate_sql_in_followup,
    prompt as build_followup_sql_generation_prompt,
    text_to_sql_with_followup_user_prompt_template,
)
from src.pipelines.generation.sql_generation import (
    generate_sql,
    get_sql_generation_system_prompt,
    prompt as build_sql_generation_prompt,
    sql_generation_user_prompt_template,
)
from src.pipelines.generation.sql_regeneration import (
    regenerate_sql,
    get_sql_regeneration_system_prompt,
    prompt as build_sql_regeneration_prompt,
    sql_regeneration_user_prompt_template,
)
from src.pipelines.generation.utils.sql import SQL_GENERATION_MODEL_KWARGS


def test_sql_generation_system_prompt_uses_schema_without_extra_catalog_layer():
    prompt = get_sql_generation_system_prompt()

    assert "DATABASE SCHEMA is the only source" in prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in prompt
    assert "WREN RETRIEVED SEMANTIC CONTEXT" not in prompt
    assert "return null for sql instead of choosing one" not in prompt
    assert 'ONLY USE "*" if the user query asks' in prompt
    assert (
        "COUNT, SUM, AVG, MIN, and MAX do not need to appear in SQL FUNCTIONS"
        in prompt
    )
    assert "every non-standard function only from SQL FUNCTIONS" in prompt


def test_sql_correction_system_prompt_uses_current_schema_for_repair():
    prompt = get_sql_correction_system_prompt()

    assert "regenerate one grounded Wren SQL query" in prompt
    assert "DATABASE SCHEMA" in prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in prompt
    assert 'ONLY USE "*" if the user query asks' in prompt
    assert (
        "Standard Wren SQL aggregate functions COUNT, SUM, AVG, MIN, and MAX are allowed"
        in prompt
    )


def test_sql_regeneration_system_prompt_allows_standard_aggregates_without_sql_functions():
    prompt = get_sql_regeneration_system_prompt()

    assert "standard Wren SQL aggregate functions when needed" in prompt
    assert "SQL FUNCTIONS for non-standard functions" in prompt


def test_sql_generation_model_kwargs_set_legacy_output_budget():
    assert SQL_GENERATION_MODEL_KWARGS["max_tokens"] == 8192
    assert SQL_GENERATION_MODEL_KWARGS["response_format"]["type"] == "json_schema"


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
async def test_sql_generation_calls_pass_legacy_output_budget(
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

    assert captured_kwargs["generation_kwargs"]["max_tokens"] == 8192


def test_sql_generation_prompt_omits_sample_sql_body():
    result = build_sql_generation_prompt(
        query="summarize model records",
        documents=[],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_samples=[
            {
                "question": "sample intent",
                "sql": "SELECT 1",
            }
        ],
    )

    built_prompt = result["prompt"]

    assert "sample intent" in built_prompt
    assert "SELECT 1" not in built_prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in built_prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in built_prompt


def test_followup_sql_generation_prompt_uses_retrieved_schema_context():
    result = build_followup_sql_generation_prompt(
        query="show related model records",
        documents=["CREATE TABLE model_1 (attribute_1 VARCHAR)"],
        sql_generation_reasoning="",
        prompt_builder=PromptBuilder(
            template=text_to_sql_with_followup_user_prompt_template
        ),
    )

    assert "CREATE TABLE model_1" in result["prompt"]
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in result["prompt"]
    assert "WREN SQL IDENTIFIER CONTRACT" not in result["prompt"]


def test_sql_correction_prompt_keeps_failed_sql_diagnostic_and_question():
    result = build_sql_correction_prompt(
        documents=[],
        invalid_generation_result={
            "sql": "SELECT 1",
            "error": "dry run failed",
        },
        query="summarize model records",
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "User's Question: summarize model records" in built_prompt
    assert "Failed SQL: SELECT 1" in built_prompt
    assert "DIAGNOSTIC CONTEXT" in built_prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in built_prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in built_prompt


def test_sql_regeneration_prompt_uses_current_schema_without_failed_sql_body():
    result = build_sql_regeneration_prompt(
        query="summarize model records",
        documents=["CREATE TABLE model_1 (attribute_1 VARCHAR)"],
        sql_generation_reasoning="",
        sql="SELECT 1",
        prompt_builder=PromptBuilder(template=sql_regeneration_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "CREATE TABLE model_1" in built_prompt
    assert "The original SQL is intentionally omitted" in built_prompt
    assert "SELECT 1" not in built_prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in built_prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in built_prompt
