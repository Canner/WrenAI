import asyncio
import logging
from typing import Any, Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, SSEEvent

logger = logging.getLogger("wren-ai-service")


async def run_pipeline_with_timeout(awaitable, timeout_seconds: float, operation: str):
    try:
        logger.info(
            "%s started with timeout_seconds=%s",
            operation,
            timeout_seconds,
        )
        return await asyncio.wait_for(awaitable, timeout=timeout_seconds)
    except asyncio.TimeoutError as exc:
        logger.error(
            "%s timed out after %s seconds",
            operation,
            timeout_seconds,
        )
        raise TimeoutError(
            f"{operation} timed out after {timeout_seconds:g} seconds"
        ) from exc


def get_pipeline_timeout_seconds(
    pipeline: BasicPipeline,
    default_timeout_seconds: float,
) -> float:
    pipeline_timeout_seconds = getattr(pipeline, "generation_timeout_seconds", None)

    if pipeline_timeout_seconds is None:
        return default_timeout_seconds

    return max(default_timeout_seconds, pipeline_timeout_seconds)


class AskHistory(BaseModel):
    sql: str
    question: str


def build_schema_grounding_context(documents: list[dict[str, Any]]) -> str:
    lines: list[str] = []

    for document in documents:
        table_name = document.get("table_name")
        if not table_name:
            continue

        lines.append(f'- model/table: "{table_name}"')

        selected_columns = [
            column for column in document.get("column_names", []) if column
        ]
        manifest_columns = [
            column for column in document.get("manifest_column_names", []) if column
        ]
        columns = selected_columns or manifest_columns
        if columns:
            lines.append("  columns:")
            lines.extend(f'    - "{column}"' for column in columns)

        relationship_constraints = [
            constraint
            for constraint in document.get("relationship_constraints", [])
            if constraint
        ]
        if relationship_constraints:
            lines.append("  relationships:")
            lines.extend(
                f"    - {constraint}" for constraint in relationship_constraints
            )

    return "\n".join(lines)


def is_schema_grounding_error(failed_generation_result: dict[str, Any]) -> bool:
    return failed_generation_result.get("type") == "SCHEMA_GROUNDING"


def build_sql_correction_error_message(
    error_message: str | None,
    sql_diagnosis_reasoning: str | None = None,
) -> str:
    error_message = error_message or ""
    sql_diagnosis_reasoning = sql_diagnosis_reasoning or ""

    if not sql_diagnosis_reasoning:
        return error_message

    if sql_diagnosis_reasoning in error_message:
        return error_message

    return f"{error_message}\nDiagnostic reasoning: {sql_diagnosis_reasoning}"


def build_sql_correction_input(
    failed_generation_result: dict[str, Any],
    correction_error_message: str,
) -> dict[str, str]:
    if is_schema_grounding_error(failed_generation_result):
        return {
            "sql": "",
            "type": failed_generation_result.get("type", ""),
            "error": correction_error_message,
        }

    return {
        "sql": failed_generation_result.get("original_sql")
        or failed_generation_result.get("sql", ""),
        "type": failed_generation_result.get("type", ""),
        "error": correction_error_message,
    }


def build_sql_regeneration_source_sql(
    failed_generation_result: dict[str, Any],
) -> str:
    if is_schema_grounding_error(failed_generation_result):
        return ""

    return failed_generation_result.get("original_sql") or failed_generation_result.get(
        "sql", ""
    )


def build_sql_generation_reasoning_text(
    sql_generation_reasoning: Any,
) -> str:
    if isinstance(sql_generation_reasoning, dict):
        return sql_generation_reasoning.get("reasoning", "") or ""

    return sql_generation_reasoning or ""


# POST /v1/asks
class AskRequest(BaseRequest):
    query: str
    # don't recommend to use id as a field name, but it's used in the older version of API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: Optional[str] = Field(validation_alias=AliasChoices("mdl_hash", "id"))
    histories: Optional[list[AskHistory]] = Field(default_factory=list)
    ignore_sql_generation_reasoning: bool = True
    enable_column_pruning: bool = False
    use_dry_plan: bool = True
    allow_dry_plan_fallback: bool = False
    custom_instruction: Optional[str] = None


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
    code: Literal[
        "NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "ASK_RESULT_NOT_FOUND", "OTHERS"
    ]
    message: str


class AskResultRequest(BaseModel):
    query_id: str


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
    type: Optional[Literal["GENERAL", "TEXT_TO_SQL"]] = None
    retrieved_tables: Optional[List[str]] = None
    response: Optional[List[AskResult]] = None
    invalid_sql: Optional[str] = None
    error: Optional[AskError] = None
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
        allow_intent_classification: bool = True,
        allow_sql_generation_reasoning: bool = False,
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        allow_sql_knowledge_retrieval: bool = True,
        enable_column_pruning: bool = False,
        max_sql_correction_retries: int = 3,
        sql_generation_timeout_seconds: float = 45.0,
        max_histories: int = 5,
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._ask_results: Dict[str, AskResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._allow_sql_generation_reasoning = allow_sql_generation_reasoning
        self._allow_sql_functions_retrieval = allow_sql_functions_retrieval
        self._allow_intent_classification = allow_intent_classification
        self._allow_sql_diagnosis = allow_sql_diagnosis
        self._allow_sql_knowledge_retrieval = allow_sql_knowledge_retrieval
        self._enable_column_pruning = enable_column_pruning
        self._max_histories = max_histories
        self._max_sql_correction_retries = max_sql_correction_retries
        self._sql_generation_timeout_seconds = sql_generation_timeout_seconds

    def _is_stopped(self, query_id: str, container: dict):
        if (
            result := container.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    @observe(name="Ask Question")
    @trace_metadata
    async def ask(
        self,
        ask_request: AskRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        results = {
            "ask_result": {},
            "metadata": {
                "type": "",
                "error_type": "",
                "error_message": "",
                "request_from": ask_request.request_from,
            },
        }

        query_id = ask_request.query_id
        histories = ask_request.histories[: self._max_histories][
            ::-1
        ]  # reverse the order of histories
        rephrased_question = None
        intent_reasoning = None
        sql_generation_reasoning = None
        sql_samples = []
        instructions = []
        api_results = []
        table_names = []
        schema_grounding = ""
        error_message = None
        invalid_sql = None
        allow_sql_generation_reasoning = (
            self._allow_sql_generation_reasoning
            and not ask_request.ignore_sql_generation_reasoning
        )
        enable_column_pruning = (
            self._enable_column_pruning or ask_request.enable_column_pruning
        )
        allow_sql_functions_retrieval = self._allow_sql_functions_retrieval
        allow_sql_diagnosis = self._allow_sql_diagnosis
        allow_sql_knowledge_retrieval = self._allow_sql_knowledge_retrieval
        max_sql_correction_retries = self._max_sql_correction_retries
        current_sql_correction_retries = 0
        use_dry_plan = ask_request.use_dry_plan
        allow_dry_plan_fallback = ask_request.allow_dry_plan_fallback
        sql_knowledge = None

        try:
            user_query = ask_request.query

            # ask status can be understanding, searching, generating, finished, failed, stopped
            # we will need to handle business logic for each status
            if not self._is_stopped(query_id, self._ask_results):
                self._ask_results[query_id] = AskResultResponse(
                    status="understanding",
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                historical_question = await self._pipelines["historical_question"].run(
                    query=user_query,
                    project_id=ask_request.project_id,
                    mdl_hash=ask_request.mdl_hash,
                )

                # we only return top 1 result
                historical_question_result = historical_question.get(
                    "formatted_output", {}
                ).get("documents", [])[:1]

                if historical_question_result:
                    api_results = [
                        AskResult(
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
                    # Run both pipeline operations concurrently
                    sql_samples_task, instructions_task = await asyncio.gather(
                        self._pipelines["sql_pairs_retrieval"].run(
                            query=user_query,
                            project_id=ask_request.project_id,
                            mdl_hash=ask_request.mdl_hash,
                        ),
                        self._pipelines["instructions_retrieval"].run(
                            query=user_query,
                            project_id=ask_request.project_id,
                            mdl_hash=ask_request.mdl_hash,
                            scope="sql",
                        ),
                    )

                    # Extract results from completed tasks
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
                                project_id=ask_request.project_id,
                                mdl_hash=ask_request.mdl_hash,
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

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="MISLEADING_QUERY",
                            )
                            results["metadata"]["type"] = "MISLEADING_QUERY"
                            return results
                        elif intent == "GENERAL":
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

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="DATA_ASSISTANCE",
                            )
                            results["metadata"]["type"] = "GENERAL"
                            return results
                        elif intent == "USER_GUIDE":
                            asyncio.create_task(
                                self._pipelines["user_guide_assistance"].run(
                                    query=user_query,
                                    language=ask_request.configurations.language,
                                    query_id=ask_request.query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="USER_GUIDE",
                            )
                            results["metadata"]["type"] = "GENERAL"
                            return results
                        else:
                            self._ask_results[query_id] = AskResultResponse(
                                status="understanding",
                                type="TEXT_TO_SQL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                            )
            if not self._is_stopped(query_id, self._ask_results) and not api_results:
                self._ask_results[query_id] = AskResultResponse(
                    status="searching",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                retrieval_result = await self._pipelines["db_schema_retrieval"].run(
                    query=user_query,
                    histories=histories,
                    project_id=ask_request.project_id,
                    mdl_hash=ask_request.mdl_hash,
                    enable_column_pruning=enable_column_pruning,
                )
                _retrieval_result = retrieval_result.get(
                    "construct_retrieval_results", {}
                )
                documents = _retrieval_result.get("retrieval_results", [])
                table_names = [document.get("table_name") for document in documents]
                table_ddls = [document.get("table_ddl") for document in documents]
                schema_grounding = build_schema_grounding_context(documents)

                if not documents:
                    logger.warning(f"ask pipeline - NO_RELEVANT_DATA: {user_query}")
                    if not self._is_stopped(query_id, self._ask_results):
                        self._ask_results[query_id] = AskResultResponse(
                            status="failed",
                            type="TEXT_TO_SQL",
                            error=AskError(
                                code="NO_RELEVANT_DATA",
                                message="No relevant data",
                            ),
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )
                    results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

            if (
                not self._is_stopped(query_id, self._ask_results)
                and not api_results
                and allow_sql_generation_reasoning
            ):
                self._ask_results[query_id] = AskResultResponse(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                if histories:
                    sql_generation_reasoning = (
                        await self._pipelines["followup_sql_generation_reasoning"].run(
                            query=user_query,
                            contexts=table_ddls,
                            schema_grounding=schema_grounding,
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
                            schema_grounding=schema_grounding,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            configuration=ask_request.configurations,
                            query_id=query_id,
                        )
                    ).get("post_process", {})

                self._ask_results[query_id] = AskResultResponse(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

            if not self._is_stopped(query_id, self._ask_results) and not api_results:
                self._ask_results[query_id] = AskResultResponse(
                    status="generating",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                if allow_sql_functions_retrieval:
                    sql_functions = await self._pipelines[
                        "sql_functions_retrieval"
                    ].run(
                        project_id=ask_request.project_id,
                        mdl_hash=ask_request.mdl_hash,
                    )
                else:
                    sql_functions = []

                if allow_sql_knowledge_retrieval:
                    sql_knowledge = await self._pipelines[
                        "sql_knowledge_retrieval"
                    ].run(
                        project_id=ask_request.project_id,
                        mdl_hash=ask_request.mdl_hash,
                    )

                has_calculated_field = _retrieval_result.get(
                    "has_calculated_field", False
                )
                has_metric = _retrieval_result.get("has_metric", False)
                has_json_field = _retrieval_result.get("has_json_field", False)

                if histories:
                    sql_generation_pipeline = self._pipelines[
                        "followup_sql_generation"
                    ]
                    text_to_sql_generation_results = await run_pipeline_with_timeout(
                        sql_generation_pipeline.run(
                            query=user_query,
                            contexts=table_ddls,
                            schema_grounding=schema_grounding,
                            sql_generation_reasoning=sql_generation_reasoning,
                            histories=histories,
                            project_id=ask_request.project_id,
                            mdl_hash=ask_request.mdl_hash,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            has_calculated_field=has_calculated_field,
                            has_metric=has_metric,
                            has_json_field=has_json_field,
                            sql_functions=sql_functions,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_knowledge=sql_knowledge,
                        ),
                        get_pipeline_timeout_seconds(
                            sql_generation_pipeline,
                            self._sql_generation_timeout_seconds,
                        ),
                        "Follow-up SQL generation",
                    )
                else:
                    sql_generation_pipeline = self._pipelines["sql_generation"]
                    text_to_sql_generation_results = await run_pipeline_with_timeout(
                        sql_generation_pipeline.run(
                            query=user_query,
                            contexts=table_ddls,
                            schema_grounding=schema_grounding,
                            sql_generation_reasoning=sql_generation_reasoning,
                            project_id=ask_request.project_id,
                            mdl_hash=ask_request.mdl_hash,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            has_calculated_field=has_calculated_field,
                            has_metric=has_metric,
                            has_json_field=has_json_field,
                            sql_functions=sql_functions,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_knowledge=sql_knowledge,
                        ),
                        get_pipeline_timeout_seconds(
                            sql_generation_pipeline,
                            self._sql_generation_timeout_seconds,
                        ),
                        "SQL generation",
                    )

                if sql_valid_result := text_to_sql_generation_results["post_process"][
                    "valid_generation_result"
                ]:
                    api_results = [
                        AskResult(
                            **{
                                "sql": sql_valid_result.get("sql"),
                                "type": "llm",
                            }
                        )
                    ]
                elif failed_dry_run_result := text_to_sql_generation_results[
                    "post_process"
                ]["invalid_generation_result"]:
                    while current_sql_correction_retries < max_sql_correction_retries:
                        if failed_dry_run_result["type"] == "TIME_OUT":
                            break

                        original_sql = failed_dry_run_result["original_sql"]
                        invalid_sql = failed_dry_run_result["sql"]
                        error_message = failed_dry_run_result["error"]
                        current_sql_correction_retries += 1

                        self._ask_results[query_id] = AskResultResponse(
                            status="correcting",
                            type="TEXT_TO_SQL",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            retrieved_tables=table_names,
                            sql_generation_reasoning=sql_generation_reasoning,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )

                        sql_diagnosis_reasoning = None
                        if is_schema_grounding_error(
                            failed_dry_run_result
                        ) and self._pipelines.get("sql_regeneration"):
                            sql_regeneration_pipeline = self._pipelines[
                                "sql_regeneration"
                            ]
                            sql_regeneration_results = (
                                await run_pipeline_with_timeout(
                                    sql_regeneration_pipeline.run(
                                        contexts=table_ddls,
                                        query=user_query,
                                        sql_generation_reasoning=build_sql_generation_reasoning_text(
                                            sql_generation_reasoning
                                        ),
                                        sql=build_sql_regeneration_source_sql(
                                            failed_dry_run_result
                                        ),
                                        schema_grounding=schema_grounding,
                                        sql_samples=sql_samples,
                                        instructions=instructions,
                                        project_id=ask_request.project_id,
                                        mdl_hash=ask_request.mdl_hash,
                                        has_calculated_field=has_calculated_field,
                                        has_metric=has_metric,
                                        has_json_field=has_json_field,
                                        sql_functions=sql_functions,
                                        sql_knowledge=sql_knowledge,
                                        use_dry_plan=use_dry_plan,
                                        allow_dry_plan_fallback=allow_dry_plan_fallback,
                                    ),
                                    get_pipeline_timeout_seconds(
                                        sql_regeneration_pipeline,
                                        self._sql_generation_timeout_seconds,
                                    ),
                                    "SQL regeneration",
                                )
                            )

                            if valid_generation_result := sql_regeneration_results[
                                "post_process"
                            ]["valid_generation_result"]:
                                api_results = [
                                    AskResult(
                                        **{
                                            "sql": valid_generation_result.get("sql"),
                                            "type": "llm",
                                        }
                                    )
                                ]
                                break

                            if next_failed_result := sql_regeneration_results[
                                "post_process"
                            ]["invalid_generation_result"]:
                                failed_dry_run_result = next_failed_result
                                if failed_dry_run_result["type"] == "TIME_OUT":
                                    break
                                original_sql = failed_dry_run_result["original_sql"]
                                invalid_sql = failed_dry_run_result["sql"]
                                error_message = failed_dry_run_result["error"]

                        if allow_sql_diagnosis and not is_schema_grounding_error(
                            failed_dry_run_result
                        ):
                            sql_diagnosis_pipeline = self._pipelines[
                                "sql_diagnosis"
                            ]
                            sql_diagnosis_results = await run_pipeline_with_timeout(
                                sql_diagnosis_pipeline.run(
                                    contexts=table_ddls,
                                    original_sql=original_sql,
                                    invalid_sql=invalid_sql,
                                    error_message=error_message,
                                    language=ask_request.configurations.language,
                                    schema_grounding=schema_grounding,
                                    data_source=failed_dry_run_result.get(
                                        "data_source"
                                    ),
                                ),
                                get_pipeline_timeout_seconds(
                                    sql_diagnosis_pipeline,
                                    self._sql_generation_timeout_seconds,
                                ),
                                "SQL diagnosis",
                            )
                            sql_diagnosis_reasoning = sql_diagnosis_results[
                                "post_process"
                            ].get("reasoning")

                        correction_error_message = build_sql_correction_error_message(
                            error_message,
                            sql_diagnosis_reasoning,
                        )

                        sql_correction_pipeline = self._pipelines["sql_correction"]
                        sql_correction_results = await run_pipeline_with_timeout(
                            sql_correction_pipeline.run(
                                contexts=table_ddls,
                                schema_grounding=schema_grounding,
                                query=user_query,
                                instructions=instructions,
                                invalid_generation_result=build_sql_correction_input(
                                    failed_dry_run_result,
                                    correction_error_message,
                                ),
                                project_id=ask_request.project_id,
                                mdl_hash=ask_request.mdl_hash,
                                use_dry_plan=use_dry_plan,
                                allow_dry_plan_fallback=allow_dry_plan_fallback,
                                sql_functions=sql_functions,
                                sql_knowledge=sql_knowledge,
                            ),
                            get_pipeline_timeout_seconds(
                                sql_correction_pipeline,
                                self._sql_generation_timeout_seconds,
                            ),
                            "SQL correction",
                        )

                        if valid_generation_result := sql_correction_results[
                            "post_process"
                        ]["valid_generation_result"]:
                            api_results = [
                                AskResult(
                                    **{
                                        "sql": valid_generation_result.get("sql"),
                                        "type": "llm",
                                    }
                                )
                            ]
                            break

                        next_failed_dry_run_result = sql_correction_results[
                            "post_process"
                        ]["invalid_generation_result"]
                        failed_dry_run_result = next_failed_dry_run_result

            if api_results:
                if not self._is_stopped(query_id, self._ask_results):
                    self._ask_results[query_id] = AskResultResponse(
                        status="finished",
                        type="TEXT_TO_SQL",
                        response=api_results,
                        rephrased_question=rephrased_question,
                        intent_reasoning=intent_reasoning,
                        retrieved_tables=table_names,
                        sql_generation_reasoning=sql_generation_reasoning,
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                results["ask_result"] = api_results
                results["metadata"]["type"] = "TEXT_TO_SQL"
            else:
                logger.warning(f"ask pipeline - NO_RELEVANT_SQL: {user_query}")
                if not self._is_stopped(query_id, self._ask_results):
                    self._ask_results[query_id] = AskResultResponse(
                        status="failed",
                        type="TEXT_TO_SQL",
                        error=AskError(
                            code="NO_RELEVANT_SQL",
                            message=error_message or "No relevant SQL",
                        ),
                        rephrased_question=rephrased_question,
                        intent_reasoning=intent_reasoning,
                        retrieved_tables=table_names,
                        sql_generation_reasoning=sql_generation_reasoning,
                        invalid_sql=invalid_sql,
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                results["metadata"]["error_message"] = error_message
                results["metadata"]["type"] = "TEXT_TO_SQL"

            return results
        except Exception as e:
            logger.exception(f"ask pipeline - OTHERS: {e}")

            self._ask_results[query_id] = AskResultResponse(
                status="failed",
                type="TEXT_TO_SQL",
                error=AskError(
                    code="OTHERS",
                    message=str(e),
                ),
                trace_id=trace_id,
                is_followup=True if histories else False,
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            results["metadata"]["type"] = "TEXT_TO_SQL"
            return results

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
            logger.warning(
                f"ask pipeline - ASK_RESULT_NOT_FOUND: {ask_result_request.query_id} is not found"
            )
            return AskResultResponse(
                status="failed",
                type="TEXT_TO_SQL",
                error=AskError(
                    code="ASK_RESULT_NOT_FOUND",
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
