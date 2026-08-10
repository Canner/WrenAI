import aiohttp
import pytest
from aioresponses import CallbackResult, aioresponses

from src.providers.engine.wren import WrenUI


@pytest.mark.asyncio
async def test_wren_ui_dry_plan_calls_graphql_planner():
    endpoint = "http://engine-host"
    captured_request = {}

    def callback(_url, **kwargs):
        captured_request.update(kwargs)
        return CallbackResult(payload={"data": {"dryPlanSql": True}})

    with aioresponses() as mocked:
        mocked.post(f"{endpoint}/api/graphql", callback=callback)

        async with aiohttp.ClientSession() as session:
            success, error_message = await WrenUI(endpoint=endpoint).dry_plan(
                session,
                sql="SELECT 1",
                data_source="source",
                project_id="project-id",
                mdl_hash="deploy-hash",
                allow_fallback=False,
            )

    assert success is True
    assert error_message == ""
    assert captured_request["json"] == {
        "query": "mutation DryPlanSql($data: DryPlanSQLDataInput) { dryPlanSql(data: $data) }",
        "variables": {
            "data": {
                "sql": "SELECT 1",
                "projectId": "project-id",
                "allowFallback": False,
            }
        },
    }


@pytest.mark.asyncio
async def test_wren_ui_execute_sql_uses_project_preview_manifest():
    endpoint = "http://engine-host"
    captured_request = {}

    def callback(_url, **kwargs):
        captured_request.update(kwargs)
        return CallbackResult(payload={"data": {"previewSql": {"data": [{"ok": 1}]}}})

    with aioresponses() as mocked:
        mocked.post(f"{endpoint}/api/graphql", callback=callback)

        async with aiohttp.ClientSession() as session:
            success, _, addition = await WrenUI(endpoint=endpoint).execute_sql(
                "SELECT 1",
                session,
                project_id="project-id",
                mdl_hash="deploy-hash",
                dry_run=True,
            )

    assert success is True
    assert addition == {"correlation_id": ""}
    assert captured_request["json"]["variables"]["data"] == {
        "sql": "SELECT 1",
        "projectId": "project-id",
        "dryRun": True,
        "limit": 1,
    }


@pytest.mark.asyncio
async def test_wren_ui_dry_plan_returns_graphql_error_message():
    endpoint = "http://engine-host"

    with aioresponses() as mocked:
        mocked.post(
            f"{endpoint}/api/graphql",
            payload={"errors": [{"message": "planner failed"}]},
        )

        async with aiohttp.ClientSession() as session:
            success, error_message = await WrenUI(endpoint=endpoint).dry_plan(
                session,
                sql="SELECT 1",
                data_source="source",
            )

    assert success is False
    assert error_message == "planner failed"
