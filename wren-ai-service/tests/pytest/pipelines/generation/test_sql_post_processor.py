import pytest

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
        ['{"sql": "SELECT * FROM supported_model"}'],
        project_id="project-id",
        schema_contracts=[{"table_name": "supported_model", "column_names": []}],
    )

    assert engine.executed is True
    assert result["valid_generation_result"] == {
        "sql": "SELECT * FROM supported_model",
        "correlation_id": "valid-correlation",
    }
    assert result["invalid_generation_result"] == {}


@pytest.mark.asyncio
async def test_sql_post_processor_returns_generated_sql_when_dry_plan_times_out():
    result = await SQLGenPostProcessor(TimeoutEngine()).run(
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
