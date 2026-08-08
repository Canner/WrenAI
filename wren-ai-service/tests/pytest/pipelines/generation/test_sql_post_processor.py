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


@pytest.mark.asyncio
async def test_post_processor_rejects_unretrieved_table_before_engine_validation():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        ['{"sql": "SELECT * FROM orders"}'],
        schema_grounding=(
            '- model/table: "dbo_xStageNewOrders"\n'
            "  columns:\n"
            '    - "OrderDate"'
        ),
        data_source="mssql",
    )

    assert result["valid_generation_result"] == {}
    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "SCHEMA_GROUNDING"
    assert invalid["sql"] == "SELECT * FROM orders"
    assert '"orders"' in invalid["error"]
    assert '"dbo_xStageNewOrders"' in invalid["error"]
    assert invalid["data_source"] == "mssql"


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
        schema_grounding=(
            '- model/table: "dbo_xStageNewOrders"\n'
            "  columns:\n"
            '    - "OrderDate"'
        ),
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_rejects_unretrieved_table_inside_cte():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        [
            (
                '{"sql": "WITH recent AS (SELECT * FROM orders) '
                'SELECT * FROM recent"}'
            )
        ],
        schema_grounding=(
            '- model/table: "dbo_xStageNewOrders"\n'
            "  columns:\n"
            '    - "OrderDate"'
        ),
    )

    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "SCHEMA_GROUNDING"
    assert '"orders"' in invalid["error"]


@pytest.mark.asyncio
async def test_post_processor_rejects_unretrieved_column_before_engine_validation():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        ['{"sql": "SELECT \\"country\\" FROM \\"dbo_xStageNewOrders\\""}'],
        schema_grounding=(
            '- model/table: "dbo_xStageNewOrders"\n'
            "  columns:\n"
            '    - "ShipCountry"'
        ),
    )

    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "SCHEMA_GROUNDING"
    assert '"country"' in invalid["error"]
    assert '"ShipCountry"' in invalid["error"]


@pytest.mark.asyncio
async def test_post_processor_validates_qualified_column_against_its_relation():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        [
            (
                '{"sql": "SELECT \\"customer\\".\\"order_date\\" '
                'FROM \\"customer\\""}'
            )
        ],
        schema_grounding=(
            '- model/table: "order_model"\n'
            "  columns:\n"
            '    - "order_date"\n'
            '- model/table: "customer"\n'
            "  columns:\n"
            '    - "customer_name"'
        ),
    )

    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "SCHEMA_GROUNDING"
    assert '"customer.order_date"' in invalid["error"]
    assert '"customer_name"' in invalid["error"]


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
        schema_grounding=(
            '- model/table: "order_model"\n'
            "  columns:\n"
            '    - "order_date"'
        ),
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_rejects_join_without_retrieved_relationship():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        [
            (
                '{"sql": "SELECT a.\\"entity_id\\", b.\\"attribute_value\\" '
                'FROM \\"model_alpha\\" a JOIN \\"model_beta\\" b '
                'ON a.\\"entity_id\\" = b.\\"entity_id\\""}'
            )
        ],
        schema_grounding=(
            '- model/table: "model_alpha"\n'
            "  columns:\n"
            '    - "entity_id"\n'
            '- model/table: "model_beta"\n'
            "  columns:\n"
            '    - "entity_id"\n'
            '    - "attribute_value"'
        ),
    )

    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "SCHEMA_GROUNDING"
    assert "relationship path" in invalid["error"]


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
        schema_grounding=(
            '- model/table: "model_alpha"\n'
            "  columns:\n"
            '    - "entity_id"\n'
            "  relationships:\n"
            "    - FOREIGN KEY (entity_id) REFERENCES model_beta(entity_id)\n"
            '- model/table: "model_beta"\n'
            "  columns:\n"
            '    - "entity_id"\n'
            '    - "attribute_value"'
        ),
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
        schema_grounding=(
            '- model/table: "dbo_xStageNewOrders"\n'
            "  columns:\n"
            '    - "OrderDate"'
        ),
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
        schema_grounding=(
            '- model/table: "dbo_xStageNewOrders"\n'
            "  columns:\n"
            '    - "ShipCountry"'
        ),
    )

    assert result["invalid_generation_result"] == {}
    assert engine.execute_kwargs is not None


@pytest.mark.asyncio
async def test_post_processor_keeps_raw_wren_sql_when_engine_returns_planned_sql():
    processor = SQLGenPostProcessor(engine=_FailingEngine())

    result = await processor.run(
        ['{"sql": "SELECT * FROM dbo_xStageNewOrders"}'],
    )

    invalid = result["invalid_generation_result"]
    assert invalid["sql"] == "SELECT * FROM dbo_xStageNewOrders"
    assert invalid["original_sql"] == "SELECT * FROM dbo_xStageNewOrders"
    assert invalid["engine_sql"] == "SELECT * FROM orders"
    assert invalid["error"] == "Invalid object name 'orders'."


@pytest.mark.asyncio
async def test_post_processor_schema_validates_raw_sql_before_engine_validation():
    processor = SQLGenPostProcessor(engine=_NoopEngine())

    result = await processor.run(
        ["SELECT * FROM orders"],
        schema_grounding=(
            '- model/table: "model_alpha"\n'
            "  columns:\n"
            '    - "created_at"'
        ),
        data_source="mssql",
    )

    assert result["valid_generation_result"] == {}
    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "SCHEMA_GROUNDING"
    assert invalid["sql"] == "SELECT * FROM orders"
    assert '"orders"' in invalid["error"]
    assert '"model_alpha"' in invalid["error"]
    assert invalid["data_source"] == "mssql"


@pytest.mark.asyncio
async def test_post_processor_allows_raw_sql_when_grounded():
    engine = _CapturingEngine()
    processor = SQLGenPostProcessor(engine=engine)

    result = await processor.run(
        ['SELECT "created_at" FROM "model_alpha"'],
        schema_grounding=(
            '- model/table: "model_alpha"\n'
            "  columns:\n"
            '    - "created_at"'
        ),
    )

    assert result["invalid_generation_result"] == {}
    assert result["valid_generation_result"] != {}
    assert engine.execute_kwargs is not None
