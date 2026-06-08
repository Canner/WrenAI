import asyncio
import logging
import re
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, SSEEvent

logger = logging.getLogger("wren-ai-service")


async def _return_value(value):
    return value


class AskHistory(BaseModel):
    sql: str
    question: str


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
    type: Optional[Literal["GENERAL", "TEXT_TO_SQL", "MISLEADING_QUERY"]] = None
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
        allow_sql_generation_reasoning: bool = True,
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        allow_sql_knowledge_retrieval: bool = True,
        enable_column_pruning: bool = False,
        max_sql_correction_retries: int = 3,
        pipeline_timeout_seconds: int = 90,
        max_histories: int = 5,
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._ask_results: Dict[str, AskResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._general_streaming_results: Dict[str, str] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._allow_sql_generation_reasoning = allow_sql_generation_reasoning
        self._allow_sql_functions_retrieval = allow_sql_functions_retrieval
        self._allow_intent_classification = allow_intent_classification
        self._allow_sql_diagnosis = allow_sql_diagnosis
        self._allow_sql_knowledge_retrieval = allow_sql_knowledge_retrieval
        self._enable_column_pruning = enable_column_pruning
        self._pipeline_timeout_seconds = pipeline_timeout_seconds
        self._max_histories = max_histories
        self._max_sql_correction_retries = max_sql_correction_retries

    def _is_stopped(self, query_id: str, container: dict):
        if (
            result := container.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    def _is_greeting_query(self, query: str) -> bool:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        greeting_patterns = {
            "hi",
            "hello",
            "hey",
            "hii",
            "hola",
            "good morning",
            "good afternoon",
            "good evening",
            "how are you",
            "thanks",
            "thank you",
        }
        return normalized in greeting_patterns

    def _is_data_analysis_query(self, query: str) -> bool:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return False

        analysis_terms = {
            "average",
            "avg",
            "bar chart",
            "chart",
            "compare",
            "count",
            "debug",
            "failure",
            "group",
            "grouped",
            "monthly",
            "pcb",
            "quarter",
            "repair",
            "resolved",
            "trend",
            "turnaround",
            "volume",
        }
        return any(term in normalized for term in analysis_terms)

    def _is_schema_grounded_query(
        self, query: str, db_schemas: Optional[list[str]] = None
    ) -> bool:
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return False

        explicit_schema_terms = (
            "table",
            "column",
            "schema",
            "dataset",
            "dbo.",
            "select ",
            " from ",
            " join ",
            " where ",
            " group by ",
            " order by ",
        )
        if any(term in normalized for term in explicit_schema_terms):
            return True

        identifier_tokens = re.findall(r"[a-zA-Z_][a-zA-Z0-9_\.]*", normalized)
        if any("." in token for token in identifier_tokens):
            return True

        for schema in db_schemas or []:
            schema_text = schema.lower()
            table_matches = re.findall(
                r"create\s+table\s+([a-zA-Z0-9_\.\"]+)", schema_text
            )
            column_matches = re.findall(r"\n\s*\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?\s+", schema_text)
            candidates = {
                token.strip('"')
                for token in table_matches + column_matches
                if token and len(token.strip('"')) > 2
            }
            if any(candidate in normalized for candidate in candidates):
                return True

        return False

    def _get_unqueryable_metric_message(
        self, query: str, table_ddls: list[str]
    ) -> str | None:
        normalized_query = re.sub(r"\s+", " ", (query or "").strip().lower())
        normalized_schema = re.sub(r"\s+", " ", " ".join(table_ddls).lower())

        if not normalized_query:
            return None

        first_pass_yield_terms = (
            "first pass yield",
            "first-pass yield",
            "first_pass_yield",
            "fpy",
        )
        if not any(term in normalized_query for term in first_pass_yield_terms):
            return None

        required_field_patterns = (
            r"\bfirst[_ ]?pass[_ ]?yield\b",
            r"\bfpy\b",
            r"\battempt\b",
            r"\battempt[_ ]?number\b",
            r"\bfirst[_ ]?attempt\b",
            r"\bpass[_ ]?fail\b",
            r"\byield\b",
        )
        has_required_field = any(
            re.search(pattern, normalized_schema)
            for pattern in required_field_patterns
        )

        if has_required_field:
            return None

        return (
            "The schema does not expose first-pass yield, attempt number, "
            "first-attempt result, or pass/fail fields as queryable columns. "
            "I cannot calculate First Pass Yield from only generic JSON/text "
            "fields such as data. Add those fields as first-class columns or "
            "calculated fields, then ask again."
        )

    async def _run_with_timeout(self, label: str, coroutine):
        try:
            return await asyncio.wait_for(
                coroutine,
                timeout=self._pipeline_timeout_seconds,
            )
        except TimeoutError as exc:
            raise TimeoutError(
                f"{label} timed out after {self._pipeline_timeout_seconds} seconds"
            ) from exc

    def _build_greeting_response(self, query: str) -> str:
        return (
            f"Hi. I can help with questions about your PCB database and Wren AI.\n\n"
            f"Try a data question like:\n"
            f"- Show repair trends for the last 12 months\n"
            f"- Compare average debug hours by product family\n"
            f"- Which failure codes occur most often?\n\n"
            f"If you want, ask a database question directly instead of `{query}`."
        )

    def _extract_pipeline_reply(self, result: dict, key: str) -> str:
        payload = result.get(key)
        if isinstance(payload, tuple):
            payload = payload[0]

        if isinstance(payload, dict):
            replies = payload.get("replies") or []
            if replies and isinstance(replies[0], str):
                return replies[0]

        return ""

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
        if not query_id:
            raise ValueError("query_id is required for ask service execution")

        logger.info(f"Ask pipeline started for query_id: {query_id}")
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

                if self._is_greeting_query(user_query):
                    self._general_streaming_results[query_id] = (
                        self._build_greeting_response(user_query)
                    )

                    self._ask_results[query_id] = AskResultResponse(
                        status="finished",
                        type="GENERAL",
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                        general_type="USER_GUIDE",
                    )
                    results["metadata"]["type"] = "GENERAL"
                    return results

                historical_question = await self._run_with_timeout(
                    "Historical question retrieval",
                    self._pipelines["historical_question"].run(
                        query=user_query,
                        project_id=ask_request.project_id,
                    ),
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
                    original_user_query = user_query
                    # Run both pipeline operations concurrently
                    sql_samples_task, instructions_task = await self._run_with_timeout(
                        "SQL pair and instruction retrieval",
                        asyncio.gather(
                            self._pipelines["sql_pairs_retrieval"].run(
                                query=user_query,
                                project_id=ask_request.project_id,
                            ),
                            self._pipelines["instructions_retrieval"].run(
                                query=user_query,
                                project_id=ask_request.project_id,
                                scope="sql",
                            ),
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
                            await self._run_with_timeout(
                                "Intent classification",
                                self._pipelines["intent_classification"].run(
                                    query=user_query,
                                    histories=histories,
                                    sql_samples=sql_samples,
                                    instructions=instructions,
                                    project_id=ask_request.project_id,
                                    configuration=ask_request.configurations,
                                ),
                            )
                        ).get("post_process", {})
                        intent = intent_classification_result.get("intent")
                        rephrased_question = intent_classification_result.get(
                            "rephrased_question"
                        )
                        intent_reasoning = intent_classification_result.get("reasoning")
                        retrieved_db_schemas = intent_classification_result.get(
                            "db_schemas"
                        ) or []
                        is_original_analytics_query = self._is_data_analysis_query(
                            original_user_query
                        )
                        is_schema_grounded_query = self._is_schema_grounded_query(
                            original_user_query, retrieved_db_schemas
                        ) or self._is_schema_grounded_query(
                            rephrased_question or "", retrieved_db_schemas
                        )

                        if intent in {"GENERAL", "MISLEADING_QUERY", "USER_GUIDE"} and (
                            is_original_analytics_query
                            or is_schema_grounded_query
                            or self._is_data_analysis_query(rephrased_question or "")
                        ):
                            logger.info(
                                "Overriding intent %s to TEXT_TO_SQL for schema/data query: %s",
                                intent,
                                user_query,
                            )
                            intent = "TEXT_TO_SQL"

                        if is_original_analytics_query:
                            if rephrased_question and rephrased_question != user_query:
                                logger.info(
                                    "Ignoring rephrased analytics query from intent classification. original=%s rephrased=%s",
                                    original_user_query,
                                    rephrased_question,
                                )
                            user_query = original_user_query
                            rephrased_question = original_user_query
                        elif rephrased_question:
                            user_query = rephrased_question

                        if intent == "MISLEADING_QUERY":
                            general_result = await self._run_with_timeout(
                                "Misleading assistance",
                                self._pipelines["misleading_assistance"].run(
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    custom_instruction=ask_request.custom_instruction,
                                ),
                            )
                            self._general_streaming_results[query_id] = (
                                self._extract_pipeline_reply(
                                    general_result, "misleading_assistance"
                                )
                            )

                            self._ask_results[query_id] = AskResultResponse(
                                status="finished",
                                type="MISLEADING_QUERY",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="MISLEADING_QUERY",
                            )
                            results["metadata"]["type"] = "MISLEADING_QUERY"
                            return results
                        elif intent == "GENERAL":
                            general_result = await self._run_with_timeout(
                                "Data assistance",
                                self._pipelines["data_assistance"].run(
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    custom_instruction=ask_request.custom_instruction,
                                ),
                            )
                            self._general_streaming_results[query_id] = (
                                self._extract_pipeline_reply(
                                    general_result, "data_assistance"
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
                            general_result = await self._run_with_timeout(
                                "User guide assistance",
                                self._pipelines["user_guide_assistance"].run(
                                    query=user_query,
                                    language=ask_request.configurations.language,
                                    custom_instruction=ask_request.custom_instruction,
                                ),
                            )
                            self._general_streaming_results[query_id] = (
                                self._extract_pipeline_reply(
                                    general_result, "user_guide_assistance"
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

                retrieval_result = await self._run_with_timeout(
                    "Schema retrieval",
                    self._pipelines["db_schema_retrieval"].run(
                        query=user_query,
                        histories=histories,
                        project_id=ask_request.project_id,
                        enable_column_pruning=enable_column_pruning,
                    ),
                )
                _retrieval_result = retrieval_result.get(
                    "construct_retrieval_results", {}
                )
                documents = _retrieval_result.get("retrieval_results", [])
                table_names = [document.get("table_name") for document in documents]
                table_ddls = [
                    document.get("table_ddl", "") or "" for document in documents
                ]
                logger.info(
                    "Retrieved tables for query_id %s: %s", query_id, table_names
                )

                if unqueryable_metric_message := self._get_unqueryable_metric_message(
                    user_query, table_ddls
                ):
                    logger.info(
                        "ask pipeline - NO_RELEVANT_SQL due to unqueryable metric: %s",
                        user_query,
                    )
                    if not self._is_stopped(query_id, self._ask_results):
                        self._ask_results[query_id] = AskResultResponse(
                            status="failed",
                            type="TEXT_TO_SQL",
                            error=AskError(
                                code="NO_RELEVANT_SQL",
                                message=unqueryable_metric_message,
                            ),
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            retrieved_tables=table_names,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )
                    results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                    results["metadata"]["error_message"] = unqueryable_metric_message
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

                if not documents:
                    logger.exception(f"ask pipeline - NO_RELEVANT_DATA: {user_query}")
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
                    try:
                        sql_generation_reasoning = (
                            await self._run_with_timeout(
                                "Follow-up SQL generation reasoning",
                                self._pipelines[
                                    "followup_sql_generation_reasoning"
                                ].run(
                                    query=user_query,
                                    contexts=table_ddls,
                                    histories=histories,
                                    sql_samples=sql_samples,
                                    instructions=instructions,
                                    configuration=ask_request.configurations,
                                    query_id=query_id,
                                ),
                            )
                        ).get("post_process", {})
                    except Exception as reasoning_error:
                        logger.warning(
                            "Follow-up SQL generation reasoning failed for query_id %s; continuing without reasoning: %s",
                            query_id,
                            reasoning_error,
                        )
                        sql_generation_reasoning = ""
                else:
                    try:
                        sql_generation_reasoning = (
                            await self._run_with_timeout(
                                "SQL generation reasoning",
                                self._pipelines["sql_generation_reasoning"].run(
                                    query=user_query,
                                    contexts=table_ddls,
                                    sql_samples=sql_samples,
                                    instructions=instructions,
                                    configuration=ask_request.configurations,
                                    query_id=query_id,
                                ),
                            )
                        ).get("post_process", {})
                    except Exception as reasoning_error:
                        logger.warning(
                            "SQL generation reasoning failed for query_id %s; continuing without reasoning: %s",
                            query_id,
                            reasoning_error,
                        )
                        sql_generation_reasoning = ""

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

                sql_functions, sql_knowledge = await self._run_with_timeout(
                    "SQL helper retrieval",
                    asyncio.gather(
                        (
                            self._pipelines["sql_functions_retrieval"].run(
                                project_id=ask_request.project_id,
                            )
                            if allow_sql_functions_retrieval
                            else _return_value([])
                        ),
                        (
                            self._pipelines["sql_knowledge_retrieval"].run(
                                project_id=ask_request.project_id,
                            )
                            if allow_sql_knowledge_retrieval
                            else _return_value(None)
                        ),
                    ),
                )

                has_calculated_field = _retrieval_result.get(
                    "has_calculated_field", False
                )
                has_metric = _retrieval_result.get("has_metric", False)
                has_json_field = _retrieval_result.get("has_json_field", False)

                if histories:
                    text_to_sql_generation_results = await self._run_with_timeout(
                        "Follow-up SQL generation",
                        self._pipelines["followup_sql_generation"].run(
                            query=user_query,
                            contexts=table_ddls,
                            sql_generation_reasoning=sql_generation_reasoning,
                            histories=histories,
                            project_id=ask_request.project_id,
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
                    )
                else:
                    text_to_sql_generation_results = await self._run_with_timeout(
                        "SQL generation",
                        self._pipelines["sql_generation"].run(
                            query=user_query,
                            contexts=table_ddls,
                            sql_generation_reasoning=sql_generation_reasoning,
                            project_id=ask_request.project_id,
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
                        if failed_dry_run_result["type"] in {
                            "TIME_OUT",
                            "UNSUPPORTED_SQL",
                        }:
                            invalid_sql = failed_dry_run_result.get("sql", invalid_sql)
                            error_message = failed_dry_run_result.get(
                                "error", error_message
                            )
                            break

                        original_sql = failed_dry_run_result["original_sql"]
                        invalid_sql = failed_dry_run_result["sql"]
                        error_message = failed_dry_run_result["error"]
                        sql_diagnosis_reasoning = None
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

                        if allow_sql_diagnosis:
                            sql_diagnosis_results = await self._run_with_timeout(
                                "SQL diagnosis",
                                self._pipelines["sql_diagnosis"].run(
                                    contexts=table_ddls,
                                    original_sql=original_sql,
                                    invalid_sql=invalid_sql,
                                    error_message=error_message,
                                    language=ask_request.configurations.language,
                                ),
                            )
                            sql_diagnosis_reasoning = sql_diagnosis_results[
                                "post_process"
                            ].get("reasoning")

                        correction_error_message = error_message
                        if sql_diagnosis_reasoning:
                            correction_error_message = (
                                f"{error_message}\nDiagnosis: {sql_diagnosis_reasoning}"
                            )

                        sql_correction_results = await self._run_with_timeout(
                            "SQL correction",
                            self._pipelines["sql_correction"].run(
                                contexts=table_ddls,
                                instructions=instructions,
                                invalid_generation_result={
                                    "original_sql": original_sql,
                                    "sql": invalid_sql,
                                    "error": correction_error_message,
                                },
                                project_id=ask_request.project_id,
                                use_dry_plan=use_dry_plan,
                                allow_dry_plan_fallback=allow_dry_plan_fallback,
                                sql_functions=sql_functions,
                                sql_knowledge=sql_knowledge,
                                query=user_query,
                            ),
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

                        failed_dry_run_result = sql_correction_results["post_process"][
                            "invalid_generation_result"
                        ]
                        invalid_sql = failed_dry_run_result.get("sql", invalid_sql)
                        error_message = failed_dry_run_result.get(
                            "error", error_message
                        )

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
                logger.exception(f"ask pipeline - NO_RELEVANT_SQL: {user_query}")
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
        if general_response := self._general_streaming_results.get(query_id):
            event = SSEEvent(
                data=SSEEvent.SSEEventMessage(message=general_response),
            )
            yield event.serialize()
            return

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
