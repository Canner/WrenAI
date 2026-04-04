import logging
from typing import Any, Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core import (
    DeepAgentsAskOrchestrator,
    LegacyAskTool,
    MixedAnswerComposer,
    SkillActorClaims,
    SkillConnector,
    SkillExecutionResult,
    SkillRunnerClient,
    SkillRunnerLimits,
    SkillSecret,
    ToolRouter,
)
from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, SSEEvent

logger = logging.getLogger("wren-ai-service")
AskPath = Literal[
    "historical",
    "skill",
    "sql_pairs",
    "instructions",
    "nl2sql",
    "correction",
    "general",
    "followup",
]


class AskHistory(BaseModel):
    sql: str
    question: str


class AskSkillCandidate(BaseModel):
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
    skill_config: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("skill_config", "skillConfig"),
    )
    limits: SkillRunnerLimits = Field(default_factory=SkillRunnerLimits)


# POST /v1/asks
class AskRequest(BaseRequest):
    query: str
    # don't recommend to use id as a field name, but it's used in the older version of API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: Optional[str] = Field(validation_alias=AliasChoices("mdl_hash", "id"))
    histories: Optional[list[AskHistory]] = Field(default_factory=list)
    ignore_sql_generation_reasoning: bool = False
    enable_column_pruning: bool = False
    use_dry_plan: bool = False
    allow_dry_plan_fallback: bool = True
    custom_instruction: Optional[str] = None
    actor_claims: Optional[SkillActorClaims] = Field(
        default=None,
        validation_alias=AliasChoices("actor_claims", "actorClaims"),
    )
    connectors: list[SkillConnector] = Field(default_factory=list)
    secrets: list[SkillSecret] = Field(default_factory=list)
    skill_config: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("skill_config", "skillConfig"),
    )
    skills: list[AskSkillCandidate] = Field(default_factory=list)


class AskResponse(BaseModel):
    query_id: str


# PATCH /v1/asks/{query_id}
class StopAskRequest(BaseRequest):
    status: Literal["stopped"]


class StopAskResponse(BaseModel):
    query_id: str


# GET /v1/asks/{query_id}/result
class AskResult(BaseModel):
    sql: str
    type: Literal["llm", "view"] = "llm"
    viewId: Optional[str] = None


class AskError(BaseModel):
    code: Literal["NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"]
    message: str


class AskResultRequest(BaseModel):
    query_id: str


class AskShadowCompare(BaseModel):
    enabled: bool
    executed: bool
    comparable: bool = False
    primary_type: Optional[str] = None
    shadow_type: Optional[str] = None
    primary_ask_path: Optional[AskPath] = None
    shadow_ask_path: Optional[AskPath] = None
    primary_error_type: Optional[str] = None
    shadow_error_type: Optional[str] = None
    primary_sql: Optional[str] = None
    shadow_sql: Optional[str] = None
    primary_result_count: int = 0
    shadow_result_count: int = 0
    matched: bool
    shadow_error: Optional[str] = None
    reason: Optional[str] = None


class AskShadowCompareStats(BaseModel):
    total_count: int = 0
    executed_count: int = 0
    skipped_count: int = 0
    matched_count: int = 0
    mismatched_count: int = 0
    error_count: int = 0
    comparable_count: int = 0
    non_comparable_count: int = 0
    comparable_match_count: int = 0
    comparable_mismatch_count: int = 0
    by_primary_ask_path: dict[str, int] = Field(default_factory=dict)
    by_shadow_ask_path: dict[str, int] = Field(default_factory=dict)
    by_shadow_error_type: dict[str, int] = Field(default_factory=dict)
    by_reason: dict[str, int] = Field(default_factory=dict)


class AskShadowCompareRolloutReadiness(BaseModel):
    status: Literal[
        "no_data",
        "investigate_shadow_errors",
        "waiting_for_comparable_samples",
        "blocked_on_comparable_mismatches",
        "ready_for_canary",
    ]
    recommended_mode: Literal["keep_legacy", "canary_deepagents"]
    reason: str
    total_count: int = 0
    executed_count: int = 0
    comparable_count: int = 0
    comparable_match_rate: float = 0.0
    comparable_mismatch_rate: float = 0.0
    error_rate: float = 0.0


class _AskResultResponse(BaseModel):
    status: Literal[
        "understanding",
        "searching",
        "planning",
        "generating",
        "correcting",
        "finished",
        "failed",
        "stopped",
    ]
    rephrased_question: Optional[str] = None
    intent_reasoning: Optional[str] = None
    sql_generation_reasoning: Optional[str] = None
    type: Optional[Literal["GENERAL", "TEXT_TO_SQL", "SKILL"]] = None
    retrieved_tables: Optional[List[str]] = None
    response: Optional[List[AskResult]] = None
    skill_result: Optional[SkillExecutionResult] = None
    ask_path: Optional[AskPath] = None
    invalid_sql: Optional[str] = None
    error: Optional[AskError] = None
    shadow_compare: Optional[AskShadowCompare] = None
    trace_id: Optional[str] = None
    is_followup: bool = False
    general_type: Optional[
        Literal["MISLEADING_QUERY", "DATA_ASSISTANCE", "USER_GUIDE"]
    ] = None


class AskResultResponse(_AskResultResponse):
    is_followup: Optional[bool] = Field(False, exclude=True)
    general_type: Optional[
        Literal["MISLEADING_QUERY", "DATA_ASSISTANCE", "USER_GUIDE"]
    ] = Field(None, exclude=True)


class AskService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        ask_runtime_mode: Literal["legacy", "deepagents"] = "deepagents",
        ask_shadow_compare_enabled: bool = False,
        allow_intent_classification: bool = True,
        allow_sql_generation_reasoning: bool = True,
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        allow_sql_knowledge_retrieval: bool = True,
        enable_column_pruning: bool = False,
        max_sql_correction_retries: int = 3,
        max_histories: int = 5,
        skill_runner_client: Optional[SkillRunnerClient] = None,
        deepagents_orchestrator: Optional[DeepAgentsAskOrchestrator] = None,
        legacy_ask_tool: Optional[LegacyAskTool] = None,
        mixed_answer_composer: Optional[MixedAnswerComposer] = None,
        tool_router: Optional[ToolRouter] = None,
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._ask_runtime_mode = ask_runtime_mode
        self._ask_results: Dict[str, AskResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._shadow_compare_stats = AskShadowCompareStats()
        self._max_histories = max_histories
        self._deepagents_orchestrator = deepagents_orchestrator or (
            DeepAgentsAskOrchestrator(
                skill_runner_client=skill_runner_client,
                mixed_answer_composer=mixed_answer_composer,
            )
        )
        self._legacy_ask_tool = legacy_ask_tool or LegacyAskTool(
            pipelines=pipelines,
            mixed_answer_composer=mixed_answer_composer,
            allow_intent_classification=allow_intent_classification,
            allow_sql_generation_reasoning=allow_sql_generation_reasoning,
            allow_sql_functions_retrieval=allow_sql_functions_retrieval,
            allow_sql_diagnosis=allow_sql_diagnosis,
            allow_sql_knowledge_retrieval=allow_sql_knowledge_retrieval,
            enable_column_pruning=enable_column_pruning,
            max_sql_correction_retries=max_sql_correction_retries,
        )
        self._tool_router = tool_router or ToolRouter(
            legacy_ask_tool=self._legacy_ask_tool,
            deepagents_orchestrator=self._deepagents_orchestrator,
            ask_shadow_compare_enabled=ask_shadow_compare_enabled,
        )

    def _is_stopped(self, query_id: str, container: dict):
        if (
            result := container.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    def _set_ask_result(self, query_id: str, **payload):
        self._ask_results[query_id] = AskResultResponse(**payload)

    def _bump_shadow_compare_bucket(
        self, bucket: dict[str, int], key: Optional[str]
    ) -> None:
        if not key:
            return
        bucket[key] = bucket.get(key, 0) + 1

    def _record_shadow_compare(self, shadow_compare: AskShadowCompare) -> None:
        self._shadow_compare_stats.total_count += 1
        if shadow_compare.executed:
            self._shadow_compare_stats.executed_count += 1
        else:
            self._shadow_compare_stats.skipped_count += 1

        if shadow_compare.executed and shadow_compare.matched:
            self._shadow_compare_stats.matched_count += 1
        elif shadow_compare.executed:
            self._shadow_compare_stats.mismatched_count += 1

        if shadow_compare.executed and shadow_compare.comparable:
            self._shadow_compare_stats.comparable_count += 1
            if shadow_compare.matched:
                self._shadow_compare_stats.comparable_match_count += 1
            else:
                self._shadow_compare_stats.comparable_mismatch_count += 1
        elif shadow_compare.executed:
            self._shadow_compare_stats.non_comparable_count += 1

        if shadow_compare.shadow_error or shadow_compare.shadow_error_type:
            self._shadow_compare_stats.error_count += 1

        self._bump_shadow_compare_bucket(
            self._shadow_compare_stats.by_primary_ask_path,
            shadow_compare.primary_ask_path,
        )
        self._bump_shadow_compare_bucket(
            self._shadow_compare_stats.by_shadow_ask_path,
            shadow_compare.shadow_ask_path,
        )
        self._bump_shadow_compare_bucket(
            self._shadow_compare_stats.by_shadow_error_type,
            shadow_compare.shadow_error_type,
        )
        self._bump_shadow_compare_bucket(
            self._shadow_compare_stats.by_reason,
            shadow_compare.reason,
        )

    def get_shadow_compare_stats(self) -> AskShadowCompareStats:
        return self._shadow_compare_stats.model_copy(deep=True)

    def get_shadow_compare_rollout_readiness(
        self,
    ) -> AskShadowCompareRolloutReadiness:
        stats = self._shadow_compare_stats
        comparable_denominator = stats.comparable_count or 1
        executed_denominator = stats.executed_count or 1

        if stats.total_count == 0:
            status = "no_data"
            reason = "No shadow compare samples recorded yet."
        elif stats.error_count > 0:
            status = "investigate_shadow_errors"
            reason = "Shadow compare recorded legacy shadow errors."
        elif stats.comparable_count == 0:
            status = "waiting_for_comparable_samples"
            reason = (
                "Current shadow compares do not yet produce directly comparable "
                "primary and shadow results."
            )
        elif stats.comparable_mismatch_count > 0:
            status = "blocked_on_comparable_mismatches"
            reason = "Comparable shadow compare samples still contain mismatches."
        else:
            status = "ready_for_canary"
            reason = "Comparable shadow compare samples are matching."

        return AskShadowCompareRolloutReadiness(
            status=status,
            recommended_mode=(
                "canary_deepagents" if status == "ready_for_canary" else "keep_legacy"
            ),
            reason=reason,
            total_count=stats.total_count,
            executed_count=stats.executed_count,
            comparable_count=stats.comparable_count,
            comparable_match_rate=stats.comparable_match_count
            / comparable_denominator,
            comparable_mismatch_rate=stats.comparable_mismatch_count
            / comparable_denominator,
            error_rate=stats.error_count / executed_denominator,
        )

    @observe(name="Ask Question")
    @trace_metadata
    async def ask(
        self,
        ask_request: AskRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        query_id = ask_request.query_id
        histories = ask_request.histories[: self._max_histories][
            ::-1
        ]  # reverse the order of histories
        runtime_scope_id = ask_request.resolve_project_id(
            fallback_id=ask_request.mdl_hash,
        )
        is_followup = bool(histories)
        result = await self._tool_router.run_ask(
            ask_runtime_mode=self._ask_runtime_mode,
            ask_request=ask_request,
            query_id=query_id,
            trace_id=trace_id,
            histories=histories,
            runtime_scope_id=runtime_scope_id,
            is_followup=is_followup,
            is_stopped=lambda: self._is_stopped(query_id, self._ask_results),
            set_result=lambda **payload: self._set_ask_result(query_id, **payload),
            build_ask_result=lambda **payload: AskResult(**payload),
            build_ask_error=lambda **payload: AskError(**payload),
        )
        metadata = result.get("metadata", {})
        shadow_compare = metadata.get("shadow_compare")
        ask_path = metadata.get("ask_path")
        validated_shadow_compare = None
        if shadow_compare:
            validated_shadow_compare = AskShadowCompare.model_validate(shadow_compare)
            self._record_shadow_compare(validated_shadow_compare)
        cached_result = self._ask_results.get(query_id)
        if cached_result is not None and (validated_shadow_compare or ask_path):
            updates = {}
            if validated_shadow_compare:
                updates["shadow_compare"] = validated_shadow_compare
            if ask_path:
                updates["ask_path"] = ask_path
            self._ask_results[query_id] = cached_result.model_copy(
                update=updates
            )
        return result

    def stop_ask(
        self,
        stop_ask_request: StopAskRequest,
    ):
        self._ask_results[stop_ask_request.query_id] = AskResultResponse(
            status="stopped",
        )

    def get_ask_result(
        self,
        ask_result_request: AskResultRequest,
    ) -> AskResultResponse:
        if (result := self._ask_results.get(ask_result_request.query_id)) is None:
            logger.exception(
                f"ask pipeline - OTHERS: {ask_result_request.query_id} is not found"
            )
            return AskResultResponse(
                status="failed",
                type="TEXT_TO_SQL",
                error=AskError(
                    code="OTHERS",
                    message=f"{ask_result_request.query_id} is not found",
                ),
            )

        return result

    async def get_ask_streaming_result(
        self,
        query_id: str,
    ):
        if self._ask_results.get(query_id):
            _pipeline_name = ""
            if self._ask_results.get(query_id).type == "GENERAL":
                if self._ask_results.get(query_id).general_type == "USER_GUIDE":
                    _pipeline_name = "user_guide_assistance"
                elif self._ask_results.get(query_id).general_type == "DATA_ASSISTANCE":
                    _pipeline_name = "data_assistance"
                elif self._ask_results.get(query_id).general_type == "MISLEADING_QUERY":
                    _pipeline_name = "misleading_assistance"
            elif self._ask_results.get(query_id).status == "planning":
                if self._ask_results.get(query_id).is_followup:
                    _pipeline_name = "followup_sql_generation_reasoning"
                else:
                    _pipeline_name = "sql_generation_reasoning"

            if _pipeline_name:
                async for chunk in self._pipelines[
                    _pipeline_name
                ].get_streaming_results(query_id):
                    event = SSEEvent(
                        data=SSEEvent.SSEEventMessage(message=chunk),
                    )
                    yield event.serialize()
