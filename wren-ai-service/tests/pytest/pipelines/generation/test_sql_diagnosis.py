import pytest

from src.pipelines.generation.sql_diagnosis import post_process


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
