from typing import Optional

from pydantic import AliasChoices, Field

from src.core.skill_contract import SkillContractModel, SkillRuntimeIdentity


def _normalize_scope_id(value: str | int | None) -> Optional[str]:
    if value is None:
        return None

    normalized = str(value).strip()
    return normalized or None


class RuntimeIdentity(SkillContractModel):
    workspace_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("workspace_id", "workspaceId"),
    )
    knowledge_base_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("knowledge_base_id", "knowledgeBaseId"),
    )
    kb_snapshot_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("kb_snapshot_id", "kbSnapshotId"),
    )
    deploy_hash: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("deploy_hash", "deployHash"),
    )
    project_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("project_id", "projectId"),
    )
    actor_user_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("actor_user_id", "actorUserId"),
    )

    def to_skill_runtime_identity(self) -> Optional[SkillRuntimeIdentity]:
        if not self.workspace_id or not self.knowledge_base_id:
            return None

        return SkillRuntimeIdentity(
            workspace_id=self.workspace_id,
            knowledge_base_id=self.knowledge_base_id,
            kb_snapshot_id=self.kb_snapshot_id,
            deploy_hash=self.deploy_hash,
        )


def resolve_legacy_project_id(
    *,
    project_id: str | int | None = None,
    runtime_identity: Optional[RuntimeIdentity] = None,
    fallback_id: str | int | None = None,
) -> Optional[str]:
    candidates = (
        project_id,
        runtime_identity and runtime_identity.deploy_hash,
        fallback_id,
        runtime_identity and runtime_identity.kb_snapshot_id,
        runtime_identity and runtime_identity.project_id,
    )

    for candidate in candidates:
        normalized = _normalize_scope_id(candidate)
        if normalized:
            return normalized

    return None
