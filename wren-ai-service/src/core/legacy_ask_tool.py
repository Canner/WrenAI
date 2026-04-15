from typing import Optional

from src.core.fixed_order_ask_runtime import (
    AskHistoryLike,
    AskRequestLike,
    FixedOrderAskRuntime,
    NL2SQLToolset,
    ResultBuilder,
    ResultUpdater,
    StopChecker,
    extract_skill_instructions,
)
from src.core.mixed_answer_composer import MixedAnswerComposer
from src.core.pipeline import BasicPipeline

__all__ = [
    "AskHistoryLike",
    "AskRequestLike",
    "extract_skill_instructions",
    "LegacyAskTool",
]


class LegacyAskTool:
    def __init__(
        self,
        pipelines: dict[str, BasicPipeline],
        *,
        mixed_answer_composer: Optional[MixedAnswerComposer] = None,
        allow_intent_classification: bool = True,
        allow_sql_generation_reasoning: bool = True,
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        allow_sql_knowledge_retrieval: bool = True,
        enable_column_pruning: bool = False,
        max_sql_correction_retries: int = 3,
        toolset: Optional[NL2SQLToolset] = None,
        runtime: Optional[FixedOrderAskRuntime] = None,
    ):
        self._toolset = toolset or NL2SQLToolset(
            pipelines,
            allow_sql_functions_retrieval=allow_sql_functions_retrieval,
            allow_sql_diagnosis=allow_sql_diagnosis,
            allow_sql_knowledge_retrieval=allow_sql_knowledge_retrieval,
        )
        self._runtime = runtime or FixedOrderAskRuntime(
            toolset=self._toolset,
            mixed_answer_composer=mixed_answer_composer,
            allow_intent_classification=allow_intent_classification,
            allow_sql_generation_reasoning=allow_sql_generation_reasoning,
            enable_column_pruning=enable_column_pruning,
            max_sql_correction_retries=max_sql_correction_retries,
        )

    async def run(
        self,
        *,
        ask_request: AskRequestLike,
        query_id: str,
        trace_id: Optional[str],
        histories: list[AskHistoryLike],
        runtime_scope_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_result: ResultBuilder,
        build_ask_error: ResultBuilder,
        retrieval_scope_id: Optional[str] = None,
    ) -> dict:
        return await self._runtime.run(
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
            orchestrator="legacy",
        )
