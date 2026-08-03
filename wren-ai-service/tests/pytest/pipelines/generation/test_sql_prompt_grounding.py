from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.sql_correction import (
    prompt as build_sql_correction_prompt,
    sql_correction_user_prompt_template,
)
from src.pipelines.generation.sql_generation import (
    prompt as build_sql_generation_prompt,
    sql_generation_user_prompt_template,
)


def test_sql_generation_prompt_omits_sample_sql_body():
    result = build_sql_generation_prompt(
        query="summarize the records",
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


def test_sql_correction_prompt_keeps_failed_sql_diagnostic_and_question():
    result = build_sql_correction_prompt(
        documents=[],
        invalid_generation_result={
            "sql": "SELECT 1",
            "error": "dry run failed",
        },
        query="summarize the records",
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "User's Question: summarize the records" in built_prompt
    assert "Failed SQL: SELECT 1" in built_prompt
    assert "DIAGNOSTIC CONTEXT" in built_prompt
