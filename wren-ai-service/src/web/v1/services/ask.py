import asyncio
import logging
import re
import time
from typing import Any, Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, SSEEvent

logger = logging.getLogger("wren-ai-service")

_SIMPLE_ANALYTICS_FAST_PATH_PATTERN = re.compile(
    r"(?i)\b("
    r"how\s+many|count|counts|number\s+of|total|sum|average|avg|"
    r"top\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"eighteen|nineteen|twenty)|"
    r"latest|newest|recent|distribution|breakdown|"
    r"group(?:ed)?\s+by|by\s+(?:day|week|month|quarter|year)|"
    r"each\s+(?:day|week|month|quarter|year)|monthly|per|"
    r"missing|blank|empty|null"
    r")\b"
)
_SHOW_BY_FAST_PATH_PATTERN = re.compile(
    r"(?is)\b(?:show|list)\b.+\bby\s+[A-Za-z0-9_ -]+\b"
)
_GROUP_RESULT_FAST_PATH_PATTERN = re.compile(
    r"(?is)\b(?:group|groups)\b.+\b(?:result|results|those|that)\b"
)
_LISTING_FAST_PATH_PATTERN = re.compile(
    r"(?is)\b(?:show|list)\b.+\b(?:record|records|row|rows)\b"
)
_GENERAL_HELP_PATTERN = re.compile(
    r"(?i)\b(how\s+to|help|guide|docs|documentation|connect|configure|setting|settings)\b"
)
_DATA_SHAPE_PATTERN = re.compile(
    r"(?i)\b(record|records|row|rows|table|tables|field|fields|column|columns)\b"
)
_HISTORY_SQL_IDENTIFIER_PATTERN = re.compile(
    r'"([^"]+)"|\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_$-]*)',
    re.IGNORECASE,
)
_HISTORY_SQL_TABLE_PATTERN = re.compile(
    r'\b(?:FROM|JOIN)\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_$-]*))',
    re.IGNORECASE,
)


def _looks_like_simple_analytics_request(query: str | None) -> bool:
    if not query or _GENERAL_HELP_PATTERN.search(query):
        return False
    return bool(
        _SIMPLE_ANALYTICS_FAST_PATH_PATTERN.search(query)
        or _SHOW_BY_FAST_PATH_PATTERN.search(query)
        or _GROUP_RESULT_FAST_PATH_PATTERN.search(query)
        or _LISTING_FAST_PATH_PATTERN.search(query)
    )


def _can_return_pre_intent_schema_unsupported(query: str | None) -> bool:
    if not query or _GENERAL_HELP_PATTERN.search(query):
        return False
    return bool(
        _DATA_SHAPE_PATTERN.search(query)
        or _SIMPLE_ANALYTICS_FAST_PATH_PATTERN.search(query)
        or _SHOW_BY_FAST_PATH_PATTERN.search(query)
        or _GROUP_RESULT_FAST_PATH_PATTERN.search(query)
        or _LISTING_FAST_PATH_PATTERN.search(query)
    )


class AskHistory(BaseModel):
    sql: str
    question: str


def _history_sql_identifiers(sql: str | None) -> list[str]:
    if not sql:
        return []

    identifiers = []
    seen = set()
    for match in _HISTORY_SQL_IDENTIFIER_PATTERN.finditer(sql):
        identifier = match.group(1) or match.group(2)
        if not identifier or identifier in seen:
            continue
        identifiers.append(identifier)
        seen.add(identifier)
    return identifiers


def _history_sql_table_names(sql: str | None) -> list[str]:
    if not sql:
        return []

    table_names = []
    seen = set()
    for match in _HISTORY_SQL_TABLE_PATTERN.finditer(sql):
        table_name = match.group(1) or match.group(2)
        if not table_name or table_name in seen:
            continue
        table_names.append(table_name)
        seen.add(table_name)
    return table_names


def _build_fast_path_grounding_query(
    query: str | None,
    histories: list[AskHistory],
) -> str:
    if not histories:
        return query or ""

    latest_history = histories[0]
    parts = []
    if latest_history.question:
        parts.append(latest_history.question)
    history_identifiers = _history_sql_identifiers(latest_history.sql)
    if history_identifiers:
        parts.append(" ".join(history_identifiers))
    parts.append(query or "")
    return "\n".join(parts)


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


def _build_sql_correction_error(
    error_message: str | None,
    sql_diagnosis_reasoning: str | None = None,
) -> str:
    raw_error = error_message or ""
    if sql_diagnosis_reasoning:
        return (
            f"{sql_diagnosis_reasoning}\n\n"
            f"Original Wren Engine validation error:\n{raw_error}"
        )

    return f"Original Wren Engine validation error:\n{raw_error}"


class _AskStageTimer:
    def __init__(self, query_id: str, project_id: str | None):
        self._query_id = query_id
        self._project_id = project_id or ""
        self._started_at = time.perf_counter()
        self._last_at = self._started_at

    def mark(
        self,
        stage: str,
        started_at: float | None = None,
        **fields: Any,
    ) -> None:
        ended_at = time.perf_counter()
        stage_started_at = started_at if started_at is not None else self._last_at
        suffix = " ".join(
            f"{key}={value}" for key, value in fields.items() if value is not None
        )
        logger.info(
            "Ask timing query_id=%s project_id=%s stage=%s elapsed_ms=%.1f total_ms=%.1f%s%s",
            self._query_id,
            self._project_id,
            stage,
            (ended_at - stage_started_at) * 1000,
            (ended_at - self._started_at) * 1000,
            " " if suffix else "",
            suffix,
        )
        self._last_at = ended_at


class AskService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        allow_intent_classification: bool = True,
        allow_sql_generation_reasoning: bool = False,
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        allow_sql_knowledge_retrieval: bool = True,
        enable_column_pruning: bool = True,
        max_sql_correction_retries: int = 0,
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

    async def _retrieve_schema_context(
        self,
        ask_request: AskRequest,
        user_query: str,
        histories: list[AskHistory],
        enable_column_pruning: bool,
        timer: _AskStageTimer,
        phase: str | None = None,
        tables: list[str] | None = None,
    ) -> tuple[dict, list[dict], list[str], list[str]]:
        schema_retrieval_started_at = time.perf_counter()
        retrieval_result = await self._pipelines["db_schema_retrieval"].run(
            query=user_query,
            tables=tables,
            histories=histories,
            project_id=ask_request.project_id,
            mdl_hash=ask_request.mdl_hash,
            enable_column_pruning=enable_column_pruning,
        )
        retrieval_payload = retrieval_result.get("construct_retrieval_results", {})
        documents = retrieval_payload.get("retrieval_results", [])
        table_names = [document.get("table_name") for document in documents]
        table_ddls = [document.get("table_ddl") for document in documents]
        timer.mark(
            "schema_retrieval",
            schema_retrieval_started_at,
            retrieved_table_count=len(table_names),
            phase=phase,
        )
        return retrieval_payload, documents, table_names, table_ddls

    async def _run_schema_fast_path(
        self,
        ask_request: AskRequest,
        user_query: str,
        table_ddls: list[str],
        histories: list[AskHistory],
        grounding_query: str,
        use_dry_plan: bool,
        allow_dry_plan_fallback: bool,
        timer: _AskStageTimer,
        phase: str | None = None,
    ) -> dict | None:
        fast_path_pipeline_name = (
            "followup_sql_generation" if histories else "sql_generation"
        )
        fast_path_pipeline = self._pipelines[fast_path_pipeline_name]
        fast_path_runner = getattr(
            fast_path_pipeline,
            "run_deterministic_fast_path",
            None,
        )
        if not fast_path_runner:
            return None

        fast_path_started_at = time.perf_counter()
        fast_path_result = await fast_path_runner(
            query=user_query,
            contexts=table_ddls,
            project_id=ask_request.project_id,
            mdl_hash=ask_request.mdl_hash,
            use_dry_plan=use_dry_plan,
            allow_dry_plan_fallback=allow_dry_plan_fallback,
            grounding_query=grounding_query,
        )
        timer.mark(
            "sql_generation_fast_path",
            fast_path_started_at,
            result=fast_path_result.get("fast_path") if fast_path_result else "miss",
            phase=phase,
        )
        return fast_path_result

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
        table_ddls = []
        _retrieval_result = {}
        error_message = None
        invalid_sql = None
        fast_path_terminal = False
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
            original_user_query = ask_request.query
            user_query = original_user_query
            timer = _AskStageTimer(query_id, ask_request.project_id)
            timer.mark(
                "frontend_request",
                query_chars=len(original_user_query or ""),
                history_count=len(histories),
            )

            # ask status can be understanding, searching, generating, finished, failed, stopped
            # we will need to handle business logic for each status
            if not self._is_stopped(query_id, self._ask_results):
                self._ask_results[query_id] = AskResultResponse(
                    status="understanding",
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                if not api_results:
                    # Run both pipeline operations concurrently
                    support_context_started_at = time.perf_counter()
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

                    sql_samples = sql_samples_task["formatted_output"].get(
                        "documents", []
                    )
                    instructions = instructions_task["formatted_output"].get(
                        "documents", []
                    )
                    timer.mark(
                        "schema_retrieval_support_context",
                        support_context_started_at,
                        sql_sample_count=len(sql_samples),
                        instruction_count=len(instructions),
                    )

                    if (
                        _looks_like_simple_analytics_request(user_query)
                        and not self._is_stopped(query_id, self._ask_results)
                    ):
                        pre_intent_grounding_query = (
                            _build_fast_path_grounding_query(user_query, histories)
                            if histories
                            else original_user_query
                        )
                        pre_intent_tables = (
                            _history_sql_table_names(histories[0].sql)
                            if histories
                            else None
                        )
                        self._ask_results[query_id] = AskResultResponse(
                            status="searching",
                            type="TEXT_TO_SQL",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )
                        (
                            _retrieval_result,
                            documents,
                            table_names,
                            table_ddls,
                        ) = await self._retrieve_schema_context(
                            ask_request=ask_request,
                            user_query=""
                            if pre_intent_tables
                            else pre_intent_grounding_query,
                            histories=histories,
                            enable_column_pruning=enable_column_pruning,
                            timer=timer,
                            phase="pre_intent",
                            tables=pre_intent_tables,
                        )
                        if self._is_stopped(query_id, self._ask_results):
                            timer.mark("cancelled", at_stage="schema_retrieval")
                            results["metadata"]["type"] = "TEXT_TO_SQL"
                            return results

                        if documents:
                            fast_path_result = await self._run_schema_fast_path(
                                ask_request=ask_request,
                                user_query=user_query,
                                table_ddls=table_ddls,
                                histories=histories,
                                grounding_query=pre_intent_grounding_query,
                                use_dry_plan=use_dry_plan,
                                allow_dry_plan_fallback=allow_dry_plan_fallback,
                                timer=timer,
                                phase="pre_intent",
                            )
                            if self._is_stopped(query_id, self._ask_results):
                                timer.mark(
                                    "cancelled",
                                    at_stage="sql_generation_fast_path",
                                )
                                results["metadata"]["type"] = "TEXT_TO_SQL"
                                return results
                            if fast_path_result:
                                post_process = fast_path_result["post_process"]
                                if sql_valid_result := post_process.get(
                                    "valid_generation_result"
                                ):
                                    api_results = [
                                        AskResult(
                                            **{
                                                "sql": sql_valid_result.get("sql"),
                                                "type": "llm",
                                            }
                                        )
                                    ]
                                    fast_path_terminal = True
                                elif (
                                    failed_result := post_process.get(
                                        "invalid_generation_result"
                                    )
                                ) and (
                                    failed_result.get("type") == "NO_RELEVANT_SQL"
                                    and _can_return_pre_intent_schema_unsupported(
                                        user_query
                                    )
                                ):
                                    error_message = failed_result.get("error")
                                    invalid_sql = ""
                                    fast_path_terminal = True

                    if (
                        self._allow_intent_classification
                        and not api_results
                        and not fast_path_terminal
                    ):
                        intent_started_at = time.perf_counter()
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
                        timer.mark(
                            "llm_intent_generation",
                            intent_started_at,
                            intent=intent,
                        )

                        if rephrased_question:
                            user_query = rephrased_question

                        if self._is_stopped(query_id, self._ask_results):
                            timer.mark("cancelled", at_stage="llm_intent_generation")
                            results["metadata"]["type"] = "TEXT_TO_SQL"
                            return results

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
            grounding_query = (
                _build_fast_path_grounding_query(user_query, histories)
                if histories
                else original_user_query
            )
            if (
                not self._is_stopped(query_id, self._ask_results)
                and not api_results
                and not fast_path_terminal
            ):
                self._ask_results[query_id] = AskResultResponse(
                    status="searching",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                (
                    _retrieval_result,
                    documents,
                    table_names,
                    table_ddls,
                ) = await self._retrieve_schema_context(
                    ask_request=ask_request,
                    user_query=user_query,
                    histories=histories,
                    enable_column_pruning=enable_column_pruning,
                    timer=timer,
                )

                if self._is_stopped(query_id, self._ask_results):
                    timer.mark("cancelled", at_stage="schema_retrieval")
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

                fast_path_result = await self._run_schema_fast_path(
                    ask_request=ask_request,
                    user_query=user_query,
                    table_ddls=table_ddls,
                    histories=histories,
                    grounding_query=grounding_query,
                    use_dry_plan=use_dry_plan,
                    allow_dry_plan_fallback=allow_dry_plan_fallback,
                    timer=timer,
                )
                if fast_path_result:
                    if self._is_stopped(query_id, self._ask_results):
                        timer.mark("cancelled", at_stage="sql_generation_fast_path")
                        results["metadata"]["type"] = "TEXT_TO_SQL"
                        return results
                    post_process = fast_path_result["post_process"]
                    if sql_valid_result := post_process.get(
                        "valid_generation_result"
                    ):
                        api_results = [
                            AskResult(
                                **{
                                    "sql": sql_valid_result.get("sql"),
                                    "type": "llm",
                                }
                            )
                        ]
                        fast_path_terminal = True
                    elif failed_result := post_process.get("invalid_generation_result"):
                        if failed_result.get("type") == "NO_RELEVANT_SQL":
                            error_message = failed_result.get("error")
                            invalid_sql = ""
                            fast_path_terminal = True

            if (
                not self._is_stopped(query_id, self._ask_results)
                and not api_results
                and not fast_path_terminal
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

                sql_reasoning_started_at = time.perf_counter()
                if histories:
                    sql_generation_reasoning = (
                        await self._pipelines["followup_sql_generation_reasoning"].run(
                            query=user_query,
                            contexts=table_ddls,
                            histories=histories,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            project_id=ask_request.project_id,
                            mdl_hash=ask_request.mdl_hash,
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
                            project_id=ask_request.project_id,
                            mdl_hash=ask_request.mdl_hash,
                            configuration=ask_request.configurations,
                            query_id=query_id,
                        )
                    ).get("post_process", {})
                timer.mark(
                    "sql_generation_reasoning",
                    sql_reasoning_started_at,
                    is_followup=bool(histories),
                )
                if self._is_stopped(query_id, self._ask_results):
                    timer.mark("cancelled", at_stage="sql_generation_reasoning")
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

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

            if (
                not self._is_stopped(query_id, self._ask_results)
                and not api_results
                and not fast_path_terminal
            ):
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

                auxiliary_retrieval_started_at = time.perf_counter()
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
                timer.mark(
                    "sql_auxiliary_retrieval",
                    auxiliary_retrieval_started_at,
                    functions_enabled=allow_sql_functions_retrieval,
                    knowledge_enabled=allow_sql_knowledge_retrieval,
                )
                if self._is_stopped(query_id, self._ask_results):
                    timer.mark("cancelled", at_stage="sql_auxiliary_retrieval")
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

                has_calculated_field = _retrieval_result.get(
                    "has_calculated_field", False
                )
                has_metric = _retrieval_result.get("has_metric", False)
                has_json_field = _retrieval_result.get("has_json_field", False)

                sql_generation_started_at = time.perf_counter()
                if histories:
                    text_to_sql_generation_results = await self._pipelines[
                        "followup_sql_generation"
                    ].run(
                        query=user_query,
                        contexts=table_ddls,
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
                        grounding_query=grounding_query,
                    )
                else:
                    text_to_sql_generation_results = await self._pipelines[
                        "sql_generation"
                    ].run(
                        query=user_query,
                        contexts=table_ddls,
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
                        grounding_query=original_user_query,
                    )
                timer.mark(
                    "sql_generation",
                    sql_generation_started_at,
                    is_followup=bool(histories),
                    status="valid"
                    if text_to_sql_generation_results["post_process"].get(
                        "valid_generation_result"
                    )
                    else "invalid",
                )
                if self._is_stopped(query_id, self._ask_results):
                    timer.mark("cancelled", at_stage="sql_generation")
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

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
                        if self._is_stopped(query_id, self._ask_results):
                            timer.mark("cancelled", at_stage="sql_correction")
                            results["metadata"]["type"] = "TEXT_TO_SQL"
                            return results
                        if failed_dry_run_result["type"] in (
                            "TIME_OUT",
                            "NO_RELEVANT_SQL",
                        ):
                            error_message = failed_dry_run_result["error"]
                            invalid_sql = (
                                ""
                                if failed_dry_run_result["type"] == "NO_RELEVANT_SQL"
                                else failed_dry_run_result["sql"]
                            )
                            break

                        original_sql = failed_dry_run_result["original_sql"]
                        invalid_sql = failed_dry_run_result["sql"]
                        error_message = failed_dry_run_result["error"]
                        current_sql_correction_retries += 1
                        sql_diagnosis_reasoning = None

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
                            diagnosis_started_at = time.perf_counter()
                            sql_diagnosis_results = await self._pipelines[
                                "sql_diagnosis"
                            ].run(
                                contexts=table_ddls,
                                original_sql=original_sql,
                                invalid_sql=invalid_sql,
                                error_message=error_message,
                                language=ask_request.configurations.language,
                                project_id=ask_request.project_id,
                                mdl_hash=ask_request.mdl_hash,
                            )
                            sql_diagnosis_reasoning = sql_diagnosis_results[
                                "post_process"
                            ].get("reasoning")
                            timer.mark(
                                "sql_diagnosis",
                                diagnosis_started_at,
                                retry=current_sql_correction_retries,
                            )
                            if self._is_stopped(query_id, self._ask_results):
                                timer.mark("cancelled", at_stage="sql_diagnosis")
                                results["metadata"]["type"] = "TEXT_TO_SQL"
                                return results

                        correction_error = _build_sql_correction_error(
                            error_message=error_message,
                            sql_diagnosis_reasoning=sql_diagnosis_reasoning,
                        )

                        correction_started_at = time.perf_counter()
                        sql_correction_results = await self._pipelines[
                            "sql_correction"
                        ].run(
                            contexts=table_ddls,
                            query=user_query,
                            sql_generation_reasoning=sql_generation_reasoning,
                            instructions=instructions,
                            invalid_generation_result={
                                "sql": original_sql,
                                "error": correction_error,
                            },
                            project_id=ask_request.project_id,
                            mdl_hash=ask_request.mdl_hash,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_functions=sql_functions,
                            sql_knowledge=sql_knowledge,
                        )
                        timer.mark(
                            "sql_correction",
                            correction_started_at,
                            retry=current_sql_correction_retries,
                            status="valid"
                            if sql_correction_results["post_process"].get(
                                "valid_generation_result"
                            )
                            else "invalid",
                        )
                        if self._is_stopped(query_id, self._ask_results):
                            timer.mark("cancelled", at_stage="sql_correction")
                            results["metadata"]["type"] = "TEXT_TO_SQL"
                            return results

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
                timer.mark("ask_total", status="finished")
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
                timer.mark("ask_total", status="failed", error_type="NO_RELEVANT_SQL")

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
        started_at = time.perf_counter()
        self._ask_results[stop_ask_request.query_id] = AskResultResponse(
            status="stopped",
        )
        logger.info(
            "Ask timing query_id=%s project_id=%s stage=cancel_request elapsed_ms=%.1f status=stopped",
            stop_ask_request.query_id,
            stop_ask_request.project_id or "",
            (time.perf_counter() - started_at) * 1000,
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
