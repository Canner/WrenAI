from enum import StrEnum
from typing import Optional

from pydantic import AliasChoices, Field

from src.core.skill_contract import (
    SkillContractModel,
    SkillExecutionError,
    SkillExecutionRequest,
    SkillExecutionResult,
)


class SkillRunnerExecutionStatus(StrEnum):
    ACCEPTED = "accepted"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SkillRunnerLimits(SkillContractModel):
    timeout_ms: int = Field(
        default=30_000,
        validation_alias=AliasChoices("timeout_ms", "timeoutMs"),
    )
    max_memory_mb: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("max_memory_mb", "maxMemoryMb"),
    )
    network_allowlist: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("network_allowlist", "networkAllowlist"),
    )


class SkillRunnerHealthResponse(SkillContractModel):
    status: str = "ok"
    version: Optional[str] = None
    supported_languages: list[str] = Field(
        default_factory=lambda: ["python"],
        validation_alias=AliasChoices("supported_languages", "supportedLanguages"),
    )
    default_runtime_kind: str = Field(
        default="isolated_python",
        validation_alias=AliasChoices("default_runtime_kind", "defaultRuntimeKind"),
    )


class SkillRunnerExecutionRequest(SkillExecutionRequest):
    execution_id: str = Field(
        validation_alias=AliasChoices("execution_id", "executionId")
    )
    skill_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("skill_id", "skillId"),
    )
    skill_name: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("skill_name", "skillName"),
    )
    runtime_kind: str = Field(
        default="isolated_python",
        validation_alias=AliasChoices("runtime_kind", "runtimeKind"),
    )
    source_type: str = Field(
        default="inline",
        validation_alias=AliasChoices("source_type", "sourceType"),
    )
    source_ref: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("source_ref", "sourceRef"),
    )
    entrypoint: Optional[str] = None
    limits: SkillRunnerLimits = Field(default_factory=SkillRunnerLimits)


class SkillRunnerExecutionResponse(SkillContractModel):
    execution_id: str = Field(
        validation_alias=AliasChoices("execution_id", "executionId")
    )
    status: SkillRunnerExecutionStatus
    result: Optional[SkillExecutionResult] = None
    error: Optional[SkillExecutionError] = None
