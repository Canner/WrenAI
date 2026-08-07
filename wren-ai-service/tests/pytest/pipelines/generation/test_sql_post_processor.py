import pytest

from src.pipelines.generation.utils.sql import SQLGenPostProcessor


class _NoopEngine:
    async def execute_sql(self, *_, **__):
        raise AssertionError("execute_sql should not run for malformed output")


@pytest.mark.asyncio
async def test_post_processor_returns_generation_failure_for_truncated_json():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        ['{"sql": "SELECT'],
        meta=[{"finish_reason": "length"}],
    )

    assert result["valid_generation_result"] == {}
    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "SQL_GENERATION"
    assert invalid["sql"] == '{"sql": "SELECT'
    assert "valid JSON SQL response" in invalid["error"]


@pytest.mark.asyncio
async def test_post_processor_keeps_null_sql_as_generation_failure_for_correction():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        ['{"sql": null}'],
        meta=[{"finish_reason": "length"}],
    )

    assert result["valid_generation_result"] == {}
    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "SQL_GENERATION"
    assert invalid["sql"] == ""
    assert invalid["original_sql"] == ""
    assert "empty SQL response" in invalid["error"]


@pytest.mark.asyncio
async def test_post_processor_keeps_null_sql_without_finish_reason_as_generation_failure():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(['{"sql": null}'])

    assert result["valid_generation_result"] == {}
    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "SQL_GENERATION"
    assert invalid["sql"] == ""
    assert invalid["original_sql"] == ""
    assert "empty SQL response" in invalid["error"]


@pytest.mark.asyncio
async def test_post_processor_returns_generation_failure_for_missing_sql_key():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(['{"message": "done"}'])

    assert result["valid_generation_result"] == {}
    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "SQL_GENERATION"
    assert "valid JSON SQL response" in invalid["error"]
