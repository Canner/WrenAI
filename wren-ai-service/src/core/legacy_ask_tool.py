import asyncio
import logging
from typing import Any, Awaitable, Callable, Optional, Protocol, Sequence

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


ResultUpdater = Callable[..., None]
ResultBuilder = Callable[..., Any]
StopChecker = Callable[[], bool]
SkillFirstRunner = Callable[
    [str, Sequence[AskHistoryLike]],
    Awaitable[Optional[Any]],
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
    ):
        self._pipelines = pipelines
        self._mixed_answer_composer = mixed_answer_composer or MixedAnswerComposer()
        self._allow_intent_classification = allow_intent_classification
        self._allow_sql_generation_reasoning = allow_sql_generation_reasoning
        self._allow_sql_functions_retrieval = allow_sql_functions_retrieval
        self._allow_sql_diagnosis = allow_sql_diagnosis
        self._allow_sql_knowledge_retrieval = allow_sql_knowledge_retrieval
        self._enable_column_pruning = enable_column_pruning
        self._max_sql_correction_retries = max_sql_correction_retries

    def _attach_ask_path(
        self, result: dict[str, Any], ask_path: Optional[str]
    ) -> dict[str, Any]:
        if ask_path:
            result.setdefault("metadata", {})["ask_path"] = ask_path
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

    async def run(
        self,
        *,
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
        run_skill_first: Optional[SkillFirstRunner] = None,
    ) -> dict[str, Any]:
        results = self._mixed_answer_composer.start(
            request_from=ask_request.request_from
        )

        rephrased_question = None
        intent_reasoning = None
        sql_generation_reasoning = None
        sql_samples = []
        instructions = []
        api_results = []
        table_names = []
        error_message = None
        invalid_sql = None
        allow_sql_generation_reasoning = (
            self._allow_sql_generation_reasoning
            and not ask_request.ignore_sql_generation_reasoning
        )
        enable_column_pruning = (
            self._enable_column_pruning or ask_request.enable_column_pruning
        )
        current_sql_correction_retries = 0
        use_dry_plan = ask_request.use_dry_plan
        allow_dry_plan_fallback = ask_request.allow_dry_plan_fallback
        sql_knowledge = None
        _retrieval_result = {}
        table_ddls = []
        ask_path = None

        try:
            user_query = ask_request.query

            if not is_stopped():
                set_result(
                    status="understanding",
                    trace_id=trace_id,
                    is_followup=is_followup,
                )

                historical_question = await self._pipelines["historical_question"].run(
                    query=user_query,
                    project_id=runtime_scope_id,
                )

                historical_question_result = historical_question.get(
                    "formatted_output", {}
                ).get("documents", [])[:1]

                if historical_question_result:
                    ask_path = "historical"
                    api_results = [
                        build_ask_result(
                            **{
                                "sql": result.get("statement"),
                                "type": "view" if result.get("viewId") else "llm",
                                "viewId": result.get("viewId"),
                            }
                        )
                        for result in historical_question_result
                    ]
                    sql_generation_reasoning = ""
                else:
                    if run_skill_first is not None:
                        skill_result = await run_skill_first(user_query, histories)
                        if skill_result:
                            ask_path = "skill"
                            set_result(
                                status="finished",
                                type="SKILL",
                                skill_result=skill_result,
                                trace_id=trace_id,
                                is_followup=is_followup,
                            )
                            return self._attach_ask_path(
                                self._mixed_answer_composer.compose_skill(
                                    results,
                                    skill_result=skill_result,
                                ),
                                ask_path,
                            )

                    sql_samples_task, instructions_task = await asyncio.gather(
                        self._pipelines["sql_pairs_retrieval"].run(
                            query=user_query,
                            project_id=runtime_scope_id,
                        ),
                        self._pipelines["instructions_retrieval"].run(
                            query=user_query,
                            project_id=runtime_scope_id,
                            scope="sql",
                        ),
                    )

                    sql_samples = sql_samples_task["formatted_output"].get(
                        "documents", []
                    )
                    instructions = instructions_task["formatted_output"].get(
                        "documents", []
                    )

                    if self._allow_intent_classification:
                        intent_classification_result = (
                            await self._pipelines["intent_classification"].run(
                                query=user_query,
                                histories=histories,
                                sql_samples=sql_samples,
                                instructions=instructions,
                                project_id=runtime_scope_id,
                                configuration=ask_request.configurations,
                            )
                        ).get("post_process", {})
                        intent = intent_classification_result.get("intent")
                        rephrased_question = intent_classification_result.get(
                            "rephrased_question"
                        )
                        intent_reasoning = intent_classification_result.get("reasoning")

                        if rephrased_question:
                            user_query = rephrased_question

                        if intent == "MISLEADING_QUERY":
                            ask_path = "general"
                            asyncio.create_task(
                                self._pipelines["misleading_assistance"].run(
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    query_id=ask_request.query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            set_result(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=is_followup,
                                general_type="MISLEADING_QUERY",
                            )
                            return self._attach_ask_path(
                                self._mixed_answer_composer.compose_general(
                                    results,
                                    metadata_type="MISLEADING_QUERY",
                                ),
                                ask_path,
                            )
                        if intent == "GENERAL":
                            ask_path = "general"
                            asyncio.create_task(
                                self._pipelines["data_assistance"].run(
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    query_id=ask_request.query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            set_result(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=is_followup,
                                general_type="DATA_ASSISTANCE",
                            )
                            return self._attach_ask_path(
                                self._mixed_answer_composer.compose_general(results),
                                ask_path,
                            )
                        if intent == "USER_GUIDE":
                            ask_path = "general"
                            asyncio.create_task(
                                self._pipelines["user_guide_assistance"].run(
                                    query=user_query,
                                    language=ask_request.configurations.language,
                                    query_id=ask_request.query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            set_result(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=is_followup,
                                general_type="USER_GUIDE",
                            )
                            return self._attach_ask_path(
                                self._mixed_answer_composer.compose_general(results),
                                ask_path,
                            )

                        set_result(
                            status="understanding",
                            type="TEXT_TO_SQL",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            trace_id=trace_id,
                            is_followup=is_followup,
                        )

            if not is_stopped() and not api_results:
                set_result(
                    status="searching",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )

                retrieval_result = await self._pipelines["db_schema_retrieval"].run(
                    query=user_query,
                    histories=histories,
                    project_id=runtime_scope_id,
                    enable_column_pruning=enable_column_pruning,
                )
                _retrieval_result = retrieval_result.get(
                    "construct_retrieval_results", {}
                )
                documents = _retrieval_result.get("retrieval_results", [])
                table_names = [document.get("table_name") for document in documents]
                table_ddls = [document.get("table_ddl") for document in documents]

                if not documents:
                    logger.exception(f"ask pipeline - NO_RELEVANT_DATA: {user_query}")
                    if not is_stopped():
                        set_result(
                            status="failed",
                            type="TEXT_TO_SQL",
                            error=build_ask_error(
                                code="NO_RELEVANT_DATA",
                                message="No relevant data",
                            ),
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            trace_id=trace_id,
                            is_followup=is_followup,
                        )
                    return self._attach_ask_path(
                        self._mixed_answer_composer.compose_text_to_sql_failure(
                            results,
                            error_type="NO_RELEVANT_DATA",
                        ),
                        ask_path
                        or self._resolve_text_to_sql_path(
                            histories=histories,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            current_sql_correction_retries=current_sql_correction_retries,
                        ),
                    )

            if not is_stopped() and not api_results and allow_sql_generation_reasoning:
                set_result(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )

                if histories:
                    sql_generation_reasoning = (
                        await self._pipelines["followup_sql_generation_reasoning"].run(
                            query=user_query,
                            contexts=table_ddls,
                            histories=histories,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            configuration=ask_request.configurations,
                            query_id=query_id,
                        )
                    ).get("post_process", {})
                else:
                    sql_generation_reasoning = (
                        await self._pipelines["sql_generation_reasoning"].run(
                            query=user_query,
                            contexts=table_ddls,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            configuration=ask_request.configurations,
                            query_id=query_id,
                        )
                    ).get("post_process", {})

                set_result(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )

            if not is_stopped() and not api_results:
                set_result(
                    status="generating",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )

                if self._allow_sql_functions_retrieval:
                    sql_functions = await self._pipelines[
                        "sql_functions_retrieval"
                    ].run(project_id=runtime_scope_id)
                else:
                    sql_functions = []

                if self._allow_sql_knowledge_retrieval:
                    sql_knowledge = await self._pipelines[
                        "sql_knowledge_retrieval"
                    ].run(project_id=runtime_scope_id)

                has_calculated_field = _retrieval_result.get(
                    "has_calculated_field", False
                )
                has_metric = _retrieval_result.get("has_metric", False)
                has_json_field = _retrieval_result.get("has_json_field", False)

                if histories:
                    text_to_sql_generation_results = await self._pipelines[
                        "followup_sql_generation"
                    ].run(
                        query=user_query,
                        contexts=table_ddls,
                        sql_generation_reasoning=sql_generation_reasoning,
                        histories=histories,
                        project_id=runtime_scope_id,
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
                else:
                    text_to_sql_generation_results = await self._pipelines[
                        "sql_generation"
                    ].run(
                        query=user_query,
                        contexts=table_ddls,
                        sql_generation_reasoning=sql_generation_reasoning,
                        project_id=runtime_scope_id,
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

                if sql_valid_result := text_to_sql_generation_results["post_process"][
                    "valid_generation_result"
                ]:
                    api_results = [
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
                    while current_sql_correction_retries < self._max_sql_correction_retries:
                        if failed_dry_run_result["type"] == "TIME_OUT":
                            break

                        original_sql = failed_dry_run_result["original_sql"]
                        invalid_sql = failed_dry_run_result["sql"]
                        error_message = failed_dry_run_result["error"]
                        current_sql_correction_retries += 1

                        set_result(
                            status="correcting",
                            type="TEXT_TO_SQL",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            retrieved_tables=table_names,
                            sql_generation_reasoning=sql_generation_reasoning,
                            trace_id=trace_id,
                            is_followup=is_followup,
                        )

                        if self._allow_sql_diagnosis:
                            sql_diagnosis_results = await self._pipelines[
                                "sql_diagnosis"
                            ].run(
                                contexts=table_ddls,
                                original_sql=original_sql,
                                invalid_sql=invalid_sql,
                                error_message=error_message,
                                language=ask_request.configurations.language,
                            )
                            sql_diagnosis_reasoning = sql_diagnosis_results[
                                "post_process"
                            ].get("reasoning")

                        sql_correction_results = await self._pipelines[
                            "sql_correction"
                        ].run(
                            contexts=table_ddls,
                            instructions=instructions,
                            invalid_generation_result={
                                "sql": original_sql,
                                "error": sql_diagnosis_reasoning
                                if self._allow_sql_diagnosis
                                else error_message,
                            },
                            project_id=runtime_scope_id,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_functions=sql_functions,
                            sql_knowledge=sql_knowledge,
                        )

                        if valid_generation_result := sql_correction_results[
                            "post_process"
                        ]["valid_generation_result"]:
                            api_results = [
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

            if api_results:
                if not is_stopped():
                    set_result(
                        status="finished",
                        type="TEXT_TO_SQL",
                        response=api_results,
                        rephrased_question=rephrased_question,
                        intent_reasoning=intent_reasoning,
                        retrieved_tables=table_names,
                        sql_generation_reasoning=sql_generation_reasoning,
                        trace_id=trace_id,
                        is_followup=is_followup,
                    )
                self._mixed_answer_composer.compose_text_to_sql_success(
                    results,
                    api_results=api_results,
                )
            else:
                logger.exception(f"ask pipeline - NO_RELEVANT_SQL: {user_query}")
                if not is_stopped():
                    set_result(
                        status="failed",
                        type="TEXT_TO_SQL",
                        error=build_ask_error(
                            code="NO_RELEVANT_SQL",
                            message=error_message or "No relevant SQL",
                        ),
                        rephrased_question=rephrased_question,
                        intent_reasoning=intent_reasoning,
                        retrieved_tables=table_names,
                        sql_generation_reasoning=sql_generation_reasoning,
                        invalid_sql=invalid_sql,
                        trace_id=trace_id,
                        is_followup=is_followup,
                    )
                self._mixed_answer_composer.compose_text_to_sql_failure(
                    results,
                    error_type="NO_RELEVANT_SQL",
                    error_message=error_message,
                )

            return self._attach_ask_path(
                results,
                ask_path
                or self._resolve_text_to_sql_path(
                    histories=histories,
                    sql_samples=sql_samples,
                    instructions=instructions,
                    current_sql_correction_retries=current_sql_correction_retries,
                ),
            )
        except Exception as e:
            logger.exception(f"ask pipeline - OTHERS: {e}")

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

            return self._attach_ask_path(
                self._mixed_answer_composer.compose_text_to_sql_failure(
                    results,
                    error_type="OTHERS",
                    error_message=str(e),
                ),
                ask_path
                or self._resolve_text_to_sql_path(
                    histories=histories,
                    sql_samples=sql_samples,
                    instructions=instructions,
                    current_sql_correction_retries=current_sql_correction_retries,
                ),
            )
