from src.core.runtime_identity import RuntimeIdentity, resolve_legacy_project_id


def test_runtime_identity_converts_to_skill_runtime_identity():
    runtime_identity = RuntimeIdentity.model_validate(
        {
            "workspaceId": "workspace-1",
            "knowledgeBaseId": "kb-1",
            "kbSnapshotId": "snapshot-1",
            "deployHash": "deploy-1",
            "projectId": "project-1",
        }
    )

    skill_runtime_identity = runtime_identity.to_skill_runtime_identity()

    assert skill_runtime_identity is not None
    assert skill_runtime_identity.workspace_id == "workspace-1"
    assert skill_runtime_identity.knowledge_base_id == "kb-1"
    assert skill_runtime_identity.kb_snapshot_id == "snapshot-1"
    assert skill_runtime_identity.deploy_hash == "deploy-1"


def test_resolve_legacy_project_id_prefers_explicit_project_id():
    runtime_identity = RuntimeIdentity.model_validate(
        {
            "projectId": "project-from-runtime",
            "deployHash": "deploy-1",
            "kbSnapshotId": "snapshot-1",
        }
    )

    assert (
        resolve_legacy_project_id(
            project_id="project-explicit",
            runtime_identity=runtime_identity,
            fallback_id="mdl-1",
        )
        == "project-explicit"
    )


def test_resolve_legacy_project_id_falls_back_to_deploy_hash_then_mdl_hash():
    runtime_identity = RuntimeIdentity.model_validate(
        {
            "deployHash": "deploy-1",
            "kbSnapshotId": "snapshot-1",
            "projectId": "project-from-runtime",
        }
    )

    assert (
        resolve_legacy_project_id(
            runtime_identity=runtime_identity,
            fallback_id="mdl-1",
        )
        == "deploy-1"
    )

    assert resolve_legacy_project_id(fallback_id="mdl-2") == "mdl-2"
