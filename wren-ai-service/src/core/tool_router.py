import asyncio
import hashlib
import logging
from typing import Any, Callable, Optional, Protocol, Sequence

from src.core.deepagents_orchestrator import DeepAgentsAskOrchestrator
from src.core.legacy_ask_tool import AskHistoryLike, AskRequestLike, LegacyAskTool
from src.core.trace_compare import build_shadow_compare

logger = logging.getLogger("wren-ai-service")


class AskRequestWithRuntimeIdentity(AskRequestLike, Protocol):
    skills: Sequence[Any]


ResultBuilder = Callable[..., Any]
ResultUpdater = Callable[..., None]
StopChecker = Callable[[], bool]
ShadowCompareRecorder = Callable[[dict[str, Any]], None]


class ToolRouter:
    def __init__(
        self,
        *,
        legacy_ask_tool: LegacyAskTool,
        deepagents_orchestrator: DeepAgentsAskOrchestrator,
        ask_shadow_compare_enabled: bool = False,
        ask_shadow_compare_sample_rate: float = 0.1,
    ):
        self._legacy_ask_tool = legacy_ask_tool
        self._deepagents_orchestrator = deepagents_orchestrator
        self._ask_shadow_compare_enabled = ask_shadow_compare_enabled
        self._ask_shadow_compare_sample_rate = min(
            max(ask_shadow_compare_sample_rate, 0.0),
            1.0,
        )

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
        metadata["resolved_runtime"] = "legacy"
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
        return metadata.get("orchestrator", metadata.get("resolved_runtime", "legacy"))

    def _should_execute_shadow_compare(self, query_id: str) -> bool:
        if not self._ask_shadow_compare_enabled:
            return False
        if self._ask_shadow_compare_sample_rate >= 1:
            return True
        if self._ask_shadow_compare_sample_rate <= 0:
            return False

        bucket = int(
            hashlib.sha256(query_id.encode("utf-8")).hexdigest()[:8],
            16,
        ) / 0xFFFFFFFF
        return bucket < self._ask_shadow_compare_sample_rate

    def _emit_shadow_compare(
        self,
        *,
        metadata: dict[str, Any],
        shadow_compare: dict[str, Any],
        trace_id: Optional[str],
        on_shadow_compare: Optional[ShadowCompareRecorder],
    ) -> None:
        metadata["shadow_compare"] = shadow_compare
        if on_shadow_compare is None:
            return
        try:
            on_shadow_compare(shadow_compare)
        except Exception as callback_exc:
            logger.warning(
                "Failed to record shadow compare: trace_id=%s error=%s",
                trace_id,
                callback_exc,
            )

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
        retrieval_scope_id: Optional[str] = None,
        on_shadow_compare: Optional[ShadowCompareRecorder] = None,
    ) -> dict[str, Any]:
        retrieval_scope_id = retrieval_scope_id or runtime_scope_id

        async def fallback_runner():
            return await self._legacy_ask_tool.run(
                ask_request=ask_request,
                query_id=query_id,
                trace_id=trace_id,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                retrieval_scope_id=retrieval_scope_id,
                is_followup=is_followup,
                is_stopped=is_stopped,
                set_result=set_result,
                build_ask_result=build_ask_result,
                build_ask_error=build_ask_error,
            )

        async def shadow_runner():
            return await self._legacy_ask_tool.run(
                ask_request=ask_request,
                query_id=query_id,
                trace_id=trace_id,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                retrieval_scope_id=retrieval_scope_id,
                is_followup=is_followup,
                is_stopped=lambda: False,
                set_result=lambda **_: None,
                build_ask_result=build_ask_result,
                build_ask_error=build_ask_error,
            )

        if ask_runtime_mode == "deepagents":
            try:
                primary_result = await self._deepagents_orchestrator.run(
                    ask_request=ask_request,
                    query_id=query_id,
                    trace_id=trace_id,
                    histories=list(histories),
                    runtime_scope_id=runtime_scope_id,
                    retrieval_scope_id=retrieval_scope_id,
                    is_followup=is_followup,
                    is_stopped=is_stopped,
                    set_result=set_result,
                    build_ask_result=build_ask_result,
                    build_ask_error=build_ask_error,
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

            metadata = primary_result.setdefault("metadata", {})
            if not self._ask_shadow_compare_enabled:
                return primary_result

            fallback_reason = metadata.get("fallback_reason")
            if fallback_reason:
                self._emit_shadow_compare(
                    metadata=metadata,
                    shadow_compare=build_shadow_compare(
                        enabled=True,
                        executed=False,
                        primary_result=primary_result,
                        reason=fallback_reason,
                    ),
                    trace_id=trace_id,
                    on_shadow_compare=on_shadow_compare,
                )
                return primary_result

            if not self._should_execute_shadow_compare(query_id):
                self._emit_shadow_compare(
                    metadata=metadata,
                    shadow_compare=build_shadow_compare(
                        enabled=True,
                        executed=False,
                        primary_result=primary_result,
                        reason="sample_skipped",
                    ),
                    trace_id=trace_id,
                    on_shadow_compare=on_shadow_compare,
                )
                return primary_result

            primary_type = metadata.get("type")
            if primary_type != "TEXT_TO_SQL":
                self._emit_shadow_compare(
                    metadata=metadata,
                    shadow_compare=build_shadow_compare(
                        enabled=True,
                        executed=False,
                        primary_result=primary_result,
                        reason="non_comparable_primary_type",
                    ),
                    trace_id=trace_id,
                    on_shadow_compare=on_shadow_compare,
                )
                return primary_result

            async def execute_shadow_compare() -> None:
                try:
                    shadow_result = await shadow_runner()
                    shadow_compare = build_shadow_compare(
                        enabled=True,
                        executed=True,
                        primary_result=primary_result,
                        shadow_result=shadow_result,
                    )
                except Exception as exc:
                    logger.warning(
                        "Legacy shadow compare failed: trace_id=%s error=%s",
                        trace_id,
                        exc,
                    )
                    shadow_compare = build_shadow_compare(
                        enabled=True,
                        executed=True,
                        primary_result=primary_result,
                        shadow_error=str(exc),
                        reason="shadow_error",
                    )

                self._emit_shadow_compare(
                    metadata=metadata,
                    shadow_compare=shadow_compare,
                    trace_id=trace_id,
                    on_shadow_compare=on_shadow_compare,
                )

            asyncio.create_task(execute_shadow_compare())
            return primary_result

        return self._annotate_runtime_metadata(
            await fallback_runner(),
            ask_runtime_mode=ask_runtime_mode,
            resolved_runtime="legacy",
        )
