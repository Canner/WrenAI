import asyncio
from dataclasses import dataclass
import logging
import uuid
from typing import Any, Awaitable, Callable, Optional, Protocol, Sequence

from src.core.mixed_answer_composer import MixedAnswerComposer
from src.core.skill_contract import (
    SkillActorClaims,
    SkillConnector,
    SkillExecutionResult,
    SkillHistoryEntry,
    SkillResultType,
    SkillRuntimeIdentity,
    SkillSecret,
)
from src.core.skill_runner import (
    SkillRunnerClient,
    SkillRunnerClientError,
    SkillRunnerExecutionRequest,
    SkillRunnerExecutionStatus,
)

logger = logging.getLogger("wren-ai-service")
DEFAULT_POLL_ATTEMPTS = 3
DEFAULT_POLL_INTERVAL = 0.2


class QueryHistory(Protocol):
    question: str
    sql: str


class SkillCandidate(Protocol):
    skill_id: Optional[str]
    skill_name: Optional[str]
    runtime_kind: str
    source_type: str
    source_ref: Optional[str]
    entrypoint: Optional[str]
    skill_config: dict[str, Any]
    limits: Any


ResultUpdater = Callable[..., None]
FallbackRunner = Callable[[], Awaitable[dict[str, Any]]]


@dataclass
class SkillRoutingOutcome:
    skill_result: Optional[SkillExecutionResult]
    fallback_reason: Optional[str] = None
    available_skill_count: int = 0
    attempted_skill_count: int = 0
    failed_skill_count: int = 0
    selected_skill_id: Optional[str] = None
    selected_skill_name: Optional[str] = None
    selected_runtime_kind: Optional[str] = None
    selected_source_type: Optional[str] = None
    last_error: Optional[str] = None

    def to_metadata(self) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            "deepagents_skill_candidate_count": self.available_skill_count,
            "deepagents_skill_attempt_count": self.attempted_skill_count,
            "deepagents_skill_failure_count": self.failed_skill_count,
        }

        if self.fallback_reason:
            metadata["fallback_reason"] = self.fallback_reason
            metadata["deepagents_routing_reason"] = self.fallback_reason
        if self.selected_skill_id:
            metadata["deepagents_selected_skill_id"] = self.selected_skill_id
        if self.selected_skill_name:
            metadata["deepagents_selected_skill_name"] = self.selected_skill_name
        if self.selected_runtime_kind:
            metadata["deepagents_selected_runtime_kind"] = (
                self.selected_runtime_kind
            )
        if self.selected_source_type:
            metadata["deepagents_selected_source_type"] = self.selected_source_type
        if self.last_error:
            metadata["deepagents_last_error"] = self.last_error

        return metadata


class DeepAgentsAskOrchestrator:
    def __init__(
        self,
        skill_runner_client: Optional[SkillRunnerClient] = None,
        mixed_answer_composer: Optional[MixedAnswerComposer] = None,
        *,
        poll_attempts: int = DEFAULT_POLL_ATTEMPTS,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
    ):
        self._skill_runner_client = skill_runner_client
        self._mixed_answer_composer = mixed_answer_composer or MixedAnswerComposer()
        self._poll_attempts = poll_attempts
        self._poll_interval = poll_interval

    def _build_history_window(
        self,
        histories: Sequence[QueryHistory],
    ) -> list[SkillHistoryEntry]:
        return [
            SkillHistoryEntry(
                role="user",
                content=history.question,
                sql=history.sql,
                metadata={"source": "ask_history"},
            )
            for history in histories
        ]

    def _build_skill_runner_request(
        self,
        *,
        query: str,
        request_from: str,
        runtime_identity: SkillRuntimeIdentity,
        actor_claims: Optional[SkillActorClaims],
        connectors: Sequence[SkillConnector],
        secrets: Sequence[SkillSecret],
        histories: Sequence[QueryHistory],
        skill_config: dict[str, Any],
        skill: SkillCandidate,
    ) -> SkillRunnerExecutionRequest:
        return SkillRunnerExecutionRequest(
            execution_id=str(uuid.uuid4()),
            skill_id=skill.skill_id,
            skill_name=skill.skill_name,
            runtime_kind=skill.runtime_kind,
            source_type=skill.source_type,
            source_ref=skill.source_ref,
            entrypoint=skill.entrypoint,
            limits=skill.limits,
            query=query,
            runtime_identity=runtime_identity,
            actor_claims=actor_claims,
            connectors=list(connectors),
            secrets=list(secrets),
            history_window=self._build_history_window(histories),
            skill_config={
                **skill_config,
                **skill.skill_config,
            },
            metadata={"request_from": request_from},
        )

    async def _await_skill_result(self, execution_id: str):
        if not self._skill_runner_client:
            return None

        latest_result = None
        for attempt in range(self._poll_attempts):
            latest_result = await self._skill_runner_client.get_result(execution_id)
            if latest_result.status not in (
                SkillRunnerExecutionStatus.ACCEPTED,
                SkillRunnerExecutionStatus.RUNNING,
            ):
                return latest_result

            if attempt < self._poll_attempts - 1:
                await asyncio.sleep(self._poll_interval)

        return latest_result

    def _normalize_skill_result(
        self,
        *,
        result: SkillExecutionResult,
        execution_id: str,
        skill: SkillCandidate,
    ) -> SkillExecutionResult:
        trace = result.trace.model_copy(
            update={
                "runner_job_id": result.trace.runner_job_id or execution_id,
            }
        )
        metadata = {
            **result.metadata,
            "execution_id": execution_id,
            "skill_id": skill.skill_id,
            "skill_name": skill.skill_name,
            "runtime_kind": skill.runtime_kind,
            "source_type": skill.source_type,
        }

        return result.model_copy(
            update={
                "trace": trace,
                "metadata": metadata,
            }
        )

    def _annotate_result_metadata(
        self,
        result: dict[str, Any],
        outcome: SkillRoutingOutcome,
    ) -> dict[str, Any]:
        metadata = result.setdefault("metadata", {})
        metadata.setdefault("orchestrator", "deepagents")
        metadata.update(outcome.to_metadata())
        return result

    async def run_skill_first(
        self,
        *,
        query: str,
        request_from: str,
        runtime_identity: Optional[SkillRuntimeIdentity],
        actor_claims: Optional[SkillActorClaims],
        connectors: Sequence[SkillConnector],
        secrets: Sequence[SkillSecret],
        histories: Sequence[QueryHistory],
        skill_config: Optional[dict[str, Any]],
        skills: Sequence[SkillCandidate],
    ) -> SkillRoutingOutcome:
        outcome = SkillRoutingOutcome(
            skill_result=None,
            available_skill_count=len(skills),
        )

        if not self._skill_runner_client:
            outcome.fallback_reason = "skill_runner_unavailable"
            return outcome

        if not self._skill_runner_client.enabled:
            outcome.fallback_reason = "skill_runner_disabled"
            return outcome

        if not runtime_identity:
            outcome.fallback_reason = "runtime_identity_missing"
            return outcome

        if not skills:
            outcome.fallback_reason = "no_skills_configured"
            return outcome

        for skill in skills:
            outcome.attempted_skill_count += 1
            request = self._build_skill_runner_request(
                query=query,
                request_from=request_from,
                runtime_identity=runtime_identity,
                actor_claims=actor_claims,
                connectors=connectors,
                secrets=secrets,
                histories=histories,
                skill_config=skill_config or {},
                skill=skill,
            )

            try:
                execution = await self._skill_runner_client.run(request)
                if execution.status in (
                    SkillRunnerExecutionStatus.ACCEPTED,
                    SkillRunnerExecutionStatus.RUNNING,
                ):
                    execution = await self._await_skill_result(execution.execution_id)

                if (
                    execution
                    and execution.status == SkillRunnerExecutionStatus.SUCCEEDED
                    and execution.result
                    and execution.result.result_type != SkillResultType.ERROR
                ):
                    outcome.skill_result = self._normalize_skill_result(
                        result=execution.result,
                        execution_id=execution.execution_id,
                        skill=skill,
                    )
                    outcome.selected_skill_id = skill.skill_id
                    outcome.selected_skill_name = skill.skill_name
                    outcome.selected_runtime_kind = skill.runtime_kind
                    outcome.selected_source_type = skill.source_type
                    return outcome

                outcome.failed_skill_count += 1
                outcome.last_error = (
                    execution.error.message
                    if execution and execution.error
                    else f"status={execution.status if execution else 'unknown'}"
                )
                logger.warning(
                    "Skill runner fallback to NL2SQL: skill_id=%s status=%s error=%s",
                    skill.skill_id,
                    execution.status if execution else "unknown",
                    execution.error.message if execution and execution.error else None,
                )
            except SkillRunnerClientError as exc:
                outcome.failed_skill_count += 1
                outcome.last_error = str(exc)
                logger.warning(
                    "Skill runner fallback to NL2SQL: skill_id=%s error=%s",
                    skill.skill_id,
                    exc,
                )
            except Exception as exc:
                outcome.failed_skill_count += 1
                outcome.last_error = str(exc)
                logger.warning(
                    "Unexpected skill runner failure, fallback to NL2SQL: skill_id=%s error=%s",
                    skill.skill_id,
                    exc,
                )

        outcome.fallback_reason = "skill_candidates_exhausted"
        return outcome

    async def run(
        self,
        *,
        query: str,
        request_from: str,
        runtime_identity: Optional[SkillRuntimeIdentity],
        actor_claims: Optional[SkillActorClaims],
        connectors: Sequence[SkillConnector],
        secrets: Sequence[SkillSecret],
        histories: Sequence[QueryHistory],
        skill_config: Optional[dict[str, Any]],
        skills: Sequence[SkillCandidate],
        trace_id: Optional[str],
        is_followup: bool,
        set_result: ResultUpdater,
        fallback_runner: FallbackRunner,
    ) -> dict[str, Any]:
        routing_outcome = await self.run_skill_first(
            query=query,
            request_from=request_from,
            runtime_identity=runtime_identity,
            actor_claims=actor_claims,
            connectors=connectors,
            secrets=secrets,
            histories=histories,
            skill_config=skill_config,
            skills=skills,
        )

        skill_result = routing_outcome.skill_result
        if skill_result:
            set_result(
                status="finished",
                type="SKILL",
                skill_result=skill_result,
                trace_id=trace_id,
                is_followup=is_followup,
            )
            result = self._mixed_answer_composer.compose_skill(
                self._mixed_answer_composer.start(request_from=request_from),
                skill_result=skill_result,
            )
            result["metadata"]["ask_path"] = "skill"
            return self._annotate_result_metadata(result, routing_outcome)

        fallback_result = await fallback_runner()
        return self._annotate_result_metadata(fallback_result, routing_outcome)
