import pytest

from src.pipelines.generation.sql_tables_extraction import post_process


@pytest.mark.asyncio
async def test_sql_tables_extraction_post_process_returns_tables():
    result = await post_process({"replies": ['{"tables": ["model_a", "model_b"]}']})

    assert result == ["model_a", "model_b"]


@pytest.mark.asyncio
async def test_sql_tables_extraction_post_process_handles_missing_tables_key():
    result = await post_process({"replies": ['{"message": "no tables"}']})

    assert result == []


@pytest.mark.asyncio
async def test_sql_tables_extraction_post_process_handles_invalid_json():
    result = await post_process({"replies": ["not json"]})

    assert result == []
