import pytest

from src.pipelines.generation.utils.sql import SQLGenPostProcessor


class _NoopEngine:
    async def execute_sql(self, *_, **__):
        raise AssertionError("execute_sql should not run for malformed output")


class _CapturingEngine:
    def __init__(self):
        self.execute_kwargs = None
        self.dry_plan_kwargs = None

    async def execute_sql(self, *_, **kwargs):
        self.execute_kwargs = kwargs
        return True, {}, {"correlation_id": ""}

    async def dry_plan(self, *_, **kwargs):
        self.dry_plan_kwargs = kwargs
        return True, ""


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


@pytest.mark.asyncio
async def test_post_processor_passes_deployment_hash_to_dry_run_validation():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        ['{"sql": "SELECT 1"}'],
        project_id="project-id",
        mdl_hash="deploy-hash",
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs["project_id"] == "project-id"
    assert engine.execute_kwargs["mdl_hash"] == "deploy-hash"


@pytest.mark.asyncio
async def test_post_processor_passes_deployment_hash_to_dry_plan_validation():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        ['{"sql": "SELECT 1"}'],
        project_id="project-id",
        mdl_hash="deploy-hash",
        use_dry_plan=True,
    )

    assert result["invalid_generation_result"] == {}
    assert engine.dry_plan_kwargs["project_id"] == "project-id"
    assert engine.dry_plan_kwargs["mdl_hash"] == "deploy-hash"
