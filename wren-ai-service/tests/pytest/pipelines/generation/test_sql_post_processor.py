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
        == "Generated SQL is a table preview and does not apply the requested "
        "aggregation, grouping, filter, timeframe, ranking, or ordering."
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
