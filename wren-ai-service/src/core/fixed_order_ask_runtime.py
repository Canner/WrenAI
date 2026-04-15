import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol, Sequence

from src.core.mixed_answer_composer import MixedAnswerComposer
from src.core.pipeline import BasicPipeline

logger = logging.getLogger("wren-ai-service")


class AskHistoryLike(Protocol):
    sql: str
    question: str


class AskRequestLike(Protocol):
    query: str
    query_id: str
    configurations: Any
    custom_instruction: Optional[str]
    ignore_sql_generation_reasoning: bool
    enable_column_pruning: bool
    use_dry_plan: bool
    allow_dry_plan_fallback: bool
    request_from: str
    skills: Sequence[Any]


class SkillCandidateLike(Protocol):
    instruction: Optional[str]
    skill_id: Optional[str]
    skill_name: Optional[str]


ResultUpdater = Callable[..., None]
ResultBuilder = Callable[..., Any]
StopChecker = Callable[[], bool]


@dataclass
class AskExecutionState:
    user_query: str
    rephrased_question: Optional[str] = None
    intent_reasoning: Optional[str] = None
    sql_generation_reasoning: Any = None
    sql_samples: list[Any] = field(default_factory=list)
    instructions: list[Any] = field(default_factory=list)
    effective_instructions: list[Any] = field(default_factory=list)
    api_results: list[Any] = field(default_factory=list)
    table_names: list[str] = field(default_factory=list)
    error_message: Optional[str] = None
    invalid_sql: Optional[str] = None
    retrieval_result: dict[str, Any] = field(default_factory=dict)
    table_ddls: list[str] = field(default_factory=list)
    ask_path: Optional[str] = None
    current_sql_correction_retries: int = 0


def _normalize_instruction(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None

    normalized_value = value.strip()
    return normalized_value or None


def extract_skill_instructions(
    skills: Sequence[SkillCandidateLike] | Sequence[Any],
) -> list[dict[str, Any]]:
    extracted_instructions: list[dict[str, Any]] = []

    for skill in skills:
        instruction = _normalize_instruction(getattr(skill, "instruction", None))

        if instruction:
            extracted_instructions.append(
                {
                    "instruction": instruction,
                    "source": "skill_definition",
                    "skill_id": getattr(skill, "skill_id", None),
                    "skill_name": getattr(skill, "skill_name", None),
                    "execution_mode": "inject_only",
                }
            )

    return extracted_instructions


class NL2SQLToolset:
    def __init__(
        self,
        pipelines: dict[str, BasicPipeline],
        *,
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        allow_sql_knowledge_retrieval: bool = True,
    ):
        self._pipelines = pipelines
        self._allow_sql_functions_retrieval = allow_sql_functions_retrieval
        self._allow_sql_diagnosis = allow_sql_diagnosis
        self._allow_sql_knowledge_retrieval = allow_sql_knowledge_retrieval

    async def retrieve_historical_question(
        self,
        *,
        query: str,
        retrieval_scope_id: Optional[str],
        build_ask_result: ResultBuilder,
    ) -> list[Any]:
        historical_question = await self._pipelines["historical_question"].run(
            query=query,
            runtime_scope_id=retrieval_scope_id,
        )
        historical_question_result = historical_question.get(
            "formatted_output", {}
        ).get("documents", [])[:1]

        return [
            build_ask_result(
                **{
                    "sql": result.get("statement"),
                    "type": "view" if result.get("viewId") else "llm",
                    "viewId": result.get("viewId"),
                }
            )
            for result in historical_question_result
        ]

    async def retrieve_sql_pairs(
        self,
        *,
        query: str,
        retrieval_scope_id: Optional[str],
    ) -> list[Any]:
        result = await self._pipelines["sql_pairs_retrieval"].run(
            query=query,
            runtime_scope_id=retrieval_scope_id,
        )
        return result["formatted_output"].get("documents", [])

    async def retrieve_instructions(
        self,
        *,
        query: str,
        retrieval_scope_id: Optional[str],
    ) -> list[Any]:
        result = await self._pipelines["instructions_retrieval"].run(
            query=query,
            runtime_scope_id=retrieval_scope_id,
            scope="sql",
        )
        return result["formatted_output"].get("documents", [])

    async def classify_intent(
        self,
        *,
        query: str,
        histories: Sequence[AskHistoryLike],
        sql_samples: Sequence[Any],
        instructions: Sequence[Any],
        runtime_scope_id: Optional[str],
        configuration: Any,
    ) -> dict[str, Any]:
        return (
            await self._pipelines["intent_classification"].run(
                query=query,
                histories=histories,
                sql_samples=sql_samples,
                instructions=instructions,
                runtime_scope_id=runtime_scope_id,
                configuration=configuration,
            )
        ).get("post_process", {})

    async def retrieve_schema(
        self,
        *,
        query: str,
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        enable_column_pruning: bool,
    ) -> dict[str, Any]:
        return await self._pipelines["db_schema_retrieval"].run(
            query=query,
            histories=histories,
            runtime_scope_id=runtime_scope_id,
            enable_column_pruning=enable_column_pruning,
        )

    async def reason_sql_generation(
        self,
        *,
        query: str,
        contexts: Sequence[Any],
        histories: Sequence[AskHistoryLike],
        sql_samples: Sequence[Any],
        instructions: Sequence[Any],
        configuration: Any,
        query_id: str,
    ) -> Any:
        if histories:
            return (
                await self._pipelines["followup_sql_generation_reasoning"].run(
                    query=query,
                    contexts=contexts,
                    histories=histories,
                    sql_samples=sql_samples,
                    instructions=instructions,
                    configuration=configuration,
                    query_id=query_id,
                )
            ).get("post_process", {})

        return (
            await self._pipelines["sql_generation_reasoning"].run(
                query=query,
                contexts=contexts,
                sql_samples=sql_samples,
                instructions=instructions,
                configuration=configuration,
                query_id=query_id,
            )
        ).get("post_process", {})

    async def retrieve_sql_functions(self, *, runtime_scope_id: Optional[str]) -> Any:
        if not self._allow_sql_functions_retrieval:
            return []
        return await self._pipelines["sql_functions_retrieval"].run(
            runtime_scope_id=runtime_scope_id
        )

    async def retrieve_sql_knowledge(self, *, runtime_scope_id: Optional[str]) -> Any:
        if not self._allow_sql_knowledge_retrieval:
            return None
        return await self._pipelines["sql_knowledge_retrieval"].run(
            runtime_scope_id=runtime_scope_id
        )

    async def generate_sql(
        self,
        *,
        query: str,
        contexts: Sequence[Any],
        sql_generation_reasoning: Any,
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        sql_samples: Sequence[Any],
        instructions: Sequence[Any],
        has_calculated_field: bool,
        has_metric: bool,
        has_json_field: bool,
        sql_functions: Any,
        use_dry_plan: bool,
        allow_dry_plan_fallback: bool,
        sql_knowledge: Any,
    ) -> dict[str, Any]:
        if histories:
            return await self._pipelines["followup_sql_generation"].run(
                query=query,
                contexts=contexts,
                sql_generation_reasoning=sql_generation_reasoning,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                sql_samples=sql_samples,
                instructions=instructions,
                has_calculated_field=has_calculated_field,
                has_metric=has_metric,
                has_json_field=has_json_field,
                sql_functions=sql_functions,
                use_dry_plan=use_dry_plan,
                allow_dry_plan_fallback=allow_dry_plan_fallback,
                sql_knowledge=sql_knowledge,
            )

        return await self._pipelines["sql_generation"].run(
            query=query,
            contexts=contexts,
            sql_generation_reasoning=sql_generation_reasoning,
            runtime_scope_id=runtime_scope_id,
            sql_samples=sql_samples,
            instructions=instructions,
            has_calculated_field=has_calculated_field,
            has_metric=has_metric,
            has_json_field=has_json_field,
            sql_functions=sql_functions,
            use_dry_plan=use_dry_plan,
            allow_dry_plan_fallback=allow_dry_plan_fallback,
            sql_knowledge=sql_knowledge,
        )

    async def diagnose_sql(
        self,
        *,
        contexts: Sequence[Any],
        original_sql: str,
        invalid_sql: str,
        error_message: str,
        language: Optional[str],
    ) -> Optional[str]:
        if not self._allow_sql_diagnosis:
            return None

        sql_diagnosis_results = await self._pipelines["sql_diagnosis"].run(
            contexts=contexts,
            original_sql=original_sql,
            invalid_sql=invalid_sql,
            error_message=error_message,
            language=language,
        )
        return sql_diagnosis_results["post_process"].get("reasoning")

    async def correct_sql(
        self,
        *,
        contexts: Sequence[Any],
        instructions: Sequence[Any],
        invalid_generation_result: dict[str, Any],
        runtime_scope_id: Optional[str],
        use_dry_plan: bool,
        allow_dry_plan_fallback: bool,
        sql_functions: Any,
        sql_knowledge: Any,
    ) -> dict[str, Any]:
        return await self._pipelines["sql_correction"].run(
            contexts=contexts,
            instructions=instructions,
            invalid_generation_result=invalid_generation_result,
            runtime_scope_id=runtime_scope_id,
            use_dry_plan=use_dry_plan,
            allow_dry_plan_fallback=allow_dry_plan_fallback,
            sql_functions=sql_functions,
            sql_knowledge=sql_knowledge,
        )


class BaseFixedOrderAskRuntime:
    def __init__(
        self,
        *,
        toolset: NL2SQLToolset,
        mixed_answer_composer: Optional[MixedAnswerComposer] = None,
        allow_intent_classification: bool = True,
        allow_sql_generation_reasoning: bool = True,
        enable_column_pruning: bool = False,
        max_sql_correction_retries: int = 3,
    ):
        self._toolset = toolset
        self._mixed_answer_composer = mixed_answer_composer or MixedAnswerComposer()
        self._allow_intent_classification = allow_intent_classification
        self._allow_sql_generation_reasoning = allow_sql_generation_reasoning
        self._enable_column_pruning = enable_column_pruning
        self._max_sql_correction_retries = max_sql_correction_retries

    def _attach_result_metadata(
        self,
        result: dict[str, Any],
        *,
        ask_path: Optional[str],
        orchestrator: str,
    ) -> dict[str, Any]:
        metadata = result.setdefault("metadata", {})
        metadata["orchestrator"] = orchestrator
        if ask_path:
            metadata["ask_path"] = ask_path
        return result

    def _resolve_text_to_sql_path(
        self,
        *,
        histories: Sequence[AskHistoryLike],
        sql_samples: Sequence[Any],
        instructions: Sequence[Any],
        current_sql_correction_retries: int,
    ) -> str:
        if current_sql_correction_retries > 0:
            return "correction"
        if histories:
            return "followup"
        if sql_samples:
            return "sql_pairs"
        if instructions:
            return "instructions"
        return "nl2sql"

    def _build_initial_state(self, ask_request: AskRequestLike) -> AskExecutionState:
        return AskExecutionState(user_query=ask_request.query)

    async def _handle_intent_result(
        self,
        *,
        state: AskExecutionState,
        intent_classification_result: dict[str, Any],
        ask_request: AskRequestLike,
        histories: Sequence[AskHistoryLike],
        trace_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        results: dict[str, Any],
        orchestrator: str,
    ) -> Optional[dict[str, Any]]:
        intent = intent_classification_result.get("intent")
        state.rephrased_question = intent_classification_result.get(
            "rephrased_question"
        )
        state.intent_reasoning = intent_classification_result.get("reasoning")

        if state.rephrased_question:
            state.user_query = state.rephrased_question

        if intent == "MISLEADING_QUERY":
            state.ask_path = "general"
            asyncio.create_task(
                self._toolset._pipelines["misleading_assistance"].run(
                    query=state.user_query,
                    histories=histories,
                    db_schemas=intent_classification_result.get("db_schemas"),
                    language=ask_request.configurations.language,
                    query_id=ask_request.query_id,
                    custom_instruction=ask_request.custom_instruction,
                )
            )

            if not is_stopped():
                set_result(
                    status="finished",
                    type="GENERAL",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                    general_type="MISLEADING_QUERY",
                )
            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_general(
                    results,
                    metadata_type="MISLEADING_QUERY",
                ),
                ask_path=state.ask_path,
                orchestrator=orchestrator,
            )

        if intent == "GENERAL":
            state.ask_path = "general"
            asyncio.create_task(
                self._toolset._pipelines["data_assistance"].run(
                    query=state.user_query,
                    histories=histories,
                    db_schemas=intent_classification_result.get("db_schemas"),
                    language=ask_request.configurations.language,
                    query_id=ask_request.query_id,
                    custom_instruction=ask_request.custom_instruction,
                )
            )

            if not is_stopped():
                set_result(
                    status="finished",
                    type="GENERAL",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                    general_type="DATA_ASSISTANCE",
                )
            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_general(results),
                ask_path=state.ask_path,
                orchestrator=orchestrator,
            )

        if intent == "USER_GUIDE":
            state.ask_path = "general"
            asyncio.create_task(
                self._toolset._pipelines["user_guide_assistance"].run(
                    query=state.user_query,
                    language=ask_request.configurations.language,
                    query_id=ask_request.query_id,
                    custom_instruction=ask_request.custom_instruction,
                )
            )

            if not is_stopped():
                set_result(
                    status="finished",
                    type="GENERAL",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                    general_type="USER_GUIDE",
                )
            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_general(results),
                ask_path=state.ask_path,
                orchestrator=orchestrator,
            )

        if not is_stopped():
            set_result(
                status="understanding",
                type="TEXT_TO_SQL",
                rephrased_question=state.rephrased_question,
                intent_reasoning=state.intent_reasoning,
                trace_id=trace_id,
                is_followup=is_followup,
            )

        return None

    async def _run_text_to_sql_resolution(
        self,
        *,
        state: AskExecutionState,
        ask_request: AskRequestLike,
        query_id: str,
        trace_id: Optional[str],
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_result: ResultBuilder,
        build_ask_error: ResultBuilder,
        results: dict[str, Any],
        orchestrator: str,
        allow_sql_generation_reasoning: bool,
        enable_column_pruning: bool,
    ) -> dict[str, Any]:
        use_dry_plan = ask_request.use_dry_plan
        allow_dry_plan_fallback = ask_request.allow_dry_plan_fallback

        if not is_stopped() and not state.api_results:
            set_result(
                status="searching",
                type="TEXT_TO_SQL",
                rephrased_question=state.rephrased_question,
                intent_reasoning=state.intent_reasoning,
                trace_id=trace_id,
                is_followup=is_followup,
            )

            retrieval_response = await self._toolset.retrieve_schema(
                query=state.user_query,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                enable_column_pruning=enable_column_pruning,
            )
            state.retrieval_result = retrieval_response.get(
                "construct_retrieval_results", {}
            )
            documents = state.retrieval_result.get("retrieval_results", [])
            state.table_names = [document.get("table_name") for document in documents]
            state.table_ddls = [document.get("table_ddl") for document in documents]

            if not documents:
                logger.exception("ask pipeline - NO_RELEVANT_DATA: %s", state.user_query)
                if not is_stopped():
                    set_result(
                        status="failed",
                        type="TEXT_TO_SQL",
                        error=build_ask_error(
                            code="NO_RELEVANT_DATA",
                            message="No relevant data",
                        ),
                        rephrased_question=state.rephrased_question,
                        intent_reasoning=state.intent_reasoning,
                        trace_id=trace_id,
                        is_followup=is_followup,
                    )
                return self._attach_result_metadata(
                    self._mixed_answer_composer.compose_text_to_sql_failure(
                        results,
                        error_type="NO_RELEVANT_DATA",
                    ),
                    ask_path=state.ask_path
                    or self._resolve_text_to_sql_path(
                        histories=histories,
                        sql_samples=state.sql_samples,
                        instructions=state.effective_instructions,
                        current_sql_correction_retries=state.current_sql_correction_retries,
                    ),
                    orchestrator=orchestrator,
                )

        if not is_stopped() and not state.api_results and allow_sql_generation_reasoning:
            set_result(
                status="planning",
                type="TEXT_TO_SQL",
                rephrased_question=state.rephrased_question,
                intent_reasoning=state.intent_reasoning,
                retrieved_tables=state.table_names,
                trace_id=trace_id,
                is_followup=is_followup,
            )

            state.sql_generation_reasoning = await self._toolset.reason_sql_generation(
                query=state.user_query,
                contexts=state.table_ddls,
                histories=histories,
                sql_samples=state.sql_samples,
                instructions=state.effective_instructions,
                configuration=ask_request.configurations,
                query_id=query_id,
            )

            set_result(
                status="planning",
                type="TEXT_TO_SQL",
                rephrased_question=state.rephrased_question,
                intent_reasoning=state.intent_reasoning,
                retrieved_tables=state.table_names,
                sql_generation_reasoning=state.sql_generation_reasoning,
                trace_id=trace_id,
                is_followup=is_followup,
            )

        if not is_stopped() and not state.api_results:
            set_result(
                status="generating",
                type="TEXT_TO_SQL",
                rephrased_question=state.rephrased_question,
                intent_reasoning=state.intent_reasoning,
                retrieved_tables=state.table_names,
                sql_generation_reasoning=state.sql_generation_reasoning,
                trace_id=trace_id,
                is_followup=is_followup,
            )

            sql_functions, sql_knowledge = await asyncio.gather(
                self._toolset.retrieve_sql_functions(runtime_scope_id=runtime_scope_id),
                self._toolset.retrieve_sql_knowledge(runtime_scope_id=runtime_scope_id),
            )

            has_calculated_field = state.retrieval_result.get(
                "has_calculated_field", False
            )
            has_metric = state.retrieval_result.get("has_metric", False)
            has_json_field = state.retrieval_result.get("has_json_field", False)

            text_to_sql_generation_results = await self._toolset.generate_sql(
                query=state.user_query,
                contexts=state.table_ddls,
                sql_generation_reasoning=state.sql_generation_reasoning,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                sql_samples=state.sql_samples,
                instructions=state.effective_instructions,
                has_calculated_field=has_calculated_field,
                has_metric=has_metric,
                has_json_field=has_json_field,
                sql_functions=sql_functions,
                use_dry_plan=use_dry_plan,
                allow_dry_plan_fallback=allow_dry_plan_fallback,
                sql_knowledge=sql_knowledge,
            )

            if sql_valid_result := text_to_sql_generation_results["post_process"][
                "valid_generation_result"
            ]:
                state.api_results = [
                    build_ask_result(
                        **{
                            "sql": sql_valid_result.get("sql"),
                            "type": "llm",
                        }
                    )
                ]
            elif failed_dry_run_result := text_to_sql_generation_results[
                "post_process"
            ]["invalid_generation_result"]:
                while state.current_sql_correction_retries < self._max_sql_correction_retries:
                    if failed_dry_run_result["type"] == "TIME_OUT":
                        break

                    original_sql = failed_dry_run_result["original_sql"]
                    state.invalid_sql = failed_dry_run_result["sql"]
                    state.error_message = failed_dry_run_result["error"]
                    state.current_sql_correction_retries += 1

                    set_result(
                        status="correcting",
                        type="TEXT_TO_SQL",
                        rephrased_question=state.rephrased_question,
                        intent_reasoning=state.intent_reasoning,
                        retrieved_tables=state.table_names,
                        sql_generation_reasoning=state.sql_generation_reasoning,
                        trace_id=trace_id,
                        is_followup=is_followup,
                    )

                    sql_diagnosis_reasoning = await self._toolset.diagnose_sql(
                        contexts=state.table_ddls,
                        original_sql=original_sql,
                        invalid_sql=state.invalid_sql,
                        error_message=state.error_message,
                        language=ask_request.configurations.language,
                    )

                    sql_correction_results = await self._toolset.correct_sql(
                        contexts=state.table_ddls,
                        instructions=state.effective_instructions,
                        invalid_generation_result={
                            "sql": original_sql,
                            "error": sql_diagnosis_reasoning
                            or state.error_message,
                        },
                        runtime_scope_id=runtime_scope_id,
                        use_dry_plan=use_dry_plan,
                        allow_dry_plan_fallback=allow_dry_plan_fallback,
                        sql_functions=sql_functions,
                        sql_knowledge=sql_knowledge,
                    )

                    if valid_generation_result := sql_correction_results[
                        "post_process"
                    ]["valid_generation_result"]:
                        state.api_results = [
                            build_ask_result(
                                **{
                                    "sql": valid_generation_result.get("sql"),
                                    "type": "llm",
                                }
                            )
                        ]
                        break

                    failed_dry_run_result = sql_correction_results["post_process"][
                        "invalid_generation_result"
                    ]

        if state.api_results:
            if not is_stopped():
                set_result(
                    status="finished",
                    type="TEXT_TO_SQL",
                    response=state.api_results,
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    retrieved_tables=state.table_names,
                    sql_generation_reasoning=state.sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
            self._mixed_answer_composer.compose_text_to_sql_success(
                results,
                api_results=state.api_results,
            )
        else:
            logger.exception("ask pipeline - NO_RELEVANT_SQL: %s", state.user_query)
            if not is_stopped():
                set_result(
                    status="failed",
                    type="TEXT_TO_SQL",
                    error=build_ask_error(
                        code="NO_RELEVANT_SQL",
                        message=state.error_message or "No relevant SQL",
                    ),
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    retrieved_tables=state.table_names,
                    sql_generation_reasoning=state.sql_generation_reasoning,
                    invalid_sql=state.invalid_sql,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
            self._mixed_answer_composer.compose_text_to_sql_failure(
                results,
                error_type="NO_RELEVANT_SQL",
                error_message=state.error_message,
            )

        return self._attach_result_metadata(
            results,
            ask_path=state.ask_path
            or self._resolve_text_to_sql_path(
                histories=histories,
                sql_samples=state.sql_samples,
                instructions=state.effective_instructions,
                current_sql_correction_retries=state.current_sql_correction_retries,
            ),
            orchestrator=orchestrator,
        )


class LegacyFixedOrderAskRuntime(BaseFixedOrderAskRuntime):
    async def run(
        self,
        *,
        ask_request: AskRequestLike,
        query_id: str,
        trace_id: Optional[str],
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        retrieval_scope_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_result: ResultBuilder,
        build_ask_error: ResultBuilder,
        orchestrator: str,
    ) -> dict[str, Any]:
        retrieval_scope_id = retrieval_scope_id or runtime_scope_id
        results = self._mixed_answer_composer.start(
            request_from=ask_request.request_from
        )
        state = self._build_initial_state(ask_request)
        allow_sql_generation_reasoning = (
            self._allow_sql_generation_reasoning
            and not ask_request.ignore_sql_generation_reasoning
        )
        enable_column_pruning = (
            self._enable_column_pruning or ask_request.enable_column_pruning
        )

        try:
            if not is_stopped():
                set_result(
                    status="understanding",
                    trace_id=trace_id,
                    is_followup=is_followup,
                )

                state.api_results = await self._toolset.retrieve_historical_question(
                    query=state.user_query,
                    retrieval_scope_id=retrieval_scope_id,
                    build_ask_result=build_ask_result,
                )

                if state.api_results:
                    state.ask_path = "historical"
                    state.sql_generation_reasoning = ""
                else:
                    state.sql_samples, state.instructions = await asyncio.gather(
                        self._toolset.retrieve_sql_pairs(
                            query=state.user_query,
                            retrieval_scope_id=retrieval_scope_id,
                        ),
                        self._toolset.retrieve_instructions(
                            query=state.user_query,
                            retrieval_scope_id=retrieval_scope_id,
                        ),
                    )
                    state.effective_instructions = [
                        *state.instructions,
                        *extract_skill_instructions(ask_request.skills),
                    ]

                    if self._allow_intent_classification:
                        early_result = await self._handle_intent_result(
                            state=state,
                            intent_classification_result=await self._toolset.classify_intent(
                                query=state.user_query,
                                histories=histories,
                                sql_samples=state.sql_samples,
                                instructions=state.effective_instructions,
                                runtime_scope_id=runtime_scope_id,
                                configuration=ask_request.configurations,
                            ),
                            ask_request=ask_request,
                            histories=histories,
                            trace_id=trace_id,
                            is_followup=is_followup,
                            is_stopped=is_stopped,
                            set_result=set_result,
                            results=results,
                            orchestrator=orchestrator,
                        )
                        if early_result is not None:
                            return early_result

            return await self._run_text_to_sql_resolution(
                state=state,
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
                results=results,
                orchestrator=orchestrator,
                allow_sql_generation_reasoning=allow_sql_generation_reasoning,
                enable_column_pruning=enable_column_pruning,
            )
        except Exception as e:
            logger.exception("ask pipeline - OTHERS: %s", e)

            set_result(
                status="failed",
                type="TEXT_TO_SQL",
                error=build_ask_error(
                    code="OTHERS",
                    message=str(e),
                ),
                trace_id=trace_id,
                is_followup=is_followup,
            )

            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_text_to_sql_failure(
                    results,
                    error_type="OTHERS",
                    error_message=str(e),
                ),
                ask_path=state.ask_path
                or self._resolve_text_to_sql_path(
                    histories=histories,
                    sql_samples=state.sql_samples,
                    instructions=state.effective_instructions,
                    current_sql_correction_retries=state.current_sql_correction_retries,
                ),
                orchestrator=orchestrator,
            )


class DeepAgentsFixedOrderAskRuntime(BaseFixedOrderAskRuntime):
    async def run(
        self,
        *,
        ask_request: AskRequestLike,
        query_id: str,
        trace_id: Optional[str],
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        retrieval_scope_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_result: ResultBuilder,
        build_ask_error: ResultBuilder,
        orchestrator: str,
    ) -> dict[str, Any]:
        retrieval_scope_id = retrieval_scope_id or runtime_scope_id
        results = self._mixed_answer_composer.start(
            request_from=ask_request.request_from
        )
        state = self._build_initial_state(ask_request)
        allow_sql_generation_reasoning = (
            self._allow_sql_generation_reasoning
            and not ask_request.ignore_sql_generation_reasoning
        )
        enable_column_pruning = (
            self._enable_column_pruning or ask_request.enable_column_pruning
        )

        try:
            if not is_stopped():
                set_result(
                    status="understanding",
                    trace_id=trace_id,
                    is_followup=is_followup,
                )

                state.sql_samples, state.instructions = await asyncio.gather(
                    self._toolset.retrieve_sql_pairs(
                        query=state.user_query,
                        retrieval_scope_id=retrieval_scope_id,
                    ),
                    self._toolset.retrieve_instructions(
                        query=state.user_query,
                        retrieval_scope_id=retrieval_scope_id,
                    ),
                )
                state.effective_instructions = [
                    *state.instructions,
                    *extract_skill_instructions(ask_request.skills),
                ]

                if self._allow_intent_classification:
                    early_result = await self._handle_intent_result(
                        state=state,
                        intent_classification_result=await self._toolset.classify_intent(
                            query=state.user_query,
                            histories=histories,
                            sql_samples=state.sql_samples,
                            instructions=state.effective_instructions,
                            runtime_scope_id=runtime_scope_id,
                            configuration=ask_request.configurations,
                        ),
                        ask_request=ask_request,
                        histories=histories,
                        trace_id=trace_id,
                        is_followup=is_followup,
                        is_stopped=is_stopped,
                        set_result=set_result,
                        results=results,
                        orchestrator=orchestrator,
                    )
                    if early_result is not None:
                        return early_result

            if not is_stopped():
                set_result(
                    status="searching",
                    type="TEXT_TO_SQL",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )

                state.api_results = await self._toolset.retrieve_historical_question(
                    query=state.user_query,
                    retrieval_scope_id=retrieval_scope_id,
                    build_ask_result=build_ask_result,
                )

                if state.api_results:
                    state.ask_path = "historical"
                    state.sql_generation_reasoning = ""

            return await self._run_text_to_sql_resolution(
                state=state,
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
                results=results,
                orchestrator=orchestrator,
                allow_sql_generation_reasoning=allow_sql_generation_reasoning,
                enable_column_pruning=enable_column_pruning,
            )
        except Exception as e:
            logger.exception("ask pipeline - OTHERS: %s", e)

            set_result(
                status="failed",
                type="TEXT_TO_SQL",
                error=build_ask_error(
                    code="OTHERS",
                    message=str(e),
                ),
                trace_id=trace_id,
                is_followup=is_followup,
            )

            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_text_to_sql_failure(
                    results,
                    error_type="OTHERS",
                    error_message=str(e),
                ),
                ask_path=state.ask_path
                or self._resolve_text_to_sql_path(
                    histories=histories,
                    sql_samples=state.sql_samples,
                    instructions=state.effective_instructions,
                    current_sql_correction_retries=state.current_sql_correction_retries,
                ),
                orchestrator=orchestrator,
            )


FixedOrderAskRuntime = LegacyFixedOrderAskRuntime
