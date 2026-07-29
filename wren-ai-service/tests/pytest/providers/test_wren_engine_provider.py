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
