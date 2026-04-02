import pytest
from aioresponses import aioresponses

from src.core.skill_runner import (
    SkillRunnerClient,
    SkillRunnerClientError,
    SkillRunnerExecutionRequest,
    SkillRunnerExecutionStatus,
)


@pytest.mark.asyncio
async def test_skill_runner_client_healthcheck():
    client = SkillRunnerClient(
        endpoint="http://runner.example.com",
        timeout=5,
        enabled=True,
    )

    with aioresponses() as mocked:
        mocked.get(
            "http://runner.example.com/health",
            payload={
                "status": "ok",
                "version": "0.1.0",
                "supported_languages": ["python"],
            },
        )

        response = await client.healthcheck()

    assert response.status == "ok"
    assert response.version == "0.1.0"
    assert response.supported_languages == ["python"]


@pytest.mark.asyncio
async def test_skill_runner_client_runs_and_reads_result():
    client = SkillRunnerClient(
        endpoint="http://runner.example.com",
        timeout=5,
        enabled=True,
    )
    request = SkillRunnerExecutionRequest.model_validate(
        {
            "executionId": "exec-1",
            "skillId": "skill-1",
            "query": "查询本月订单量",
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
            },
            "limits": {"timeoutMs": 15000},
        }
    )

    with aioresponses() as mocked:
        mocked.post(
            "http://runner.example.com/v1/skill-runs",
            payload={
                "execution_id": "exec-1",
                "status": "accepted",
            },
        )
        mocked.get(
            "http://runner.example.com/v1/skill-runs/exec-1",
            payload={
                "execution_id": "exec-1",
                "status": "succeeded",
                "result": {
                    "result_type": "text",
                    "text": "订单量为 128",
                    "trace": {"skill_run_id": "run-1"},
                },
            },
        )

        accepted = await client.run(request)
        finished = await client.get_result("exec-1")

    assert accepted.execution_id == "exec-1"
    assert accepted.status == SkillRunnerExecutionStatus.ACCEPTED
    assert finished.status == SkillRunnerExecutionStatus.SUCCEEDED
    assert finished.result is not None
    assert finished.result.text == "订单量为 128"
    assert finished.result.trace.skill_run_id == "run-1"


@pytest.mark.asyncio
async def test_skill_runner_client_raises_when_disabled():
    client = SkillRunnerClient(
        endpoint="http://runner.example.com",
        timeout=5,
        enabled=False,
    )

    with pytest.raises(SkillRunnerClientError) as exc:
        await client.healthcheck()

    assert exc.value.status_code == 503
    assert "disabled" in str(exc.value)
