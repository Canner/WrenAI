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

    def post(self, url, headers, json, timeout):
        self.calls.append(
            {"url": url, "headers": headers, "json": json, "timeout": timeout}
        )
        return FakeResponse(self._payload)


@pytest.mark.asyncio
async def test_wren_ui_execute_sql_normalizes_runtime_scope_before_rest_request():
    session = FakeSession(
        {
            "data": {"data": [{"id": 1}]},
            "correlationId": "corr-1",
        }
    )
    engine = WrenUI(endpoint="http://wren-ui")

    success, result, metadata = await engine.execute_sql(
        "SELECT 1 LIMIT 10",
        session=session,
        runtime_scope_id=" deploy-1 ",
        dry_run=False,
    )

    assert success is True
    assert result == {"data": [{"id": 1}]}
    assert metadata == {"correlation_id": "corr-1"}
    assert len(session.calls) == 1
    assert session.calls[0]["url"] == "http://wren-ui/api/v1/internal/sql/preview"
    assert session.calls[0]["headers"] == {
        "x-wren-ai-service-internal": "1",
    }
    assert session.calls[0]["json"] == {
        "sql": "SELECT 1",
        "runtimeScopeId": "deploy-1",
        "limit": 500,
    }


@pytest.mark.asyncio
async def test_wren_ui_execute_sql_accepts_explicit_project_bridge_id_kwarg():
    session = FakeSession(
        {
            "data": {"data": [{"id": 1}]},
            "correlationId": "corr-2",
        }
    )
    engine = WrenUI(endpoint="http://wren-ui")

    success, result, metadata = await engine.execute_sql(
        "SELECT 1 LIMIT 10",
        session=session,
        bridge_scope_id=" legacy-project-2 ",
        dry_run=False,
    )

    assert success is True
    assert result == {"data": [{"id": 1}]}
    assert metadata == {"correlation_id": "corr-2"}
    assert session.calls[0]["json"]["runtimeScopeId"] == "legacy-project-2"


@pytest.mark.asyncio
async def test_wren_ui_execute_sql_prefers_runtime_scope_over_legacy_project_bridge():
    session = FakeSession(
        {
            "data": {"data": [{"id": 1}]},
            "correlationId": "corr-3",
        }
    )
    engine = WrenUI(endpoint="http://wren-ui")

    success, result, metadata = await engine.execute_sql(
        "SELECT 1 LIMIT 10",
        session=session,
        runtime_scope_id=" deploy-3 ",
        bridge_scope_id=" legacy-project-3 ",
        dry_run=False,
    )

    assert success is True
    assert result == {"data": [{"id": 1}]}
    assert metadata == {"correlation_id": "corr-3"}
    assert session.calls[0]["json"]["runtimeScopeId"] == "deploy-3"


def test_wren_ui_prefers_runtime_endpoint_env_over_config(monkeypatch):
    monkeypatch.setenv("WREN_UI_ENDPOINT", "http://env-wren-ui")

    engine = WrenUI(endpoint="http://config-wren-ui")

    assert engine._endpoint == "http://env-wren-ui"
