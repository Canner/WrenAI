import asyncio
from unittest.mock import AsyncMock

import pytest

from src.core.tool_router import ToolRouter


class LegacyAskToolStub:
    def __init__(self, *, result=None, side_effect=None):
        self.run = AsyncMock(return_value=result, side_effect=side_effect)


class DeepAgentsAskOrchestratorStub:
    def __init__(self, *, result=None, side_effect=None):
        self.run = AsyncMock(return_value=result, side_effect=side_effect)


def build_text_to_sql_result(*, sql: str, ask_path: str, orchestrator: str):
    return {
        "ask_result": [{"sql": sql, "type": "llm"}],
        "metadata": {
            "type": "TEXT_TO_SQL",
            "ask_path": ask_path,
            "error_type": "",
            "orchestrator": orchestrator,
        },
    }


@pytest.mark.asyncio
async def test_tool_router_runs_shadow_compare_for_text_to_sql_primary():
    deepagents = DeepAgentsAskOrchestratorStub(
        result=build_text_to_sql_result(
            sql="SELECT 1",
            ask_path="instructions",
            orchestrator="deepagents",
        )
    )
    legacy = LegacyAskToolStub(
        result=build_text_to_sql_result(
            sql="SELECT 1",
            ask_path="nl2sql",
            orchestrator="legacy",
        )
    )
    router = ToolRouter(
        legacy_ask_tool=legacy,
        deepagents_orchestrator=deepagents,
        ask_shadow_compare_enabled=True,
        ask_shadow_compare_sample_rate=1,
    )

    result = await router.run_ask(
        ask_runtime_mode="deepagents",
        ask_request=object(),
        query_id="query-1",
        trace_id="trace-1",
        histories=[],
        runtime_scope_id="kb-1",
        retrieval_scope_id="kb-1",
        is_followup=False,
        is_stopped=lambda: False,
        set_result=lambda **_: None,
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )
    await asyncio.sleep(0)

    assert deepagents.run.await_count == 1
    assert legacy.run.await_count == 1
    assert result["metadata"]["resolved_runtime"] == "deepagents"
    assert result["metadata"]["deepagents_fallback"] is False
    assert result["metadata"]["shadow_compare"] == {
        "enabled": True,
        "executed": True,
        "comparable": True,
        "primary_type": "TEXT_TO_SQL",
        "shadow_type": "TEXT_TO_SQL",
        "primary_ask_path": "instructions",
        "shadow_ask_path": "nl2sql",
        "primary_error_type": "",
        "shadow_error_type": "",
        "primary_sql": "SELECT 1",
        "shadow_sql": "SELECT 1",
        "primary_result_count": 1,
        "shadow_result_count": 1,
        "matched": True,
        "shadow_error": None,
        "reason": None,
    }


@pytest.mark.asyncio
async def test_tool_router_skips_shadow_compare_when_primary_falls_back_to_legacy():
    deepagents = DeepAgentsAskOrchestratorStub(side_effect=RuntimeError("boom"))
    legacy = LegacyAskToolStub(
        result=build_text_to_sql_result(
            sql="SELECT 2",
            ask_path="nl2sql",
            orchestrator="legacy",
        )
    )
    router = ToolRouter(
        legacy_ask_tool=legacy,
        deepagents_orchestrator=deepagents,
        ask_shadow_compare_enabled=True,
        ask_shadow_compare_sample_rate=1,
    )

    result = await router.run_ask(
        ask_runtime_mode="deepagents",
        ask_request=object(),
        query_id="query-2",
        trace_id="trace-2",
        histories=[],
        runtime_scope_id="kb-1",
        retrieval_scope_id="kb-1",
        is_followup=False,
        is_stopped=lambda: False,
        set_result=lambda **_: None,
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )

    assert deepagents.run.await_count == 1
    assert legacy.run.await_count == 1
    assert result["metadata"]["resolved_runtime"] == "legacy"
    assert result["metadata"]["deepagents_fallback"] is True
    assert result["metadata"]["fallback_reason"] == "deepagents_error"
    assert result["metadata"]["shadow_compare"] == {
        "enabled": True,
        "executed": False,
        "comparable": False,
        "primary_type": "TEXT_TO_SQL",
        "shadow_type": None,
        "primary_ask_path": "nl2sql",
        "shadow_ask_path": None,
        "primary_error_type": "",
        "shadow_error_type": None,
        "primary_sql": "SELECT 2",
        "shadow_sql": None,
        "primary_result_count": 1,
        "shadow_result_count": 0,
        "matched": False,
        "shadow_error": None,
        "reason": "deepagents_error",
    }
