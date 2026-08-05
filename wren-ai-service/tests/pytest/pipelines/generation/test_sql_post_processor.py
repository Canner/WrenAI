import pytest

from src.core.engine import clean_generation_result
from src.pipelines.generation.utils.sql import SQLGenPostProcessor


class TimeoutEngine:
    async def dry_plan(
        self,
        session,
        sql,
        data_source,
        project_id=None,
        allow_fallback=True,
    ):
        return False, "Request timed out after 30 seconds"

    async def execute_sql(
        self,
        sql,
        session,
        project_id=None,
        limit=1,
        dry_run=True,
    ):
        return False, None, {
            "error_message": "Request timed out after 30 seconds",
            "correlation_id": "timeout-correlation",
        }


class ErrorEngine:
    async def dry_plan(
        self,
        session,
        sql,
        data_source,
        project_id=None,
        allow_fallback=True,
    ):
        return False, "Planner rejected the statement"

    async def execute_sql(
        self,
        sql,
        session,
        project_id=None,
        limit=1,
        dry_run=True,
    ):
        return False, None, {"error_message": "Execution rejected the statement"}


class StringTimeoutEngine:
    async def dry_plan(
        self,
        session,
        sql,
        data_source,
        project_id=None,
        allow_fallback=True,
    ):
        return True, None

    async def execute_sql(
        self,
        sql,
        session,
        project_id=None,
        limit=1,
        dry_run=True,
    ):
        return False, None, "Timeout when connecting to execution engine"


class CapturingEngine:
    def __init__(self):
        self.sql = None
        self.executed = False

    async def execute_sql(
        self,
        sql,
        session,
        project_id=None,
        limit=1,
        dry_run=True,
    ):
        self.sql = sql
        self.executed = True
        return True, None, {"correlation_id": "valid-correlation"}


def test_clean_generation_result_preserves_internal_statement_separators():
    assert (
        clean_generation_result("SELECT * FROM a; SELECT * FROM b;")
        == "SELECT * FROM a; SELECT * FROM b"
    )


@pytest.mark.asyncio
async def test_sql_post_processor_converts_select_top_to_wren_limit():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        ['{"sql": "SELECT TOP 5 1 ORDER BY 1"}'],
        project_id="project-id",
    )

    assert engine.sql == "SELECT 1 ORDER BY 1 LIMIT 5"
    assert result["valid_generation_result"] == {
        "sql": "SELECT 1 ORDER BY 1 LIMIT 5",
        "correlation_id": "valid-correlation",
    }
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_multiple_statements_before_execution():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        ['{"sql": "SELECT * FROM first_model; SELECT * FROM second_model;"}'],
        project_id="project-id",
        schema_contracts=[
            {"table_name": "first_model", "column_names": []},
            {"table_name": "second_model", "column_names": []},
        ],
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {
        "sql": "SELECT * FROM first_model; SELECT * FROM second_model",
        "original_sql": "SELECT * FROM first_model; SELECT * FROM second_model",
        "type": "SQL_SYNTAX",
        "error": "Generated SQL contains multiple statements; return exactly one SQL statement.",
        "correlation_id": "",
    }


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_tables_outside_schema_contract():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        ['{"sql": "SELECT * FROM unsupported_model"}'],
        project_id="project-id",
        schema_contracts=[{"table_name": "supported_model", "column_names": []}],
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {
        "sql": "SELECT * FROM unsupported_model",
        "original_sql": "SELECT * FROM unsupported_model",
        "type": "SCHEMA_GROUNDING",
        "error": "Generated SQL references table identifiers outside the retrieved deployed schema.",
        "correlation_id": "",
    }


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_dotted_physical_table_reference():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        ['{"sql": "SELECT DISTINCT grouping_col FROM physical_schema.supported_model"}'],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "supported_model",
                "column_names": ["grouping_col"],
            }
        ],
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {
        "sql": "SELECT DISTINCT grouping_col FROM physical_schema.supported_model",
        "original_sql": "SELECT DISTINCT grouping_col FROM physical_schema.supported_model",
        "type": "SCHEMA_GROUNDING",
        "error": "Generated SQL references table identifiers outside the retrieved deployed schema.",
        "correlation_id": "",
    }


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_joined_tables_outside_schema_contract():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        ['{"sql": "SELECT * FROM supported_model JOIN unsupported_model ON 1 = 1"}'],
        project_id="project-id",
        schema_contracts=[{"table_name": "supported_model", "column_names": []}],
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "SCHEMA_GROUNDING"


@pytest.mark.asyncio
async def test_sql_post_processor_allows_tables_inside_schema_contract():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        ['{"sql": "SELECT id FROM supported_model"}'],
        project_id="project-id",
        schema_contracts=[{"table_name": "supported_model", "column_names": ["id"]}],
    )

    assert engine.executed is True
    assert result["valid_generation_result"] == {
        "sql": "SELECT id FROM supported_model",
        "correlation_id": "valid-correlation",
    }
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_select_wildcard_inside_schema_contract():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        ['{"sql": "SELECT supported_model.* FROM supported_model"}'],
        project_id="project-id",
        schema_contracts=[{"table_name": "supported_model", "column_names": ["id"]}],
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {
        "sql": "SELECT supported_model.* FROM supported_model",
        "original_sql": "SELECT supported_model.* FROM supported_model",
        "type": "SQL_SYNTAX",
        "error": "Generated SQL uses SELECT *; select explicit deployed schema columns needed for the question.",
        "correlation_id": "",
    }


@pytest.mark.asyncio
async def test_sql_post_processor_allows_count_star():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        ['{"sql": "SELECT COUNT(*) AS total_records FROM supported_model"}'],
        project_id="project-id",
        schema_contracts=[
            {"table_name": "supported_model", "column_names": ["total_records"]}
        ],
    )

    assert engine.executed is True
    assert result["valid_generation_result"] == {
        "sql": "SELECT COUNT(*) AS total_records FROM supported_model",
        "correlation_id": "valid-correlation",
    }
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_unshaped_analytical_table_preview():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        [
            (
                '{"sql": "SELECT dim_a, dim_b, dim_c, dim_d '
                'FROM model_alpha LIMIT 500"}'
            )
        ],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "model_alpha",
                "column_names": ["dim_a", "dim_b", "dim_c", "dim_d"],
            }
        ],
        query="per month by category",
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "SQL_SHAPE"
    assert (
        result["invalid_generation_result"]["error"]
        == "Generated SQL does not apply the requested aggregation, grouping, "
        "ranking, or measure calculation."
    )


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_unfiltered_timeframe_table_preview():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        ['{"sql": "SELECT entity_id, event_date FROM model_alpha"}'],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "model_alpha",
                "column_names": ["entity_id", "event_date"],
            }
        ],
        query="from july 2026",
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "SQL_SHAPE"


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_broad_preview_with_placeholder_filter():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        [
            (
                '{"sql": "SELECT dim_a, dim_b, dim_c, dim_d, dim_e, '
                "dim_f, dim_g, metric_col FROM model_alpha "
                "WHERE dim_a = 'SyntheticValue1'\"}"
            )
        ],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "model_alpha",
                "column_names": [
                    "dim_a",
                    "dim_b",
                    "dim_c",
                    "dim_d",
                    "dim_e",
                    "dim_f",
                    "dim_g",
                    "metric_col",
                ],
            }
        ],
        query="total metric by category",
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "SQL_VALUE_GROUNDING"


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_aggregate_intent_without_aggregate_shape():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        [
            (
                '{"sql": "SELECT dim_a, dim_b FROM model_alpha '
                "WHERE dim_a = 'dim_a'\"}"
            )
        ],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "model_alpha",
                "column_names": ["dim_a", "dim_b"],
            }
        ],
        query="total metric by dim_a",
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "SQL_SHAPE"
    assert (
        result["invalid_generation_result"]["error"]
        == "Generated SQL does not apply the requested aggregation, grouping, "
        "ranking, or measure calculation."
    )


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_aggregate_using_wrong_business_dimension():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        [
            (
                '{"sql": "SELECT invoice_number, COUNT(*) AS invoice_count '
                "FROM open_invoices GROUP BY invoice_number "
                "ORDER BY invoice_count DESC LIMIT 10\"}"
            )
        ],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "open_invoices",
                "column_names": ["invoice_number", "part_number"],
                "column_semantic_terms": {
                    "invoice_number": ["invoice", "number", "identifier"],
                    "part_number": ["part", "number", "identifier"],
                },
            }
        ],
        query="Which suppliers have the highest number of invoices?",
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "INTENT_GROUNDING"


@pytest.mark.asyncio
async def test_sql_post_processor_allows_aggregate_using_requested_business_dimension():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        [
            (
                '{"sql": "SELECT supplier_name, COUNT(*) AS invoice_count '
                "FROM supplier_invoices GROUP BY supplier_name "
                "ORDER BY invoice_count DESC LIMIT 10\"}"
            )
        ],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "supplier_invoices",
                "column_names": ["supplier_name", "invoice_number"],
                "column_semantic_terms": {
                    "supplier_name": ["supplier", "name", "dimension"],
                    "invoice_number": ["invoice", "number", "identifier"],
                },
            }
        ],
        query="Which suppliers have the highest number of invoices?",
    )

    assert engine.executed is True
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_rejects_join_without_declared_relationship():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        [
            (
                '{"sql": "SELECT customers.name, COUNT(*) AS order_count '
                "FROM orders JOIN customers ON orders.customer_id = customers.id "
                "GROUP BY customers.name\"}"
            )
        ],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "orders",
                "column_names": ["customer_id"],
                "relationship_constraints": [],
            },
            {
                "table_name": "customers",
                "column_names": ["id", "name"],
                "relationship_constraints": [],
            },
        ],
        query="orders by customer",
    )

    assert engine.executed is False
    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "RELATIONSHIP_GROUNDING"


@pytest.mark.asyncio
async def test_sql_post_processor_allows_join_with_declared_relationship():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        [
            (
                '{"sql": "SELECT customers.name, COUNT(*) AS order_count '
                "FROM orders JOIN customers ON orders.customer_id = customers.id "
                "GROUP BY customers.name\"}"
            )
        ],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "orders",
                "column_names": ["customer_id"],
                "relationship_constraints": [
                    "FOREIGN KEY (customer_id) REFERENCES customers(id)"
                ],
            },
            {
                "table_name": "customers",
                "column_names": ["id", "name"],
                "relationship_constraints": [],
            },
        ],
        query="orders by customer",
    )

    assert engine.executed is True
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_allows_intent_shaped_analytical_query():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        [
            (
                '{"sql": "SELECT category_col, DATE_TRUNC('
                "'month', event_date) AS period_col, COUNT(*) AS row_count "
                "FROM model_alpha GROUP BY category_col, "
                "DATE_TRUNC('month', event_date)\"}"
            )
        ],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "model_alpha",
                "column_names": ["category_col", "event_date"],
            }
        ],
        query="per month by category",
    )

    assert engine.executed is True
    assert result["valid_generation_result"] == {
        "sql": (
            "SELECT category_col, DATE_TRUNC('month', event_date) AS period_col, "
            "COUNT(*) AS row_count FROM model_alpha GROUP BY category_col, "
            "DATE_TRUNC('month', event_date)"
        ),
        "correlation_id": "valid-correlation",
    }
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_allows_user_provided_string_filter_value():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        [
            (
                '{"sql": "SELECT entity_id, status_col FROM model_alpha '
                "WHERE status_col = 'active'\"}"
            )
        ],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "model_alpha",
                "column_names": ["entity_id", "status_col"],
            }
        ],
        query="show active records",
    )

    assert engine.executed is True
    assert result["valid_generation_result"] == {
        "sql": (
            "SELECT entity_id, status_col FROM model_alpha "
            "WHERE status_col = 'active'"
        ),
        "correlation_id": "valid-correlation",
    }
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_allows_intent_shaped_filter_query():
    engine = CapturingEngine()

    result = await SQLGenPostProcessor(engine).run(
        [
            (
                '{"sql": "SELECT entity_id, event_date FROM model_alpha '
                "WHERE event_date >= DATE '2026-07-01' "
                "AND event_date < DATE '2026-08-01'\"}"
            )
        ],
        project_id="project-id",
        schema_contracts=[
            {
                "table_name": "model_alpha",
                "column_names": ["entity_id", "event_date"],
            }
        ],
        query="from july 2026",
    )

    assert engine.executed is True
    assert result["valid_generation_result"] == {
        "sql": (
            "SELECT entity_id, event_date FROM model_alpha "
            "WHERE event_date >= DATE '2026-07-01' "
            "AND event_date < DATE '2026-08-01'"
        ),
        "correlation_id": "valid-correlation",
    }
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_keeps_dry_plan_timeout_invalid_without_fallback():
    result = await SQLGenPostProcessor(TimeoutEngine()).run(
        ['{"sql": "SELECT 1"}'],
        project_id="project-id",
        use_dry_plan=True,
        data_source="source",
        allow_dry_plan_fallback=False,
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {
        "sql": "SELECT 1",
        "original_sql": "SELECT 1",
        "type": "DRY_PLAN",
        "error": "Request timed out after 30 seconds",
        "correlation_id": "",
    }


@pytest.mark.asyncio
async def test_sql_post_processor_returns_generated_sql_when_dry_plan_fallback_is_allowed():
    result = await SQLGenPostProcessor(TimeoutEngine()).run(
        ['{"sql": "SELECT 1"}'],
        project_id="project-id",
        use_dry_plan=True,
        data_source="source",
        allow_dry_plan_fallback=True,
    )

    assert result["valid_generation_result"] == {
        "sql": "SELECT 1",
        "correlation_id": "",
    }
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_returns_generated_sql_when_dry_run_times_out():
    result = await SQLGenPostProcessor(TimeoutEngine()).run(
        ['{"sql": "SELECT 1"}'],
        project_id="project-id",
    )

    assert result["valid_generation_result"] == {
        "sql": "SELECT 1",
        "correlation_id": "timeout-correlation",
    }
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_returns_generated_sql_when_engine_timeout_is_string():
    result = await SQLGenPostProcessor(StringTimeoutEngine()).run(
        ['{"sql": "SELECT 1"}'],
        project_id="project-id",
        use_dry_plan=True,
        data_source="source",
    )

    assert result["valid_generation_result"] == {
        "sql": "SELECT 1",
        "correlation_id": "",
    }
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_keeps_non_timeout_dry_plan_errors_invalid():
    result = await SQLGenPostProcessor(ErrorEngine()).run(
        ['{"sql": "SELECT 1"}'],
        project_id="project-id",
        use_dry_plan=True,
        data_source="source",
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {
        "sql": "SELECT 1",
        "original_sql": "SELECT 1",
        "type": "DRY_PLAN",
        "error": "Planner rejected the statement",
        "correlation_id": "",
    }
