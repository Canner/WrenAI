import pytest

from src.core.runtime_identity import (
    DEPRECATED_BRIDGE_ALIAS_WARNING,
    RuntimeIdentity,
    resolve_bridge_scope_id,
    resolve_runtime_scope_id,
)
from src.web.v1.services import BaseRequest


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


def test_runtime_identity_ignores_project_bridge_aliases_after_wave_1_cutover():
    with pytest.warns(DeprecationWarning, match=DEPRECATED_BRIDGE_ALIAS_WARNING):
        runtime_identity = RuntimeIdentity.model_validate(
            {
                "projectBridgeId": "bridge-1",
            }
        )

    assert runtime_identity.project_id is None


def test_runtime_identity_accepts_bridge_scope_aliases():
    runtime_identity = RuntimeIdentity.model_validate(
        {
            "bridgeScopeId": "bridge-2",
        }
    )

    assert runtime_identity.project_id == "bridge-2"


def test_resolve_runtime_scope_id_prefers_runtime_identity_over_explicit_project_id():
    runtime_identity = RuntimeIdentity.model_validate(
        {
            "projectId": "project-from-runtime",
            "deployHash": "deploy-1",
            "kbSnapshotId": "snapshot-1",
        }
    )

    assert (
        resolve_runtime_scope_id(
            project_id="project-explicit",
            runtime_identity=runtime_identity,
            fallback_id="mdl-1",
        )
        == "deploy-1"
    )


def test_resolve_runtime_scope_id_prefers_explicit_runtime_scope_id_over_other_candidates():
    runtime_identity = RuntimeIdentity.model_validate(
        {
            "projectId": "project-from-runtime",
            "deployHash": "deploy-1",
        }
    )

    assert (
        resolve_runtime_scope_id(
            runtime_scope_id=" explicit-scope ",
            project_id="project-explicit",
            runtime_identity=runtime_identity,
            fallback_id="mdl-1",
        )
        == "explicit-scope"
    )


def test_resolve_runtime_scope_id_falls_back_to_runtime_project_then_explicit_project_then_mdl_hash():
    runtime_identity = RuntimeIdentity.model_validate(
        {
            "projectId": "project-from-runtime",
        }
    )

    assert (
        resolve_runtime_scope_id(
            runtime_identity=runtime_identity,
            fallback_id="mdl-1",
        )
        == "project-from-runtime"
    )

    assert resolve_runtime_scope_id(project_id="project-explicit") == "project-explicit"

    assert resolve_runtime_scope_id(fallback_id="mdl-2") == "mdl-2"


def test_resolve_project_bridge_id_matches_legacy_bridge_resolution():
    runtime_identity = RuntimeIdentity.model_validate(
        {
            "projectId": "project-from-runtime",
            "deployHash": "deploy-1",
        }
    )

    assert resolve_bridge_scope_id(runtime_identity=runtime_identity) == (
        "project-from-runtime"
    )
    assert resolve_bridge_scope_id(project_id=" project-explicit ") == (
        "project-explicit"
    )


def test_base_request_prefers_explicit_runtime_scope_id_over_runtime_identity_and_project_id():
    request = BaseRequest.model_validate(
        {
            "runtimeScopeId": "scope-explicit",
            "projectId": "project-explicit",
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )

    assert request.runtime_scope_id == "scope-explicit"
    assert request.project_id == "project-explicit"
    assert request.resolve_runtime_scope_id() == "scope-explicit"


def test_base_request_ignores_project_bridge_alias_after_wave_1_cutover():
    with pytest.warns(DeprecationWarning, match=DEPRECATED_BRIDGE_ALIAS_WARNING):
        request = BaseRequest.model_validate(
            {
                "projectBridgeId": "bridge-1",
            }
        )

    assert request.project_id is None
    assert request.resolve_bridge_scope_id() is None


def test_base_request_accepts_bridge_scope_alias():
    request = BaseRequest.model_validate(
        {
            "bridgeScopeId": "bridge-2",
        }
    )

    assert request.project_id == "bridge-2"
    assert request.resolve_bridge_scope_id() == "bridge-2"


def test_base_request_uses_runtime_identity_before_legacy_project_id_when_no_explicit_runtime_scope_id():
    request = BaseRequest.model_validate(
        {
            "projectId": "project-explicit",
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )

    assert request.runtime_scope_id is None
    assert request.project_id == "project-explicit"
    assert request.resolve_runtime_scope_id() == "deploy-1"
    assert request.resolve_bridge_scope_id() == "project-explicit"


def test_base_request_empty_runtime_scope_id_still_falls_back_to_runtime_identity():
    request = BaseRequest.model_validate(
        {
            "runtimeScopeId": "   ",
            "projectId": "project-explicit",
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
        }
    )

    assert request.runtime_scope_id == "   "
    assert request.project_id == "project-explicit"
    assert request.resolve_runtime_scope_id() == "deploy-1"
    assert request.resolve_bridge_scope_id() == "project-explicit"


def test_base_request_retrieval_scope_ids_include_primary_runtime_scope_once():
    request = BaseRequest.model_validate(
        {
            "runtimeScopeId": "deploy-1",
            "retrievalScopeIds": [" kb-2 ", "deploy-1", "kb-3"],
        }
    )

    assert request.resolve_retrieval_scope_ids() == [
        "deploy-1",
        "kb-2",
        "kb-3",
    ]


def test_base_request_retrieval_scope_ids_accept_comma_separated_string():
    request = BaseRequest.model_validate(
        {
            "runtimeIdentity": {
                "workspaceId": "workspace-1",
                "knowledgeBaseId": "kb-1",
                "deployHash": "deploy-1",
            },
            "retrieval_scope_ids": "kb-2, kb-3,deploy-1",
        }
    )

    assert request.resolve_retrieval_scope_ids() == [
        "deploy-1",
        "kb-2",
        "kb-3",
    ]
