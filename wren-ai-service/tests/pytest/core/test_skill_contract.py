from src.core.skill_contract import (
    SkillExecutionRequest,
    SkillExecutionResult,
    SkillResultType,
)


def test_skill_execution_request_accepts_camel_case_aliases():
    request = SkillExecutionRequest.model_validate(
        {
            "query": "本月 GMV",
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "kbSnapshotId": "snap-1",
                "deployHash": "deploy-1",
            },
            "actorClaims": {
                "userId": "user-1",
                "workspaceMemberId": "member-1",
                "roleKeys": ["owner"],
                "permissionScopes": ["knowledge_base:*"],
            },
            "connectors": [
                {
                    "id": "connector-1",
                    "type": "postgres",
                    "displayName": "Warehouse",
                    "config": {"schema": "public"},
                }
            ],
            "secrets": [
                {
                    "id": "secret-1",
                    "values": {"password": "redacted"},
                    "redactedKeys": ["password"],
                }
            ],
            "historyWindow": [
                {
                    "role": "user",
                    "content": "上个月 GMV 呢？",
                }
            ],
            "skillConfig": {"mode": "hybrid"},
        }
    )

    assert request.runtime_identity.workspace_id == "workspace-1"
    assert request.runtime_identity.knowledge_base_id == "kb-1"
    assert request.actor_claims.user_id == "user-1"
    assert request.connectors[0].display_name == "Warehouse"
    assert request.secrets[0].redacted_keys == ["password"]
    assert request.history_window[0].content == "上个月 GMV 呢？"
    assert request.skill_config == {"mode": "hybrid"}


def test_skill_execution_result_keeps_normalized_output_shape():
    result = SkillExecutionResult.model_validate(
        {
            "resultType": "tabular_frame",
            "rows": [{"gmv": 100}],
            "columns": [{"name": "gmv", "type": "number"}],
            "chartSpec": {"mark": "bar"},
            "citations": [{"title": "Sales table"}],
            "trace": {"skillRunId": "run-1"},
        }
    )

    assert result.result_type == SkillResultType.TABULAR_FRAME
    assert result.rows == [{"gmv": 100}]
    assert result.columns[0].name == "gmv"
    assert result.chart_spec == {"mark": "bar"}
    assert result.citations[0].title == "Sales table"
    assert result.trace.skill_run_id == "run-1"
