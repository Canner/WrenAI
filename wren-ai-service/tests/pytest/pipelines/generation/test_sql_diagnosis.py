import pytest

from src.pipelines.generation.sql_diagnosis import (
    post_process,
    sql_diagnosis_system_prompt,
)


def test_sql_diagnosis_uses_database_schema_as_identifier_authority():
    assert "DATABASE SCHEMA as the only source" in sql_diagnosis_system_prompt
    assert "diagnose that identifier as ungrounded" in sql_diagnosis_system_prompt


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
