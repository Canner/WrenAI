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


class _FailingEngine:
    async def execute_sql(self, *_, **__):
        return (
            False,
            {},
            {
                "error_message": "Invalid object name 'orders'.",
                "error_sql": "SELECT * FROM orders",
                "correlation_id": "cid",
            },
        )

    async def dry_plan(self, *_, **__):
        return True, ""


@pytest.mark.asyncio
async def test_post_processor_returns_empty_invalid_result_for_truncated_json():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        ['{"sql": "SELECT'],
        meta=[{"finish_reason": "length"}],
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_post_processor_returns_empty_invalid_result_for_null_sql():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        ['{"sql": null}'],
        meta=[{"finish_reason": "length"}],
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_post_processor_returns_empty_invalid_result_for_null_sql_without_meta():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(['{"sql": null}'])

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_post_processor_returns_empty_invalid_result_for_missing_sql_key():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(['{"message": "done"}'])

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_post_processor_returns_empty_invalid_result_for_structured_sql_object():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        ['{"sql": {"select": ["purchase_order"], "from": "orders"}}'],
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {}


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


@pytest.mark.asyncio
async def test_post_processor_allows_cte_alias_when_underlying_table_is_grounded():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                '{"sql": "WITH recent AS (SELECT * FROM \\"dbo_xStageNewOrders\\") '
                'SELECT * FROM recent"}'
            )
        ],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_allows_qualified_column_on_grounded_alias():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                '{"sql": "SELECT o.\\"order_date\\" '
                'FROM \\"order_model\\" AS o"}'
            )
        ],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_allows_join_with_retrieved_relationship():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                '{"sql": "SELECT a.\\"entity_id\\", b.\\"attribute_value\\" '
                'FROM \\"model_alpha\\" a JOIN \\"model_beta\\" b '
                'ON a.\\"entity_id\\" = b.\\"entity_id\\""}'
            )
        ],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_allows_output_aliases_in_order_by():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                '{"sql": "SELECT COUNT(*) AS \\"order_count\\" '
                'FROM \\"dbo_xStageNewOrders\\" ORDER BY \\"order_count\\" DESC"}'
            )
        ],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_allows_string_literals_in_filters():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        [
            (
                '{"sql": "SELECT \\"ShipCountry\\" FROM \\"dbo_xStageNewOrders\\" '
                'WHERE \\"ShipCountry\\" = '
                "'India'\"}"
            )
        ],
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_uses_engine_error_sql_for_correction_like_legacy():
    processor = SQLGenPostProcessor(engine=_FailingEngine())

    result = await processor.run(
        ['{"sql": "SELECT * FROM dbo_xStageNewOrders"}'],
    )

    invalid = result["invalid_generation_result"]
    assert invalid["sql"] == "SELECT * FROM orders"
    assert invalid["original_sql"] == "SELECT * FROM dbo_xStageNewOrders"
    assert invalid["error"] == "Invalid object name 'orders'."


@pytest.mark.asyncio
async def test_post_processor_allows_raw_sql_when_grounded():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        ['SELECT "created_at" FROM "model_alpha"'],
    )

    assert result["invalid_generation_result"] == {}
    assert result["valid_generation_result"] != {}
    assert engine.execute_kwargs is not None
