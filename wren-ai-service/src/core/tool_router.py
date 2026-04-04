import logging
from typing import Any, Callable, Optional, Protocol, Sequence

from src.core.deepagents_orchestrator import DeepAgentsAskOrchestrator
from src.core.legacy_ask_tool import AskHistoryLike, AskRequestLike, LegacyAskTool
from src.core.trace_compare import build_shadow_compare

logger = logging.getLogger("wren-ai-service")


class RuntimeIdentityCarrier(Protocol):
    def to_skill_runtime_identity(self) -> Any: ...


class AskRequestWithRuntimeIdentity(AskRequestLike, Protocol):
    runtime_identity: Optional[RuntimeIdentityCarrier]
    actor_claims: Any
    connectors: Sequence[Any]
    secrets: Sequence[Any]
    skill_config: dict[str, Any]
    skills: Sequence[Any]


ResultBuilder = Callable[..., Any]
ResultUpdater = Callable[..., None]
StopChecker = Callable[[], bool]


class ToolRouter:
    def __init__(
        self,
        *,
        legacy_ask_tool: LegacyAskTool,
        deepagents_orchestrator: DeepAgentsAskOrchestrator,
        ask_shadow_compare_enabled: bool = False,
    ):
        self._legacy_ask_tool = legacy_ask_tool
        self._deepagents_orchestrator = deepagents_orchestrator
        self._ask_shadow_compare_enabled = ask_shadow_compare_enabled

    def _annotate_primary_fallback(
        self,
        result: dict[str, Any],
        *,
        fallback_reason: str,
        deepagents_error: Optional[str] = None,
    ) -> dict[str, Any]:
        metadata = result.setdefault("metadata", {})
        metadata["fallback_reason"] = fallback_reason
        if deepagents_error:
            metadata["deepagents_error"] = deepagents_error
        return result

    def _annotate_runtime_metadata(
        self,
        result: dict[str, Any],
        *,
        ask_runtime_mode: str,
        resolved_runtime: str,
    ) -> dict[str, Any]:
        metadata = result.setdefault("metadata", {})
        primary_runtime = "deepagents" if ask_runtime_mode == "deepagents" else "legacy"
        metadata.setdefault("ask_runtime_mode", ask_runtime_mode)
        metadata.setdefault("primary_runtime", primary_runtime)
        metadata["resolved_runtime"] = resolved_runtime
        metadata["deepagents_fallback"] = (
            primary_runtime == "deepagents" and resolved_runtime != "deepagents"
        )
        return result

    def _resolve_runtime(
        self,
        result: dict[str, Any],
        *,
        ask_runtime_mode: str,
    ) -> str:
        if ask_runtime_mode != "deepagents":
            return "legacy"

        metadata = result.setdefault("metadata", {})
        if metadata.get("fallback_reason"):
            return "legacy"
        if metadata.get("type") == "SKILL":
            return "deepagents"
        return metadata.get("resolved_runtime", "legacy")

    async def run_ask(
        self,
        *,
        ask_runtime_mode: str,
        ask_request: AskRequestWithRuntimeIdentity,
        query_id: str,
        trace_id: Optional[str],
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_result: ResultBuilder,
        build_ask_error: ResultBuilder,
    ) -> dict[str, Any]:
        async def fallback_runner():
            return await self._legacy_ask_tool.run(
                ask_request=ask_request,
                query_id=query_id,
                trace_id=trace_id,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                is_followup=is_followup,
                is_stopped=is_stopped,
                set_result=set_result,
                build_ask_result=build_ask_result,
                build_ask_error=build_ask_error,
                run_skill_first=None,
            )

        async def shadow_runner():
            return await self._legacy_ask_tool.run(
                ask_request=ask_request,
                query_id=query_id,
                trace_id=trace_id,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                is_followup=is_followup,
                is_stopped=lambda: False,
                set_result=lambda **_: None,
                build_ask_result=build_ask_result,
                build_ask_error=build_ask_error,
                run_skill_first=None,
            )

        if ask_runtime_mode == "deepagents":
            try:
                primary_result = await self._deepagents_orchestrator.run(
                    query=ask_request.query,
                    request_from=ask_request.request_from,
                    runtime_identity=ask_request.runtime_identity.to_skill_runtime_identity()
                    if ask_request.runtime_identity
                    else None,
                    actor_claims=ask_request.actor_claims,
                    connectors=ask_request.connectors,
                    secrets=ask_request.secrets,
                    histories=histories,
                    skill_config=ask_request.skill_config,
                    skills=ask_request.skills,
                    trace_id=trace_id,
                    is_followup=is_followup,
                    set_result=set_result,
                    fallback_runner=fallback_runner,
                )
            except Exception as exc:
                logger.warning(
                    "Deepagents primary path failed, fallback to legacy ask: trace_id=%s error=%s",
                    trace_id,
                    exc,
                )
                primary_result = self._annotate_primary_fallback(
                    await fallback_runner(),
                    fallback_reason="deepagents_error",
                    deepagents_error=str(exc),
                )
            primary_result = self._annotate_runtime_metadata(
                primary_result,
                ask_runtime_mode=ask_runtime_mode,
                resolved_runtime=self._resolve_runtime(
                    primary_result,
                    ask_runtime_mode=ask_runtime_mode,
                ),
            )
            if not self._ask_shadow_compare_enabled:
                return primary_result

            metadata = primary_result.setdefault("metadata", {})
            primary_type = metadata.get("type")
            if primary_type != "SKILL":
                metadata["shadow_compare"] = build_shadow_compare(
                    enabled=True,
                    executed=False,
                    primary_result=primary_result,
                    reason=(
                        metadata.get("fallback_reason")
                        or metadata.get("deepagents_routing_reason")
                        or "primary_fallback"
                    ),
                )
                logger.info(
                    "Shadow compare skipped: trace_id=%s primary_type=%s primary_path=%s primary_sql=%s reason=%s",
                    trace_id,
                    metadata["shadow_compare"]["primary_type"],
                    metadata["shadow_compare"]["primary_ask_path"],
                    metadata["shadow_compare"]["primary_sql"],
                    metadata["shadow_compare"]["reason"],
                )
                return primary_result

            try:
                shadow_result = await shadow_runner()
                metadata["shadow_compare"] = build_shadow_compare(
                    enabled=True,
                    executed=True,
                    primary_result=primary_result,
                    shadow_result=shadow_result,
                )
                logger.info(
                    "Shadow compare completed: trace_id=%s primary_type=%s shadow_type=%s shadow_error_type=%s shadow_sql=%s shadow_result_count=%s matched=%s",
                    trace_id,
                    metadata["shadow_compare"]["primary_type"],
                    metadata["shadow_compare"]["shadow_type"],
                    metadata["shadow_compare"]["shadow_error_type"],
                    metadata["shadow_compare"]["shadow_sql"],
                    metadata["shadow_compare"]["shadow_result_count"],
                    metadata["shadow_compare"]["matched"],
                )
            except Exception as exc:
                logger.warning(
                    "Legacy shadow compare failed: trace_id=%s error=%s",
                    trace_id,
                    exc,
                )
                metadata["shadow_compare"] = build_shadow_compare(
                    enabled=True,
                    executed=True,
                    primary_result=primary_result,
                    shadow_error=str(exc),
                    reason="shadow_error",
                )
            return primary_result

        return self._annotate_runtime_metadata(
            await fallback_runner(),
            ask_runtime_mode=ask_runtime_mode,
            resolved_runtime="legacy",
        )
