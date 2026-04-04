import pytest

from src.providers.engine.wren import WrenUI


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self):
        return self._payload


class FakeSession:
    def __init__(self, payload):
        self._payload = payload
        self.calls = []

    def post(self, url, json, timeout):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        return FakeResponse(self._payload)


@pytest.mark.asyncio
async def test_wren_ui_execute_sql_normalizes_runtime_scope_before_graphql_request():
    session = FakeSession(
        {
            "data": {"previewSql": {"data": [{"id": 1}] }},
            "correlationId": "corr-1",
        }
    )
    engine = WrenUI(endpoint="http://wren-ui")

    success, result, metadata = await engine.execute_sql(
        "SELECT 1 LIMIT 10",
        session=session,
        project_id=" deploy-1 ",
        dry_run=False,
    )

    assert success is True
    assert result == {"data": [{"id": 1}]}
    assert metadata == {"correlation_id": "corr-1"}
    assert len(session.calls) == 1
    assert session.calls[0]["url"] == "http://wren-ui/api/graphql"
    assert session.calls[0]["json"]["variables"]["data"] == {
        "sql": "SELECT 1",
        "projectId": "deploy-1",
        "limit": 500,
    }
