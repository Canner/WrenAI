from enum import StrEnum
from typing import Any, Literal, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class SkillContractModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        extra="ignore",
    )


class SkillResultType(StrEnum):
    TABULAR_FRAME = "tabular_frame"
    METRIC_SERIES = "metric_series"
    TEXT = "text"
    CHART_SPEC = "chart_spec"
    CITATION_BUNDLE = "citation_bundle"
    ERROR = "error"


class SkillExecutionErrorCode(StrEnum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    TIMEOUT = "TIMEOUT"
    UPSTREAM_ERROR = "UPSTREAM_ERROR"
    EXECUTION_ERROR = "EXECUTION_ERROR"
    UNAVAILABLE = "UNAVAILABLE"


class SkillRuntimeIdentity(SkillContractModel):
    workspace_id: str = Field(
        validation_alias=AliasChoices("workspace_id", "workspaceId")
    )
    knowledge_base_id: str = Field(
        validation_alias=AliasChoices("knowledge_base_id", "knowledgeBaseId")
    )
    kb_snapshot_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("kb_snapshot_id", "kbSnapshotId"),
    )
    deploy_hash: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("deploy_hash", "deployHash"),
    )


class SkillHistoryEntry(SkillContractModel):
    role: Literal["system", "user", "assistant", "tool"] = "user"
    content: str
    sql: Optional[str] = None
    summary: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SkillResultColumn(SkillContractModel):
    name: str
    type: Optional[str] = None
    description: Optional[str] = None


class SkillCitation(SkillContractModel):
    title: Optional[str] = None
    url: Optional[str] = None
    snippet: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SkillExecutionTrace(SkillContractModel):
    skill_run_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("skill_run_id", "skillRunId"),
    )
    runner_job_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("runner_job_id", "runnerJobId"),
    )
    trace_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("trace_id", "traceId"),
    )
    metadata: dict[str, Any] = Field(default_factory=dict)


class SkillExecutionError(SkillContractModel):
    code: SkillExecutionErrorCode = SkillExecutionErrorCode.EXECUTION_ERROR
    message: str
    retryable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


class SkillExecutionResult(SkillContractModel):
    result_type: SkillResultType = Field(
        validation_alias=AliasChoices("result_type", "resultType")
    )
    rows: list[dict[str, Any]] = Field(default_factory=list)
    columns: list[SkillResultColumn] = Field(default_factory=list)
    series: list[dict[str, Any]] = Field(default_factory=list)
    text: Optional[str] = None
    chart_spec: Optional[dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("chart_spec", "chartSpec"),
    )
    citations: list[SkillCitation] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    trace: SkillExecutionTrace = Field(default_factory=SkillExecutionTrace)


class SkillExecutionRequest(SkillContractModel):
    query: str
    runtime_identity: SkillRuntimeIdentity = Field(
        validation_alias=AliasChoices("runtime_identity", "runtimeIdentity")
    )
    history_window: list[SkillHistoryEntry] = Field(
        default_factory=list,
        validation_alias=AliasChoices("history_window", "historyWindow"),
    )
    metadata: dict[str, Any] = Field(default_factory=dict)
