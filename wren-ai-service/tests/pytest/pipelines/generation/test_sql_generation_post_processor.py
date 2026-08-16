from typing import Any

import aiohttp
import pytest

from src.core.engine import Engine
from src.providers.llm import ChatRole
from src.pipelines.generation.utils.sql import (
    SQL_GENERATION_MODEL_KWARGS,
    SQLGenPostProcessor,
    construct_ask_history_messages,
)


class FakeEngine(Engine):
    def __init__(self, dry_plan_success: bool = True, execute_success: bool = True):
        self.dry_plan_success = dry_plan_success
        self.execute_success = execute_success
        self.dry_plan_calls: list[dict[str, Any]] = []
        self.execute_sql_calls: list[dict[str, Any]] = []

    async def dry_plan(
        self,
        session: aiohttp.ClientSession,
        sql: str,
        data_source: str,
        project_id: str | None = None,
        mdl_hash: str | None = None,
        allow_fallback: bool = True,
        **kwargs,
    ):
        self.dry_plan_calls.append(
            {
                "sql": sql,
                "data_source": data_source,
                "project_id": project_id,
                "mdl_hash": mdl_hash,
                "allow_fallback": allow_fallback,
            }
        )
        return self.dry_plan_success, "" if self.dry_plan_success else "plan failed"

    async def execute_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
        dry_run: bool = True,
        **kwargs,
    ):
        self.execute_sql_calls.append(
            {
                "sql": sql,
                "dry_run": dry_run,
                **kwargs,
            }
        )
        return self.execute_success, {}, {"correlation_id": "correlation-id"}


def test_sql_generation_model_kwargs_preserve_strict_schema():
    assert SQL_GENERATION_MODEL_KWARGS["preserve_json_schema"] is True
    assert SQL_GENERATION_MODEL_KWARGS["response_format"]["type"] == "json_schema"
    assert SQL_GENERATION_MODEL_KWARGS["response_format"]["json_schema"]["strict"] is True
    schema = SQL_GENERATION_MODEL_KWARGS["response_format"]["json_schema"]["schema"]
    assert schema["additionalProperties"] is False


def test_construct_ask_history_messages_matches_legacy_context():
    histories = [{"question": "q", "sql": "SELECT 1"}]

    messages = construct_ask_history_messages(histories)

    assert [(message.role, message.content) for message in messages] == [
        (ChatRole.USER, "q"),
        (ChatRole.ASSISTANT, "SELECT 1"),
    ]


@pytest.mark.asyncio
async def test_post_processor_extracts_tool_call_query_argument():
    engine = FakeEngine()
    processor = SQLGenPostProcessor(engine)

    result = await processor.run(
        ['{"name":"query","arguments":{"query":"SELECT 1"}}'],
        project_id="project-id",
        mdl_hash="manifest-hash",
        data_source="mssql",
    )

    assert result["valid_generation_result"] == {
        "sql": "SELECT 1",
        "correlation_id": "correlation-id",
    }
    assert engine.dry_plan_calls == [
        {
            "sql": "SELECT 1",
            "data_source": "mssql",
            "project_id": "project-id",
            "mdl_hash": "manifest-hash",
            "allow_fallback": True,
        }
    ]
    assert engine.execute_sql_calls[0]["dry_run"] is True


@pytest.mark.asyncio
async def test_post_processor_returns_no_relevant_sql_for_missing_sql_field():
    processor = SQLGenPostProcessor(FakeEngine())

    result = await processor.run(
        ['{"name":"query","arguments":{"value":"q"}}'],
        project_id="project-id",
        data_source="mssql",
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "NO_RELEVANT_SQL"
    assert "supported SQL field" in result["invalid_generation_result"]["error"]


@pytest.mark.asyncio
async def test_post_processor_treats_null_sql_as_no_relevant_sql():
    processor = SQLGenPostProcessor(FakeEngine())

    result = await processor.run(
        ['{"sql": null}'],
        project_id="project-id",
        data_source="mssql",
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "NO_RELEVANT_SQL"
    assert "No grounded SQL" in result["invalid_generation_result"]["error"]


@pytest.mark.asyncio
async def test_post_processor_rejects_code_tool_payload():
    engine = FakeEngine()
    processor = SQLGenPostProcessor(engine)

    result = await processor.run(
        ['{"name":"execute_code","arguments":{"code":"SELECT 1"}}'],
        project_id="project-id",
        data_source="mssql",
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "NO_RELEVANT_SQL"
    assert engine.dry_plan_calls == []
    assert engine.execute_sql_calls == []


@pytest.mark.asyncio
async def test_post_processor_rejects_plain_text_non_sql_response():
    engine = FakeEngine()
    processor = SQLGenPostProcessor(engine)

    result = await processor.run(
        ["q"],
        project_id="project-id",
        data_source="mssql",
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "NO_RELEVANT_SQL"
    assert "supported SQL JSON payload" in result["invalid_generation_result"]["error"]
    assert engine.dry_plan_calls == []
    assert engine.execute_sql_calls == []


@pytest.mark.asyncio
async def test_post_processor_dry_plans_before_preview_execution():
    engine = FakeEngine(dry_plan_success=False)
    processor = SQLGenPostProcessor(engine)

    result = await processor.run(
        ['{"sql":"SELECT 1"}'],
        project_id="project-id",
        mdl_hash="manifest-hash",
        data_source="mssql",
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"] == {
        "sql": "SELECT 1",
        "original_sql": "SELECT 1",
        "type": "DRY_PLAN",
        "error": "plan failed",
        "correlation_id": "",
    }
    assert len(engine.dry_plan_calls) == 1
    assert engine.execute_sql_calls == []
