import warnings
from typing import Any, Optional

from pydantic import AliasChoices, Field, model_validator

from src.core.skill_contract import SkillContractModel, SkillRuntimeIdentity

LEGACY_BRIDGE_ALIAS_KEYS = ("project" + "_bridge_id", "project" + "BridgeId")
DEPRECATED_BRIDGE_ALIAS_WARNING = (
    "Detected deprecated compatibility bridge alias; migrate callers to "
    "runtime_scope_id / bridgeScopeId or canonical runtime_identity fields."
)


def warn_on_legacy_bridge_aliases(data: Any) -> Any:
    if isinstance(data, dict) and any(key in data for key in LEGACY_BRIDGE_ALIAS_KEYS):
        warnings.warn(DEPRECATED_BRIDGE_ALIAS_WARNING, DeprecationWarning, stacklevel=3)
    return data


def normalize_scope_id(value: str | int | None) -> Optional[str]:
    if value is None:
        return None

    normalized = str(value).strip()
    return normalized or None


class RuntimeIdentity(SkillContractModel):
    @model_validator(mode="before")
    @classmethod
    def warn_on_deprecated_bridge_aliases(cls, data: Any):
        return warn_on_legacy_bridge_aliases(data)

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
    # compatibility boundary only; canonical scope prefers deploy/kb/workspace identifiers
    # Wave 1 removed the older project-bridge request aliases; the remaining
    # bridge compatibility is projectId plus bridgeScopeId.
    project_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "project_id",
            "projectId",
            "bridge_scope_id",
            "bridgeScopeId",
        ),
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


def resolve_runtime_scope_id(
    *,
    runtime_scope_id: str | int | None = None,
    project_id: str | int | None = None,
    runtime_identity: Optional[RuntimeIdentity] = None,
    fallback_id: str | int | None = None,
) -> Optional[str]:
    candidates = (
        runtime_scope_id,
        runtime_identity and runtime_identity.deploy_hash,
        runtime_identity and runtime_identity.kb_snapshot_id,
        runtime_identity and runtime_identity.knowledge_base_id,
        runtime_identity and runtime_identity.workspace_id,
        runtime_identity and runtime_identity.project_id,
        project_id,
        fallback_id,
    )

    for candidate in candidates:
        normalized = normalize_scope_id(candidate)
        if normalized:
            return normalized

    return None


def resolve_bridge_scope_id(
    *,
    project_id: str | int | None = None,
    runtime_identity: Optional[RuntimeIdentity] = None,
    fallback_id: str | int | None = None,
) -> Optional[str]:
    candidates = (
        runtime_identity and runtime_identity.project_id,
        project_id,
        fallback_id,
    )

    for candidate in candidates:
        normalized = normalize_scope_id(candidate)
        if normalized:
            return normalized

    return None
