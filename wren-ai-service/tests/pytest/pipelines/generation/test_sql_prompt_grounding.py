from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.sql_correction import (
    get_sql_correction_system_prompt,
    prompt as build_sql_correction_prompt,
    sql_correction_user_prompt_template,
)
from src.pipelines.generation.followup_sql_generation import (
    prompt as build_followup_sql_generation_prompt,
    text_to_sql_with_followup_user_prompt_template,
)
from src.pipelines.generation.sql_generation import (
    get_sql_generation_system_prompt,
    prompt as build_sql_generation_prompt,
    sql_generation_user_prompt_template,
)
from src.pipelines.generation.sql_regeneration import (
    prompt as build_sql_regeneration_prompt,
    sql_regeneration_user_prompt_template,
)
from src.pipelines.generation.utils.sql import SQL_GENERATION_MODEL_KWARGS


def test_sql_generation_system_prompt_uses_schema_without_extra_catalog_layer():
    prompt = get_sql_generation_system_prompt()

    assert "DATABASE SCHEMA section as the only source" in prompt
    assert "Do not use pretrained knowledge" in prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in prompt
    assert "return null for sql instead of choosing one" not in prompt
    assert 'ONLY USE "*" if the user query asks' in prompt


def test_sql_correction_system_prompt_uses_current_schema_for_repair():
    prompt = get_sql_correction_system_prompt()

    assert "regenerate one grounded Wren SQL query" in prompt
    assert "DATABASE SCHEMA" in prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in prompt
    assert 'ONLY USE "*" if the user query asks' in prompt


def test_sql_generation_model_kwargs_include_overridable_output_budget():
    assert SQL_GENERATION_MODEL_KWARGS["max_tokens"] == 4096
    assert SQL_GENERATION_MODEL_KWARGS["response_format"]["type"] == "json_schema"


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
