import pytest
from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.sql_diagnosis import (
    prompt,
    post_process,
    sql_diagnosis_system_prompt,
    sql_diagnosis_user_prompt_template,
)


TEST_PROJECT_ID = "test-project-id"
TEST_MDL_HASH = "test-mdl-hash"
MODEL_TABLE_NAME = "model_1"
MODEL_COLUMN_NAME = "attribute_1"
UNKNOWN_COLUMN_NAME = "missing_column"


def _assert_deployment_scope(prompt_text: str) -> None:
    assert f"Project ID: {TEST_PROJECT_ID}" in prompt_text
    assert f"MDL Hash: {TEST_MDL_HASH}" in prompt_text


def _table_ddl() -> str:
    return f"CREATE TABLE {MODEL_TABLE_NAME} ({MODEL_COLUMN_NAME} VARCHAR)"


def _invalid_column_sql() -> str:
    return f"SELECT {UNKNOWN_COLUMN_NAME} FROM {MODEL_TABLE_NAME}"


def test_sql_diagnosis_uses_database_schema_as_identifier_authority():
    assert "DATABASE SCHEMA as the only source" in sql_diagnosis_system_prompt
    assert "diagnose that identifier as ungrounded" in sql_diagnosis_system_prompt


def test_sql_diagnosis_prompt_includes_deployment_scope():
    result = prompt(
        documents=[_table_ddl()],
        original_sql=_invalid_column_sql(),
        invalid_sql=_invalid_column_sql(),
        error_message="Invalid column",
        language="English",
        project_id=TEST_PROJECT_ID,
        mdl_hash=TEST_MDL_HASH,
        prompt_builder=PromptBuilder(template=sql_diagnosis_user_prompt_template),
    )

    _assert_deployment_scope(result["prompt"])
    assert f"CREATE TABLE {MODEL_TABLE_NAME}" in result["prompt"]


@pytest.mark.asyncio
async def test_sql_diagnosis_post_process_handles_empty_reply():
    result = await post_process({"replies": [""]})

    assert result == {"reasoning": ""}


@pytest.mark.asyncio
async def test_sql_diagnosis_post_process_handles_invalid_json():
    result = await post_process({"replies": ["not json"]})

    assert result == {"reasoning": ""}


@pytest.mark.asyncio
async def test_sql_diagnosis_post_process_normalizes_reasoning():
    result = await post_process({"replies": ['{"reasoning": "bad column"}']})

    assert result == {"reasoning": "bad column"}
