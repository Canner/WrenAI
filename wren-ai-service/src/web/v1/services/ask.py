import asyncio
import logging
import uuid
from typing import Any, Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core import (
    SkillActorClaims,
    SkillConnector,
    SkillExecutionResult,
    SkillHistoryEntry,
    SkillResultType,
    SkillRuntimeIdentity,
    SkillRunnerClient,
    SkillRunnerClientError,
    SkillRunnerExecutionRequest,
    SkillRunnerExecutionStatus,
    SkillRunnerLimits,
    SkillSecret,
)
from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, SSEEvent

logger = logging.getLogger("wren-ai-service")
DEFAULT_SKILL_RUNNER_POLL_ATTEMPTS = 3
DEFAULT_SKILL_RUNNER_POLL_INTERVAL = 0.2


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
    runtime_identity: Optional[SkillRuntimeIdentity] = Field(
        default=None,
        validation_alias=AliasChoices("runtime_identity", "runtimeIdentity"),
    )
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
        max_histories: int = 5,
        skill_runner_client: Optional[SkillRunnerClient] = None,
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
        self._skill_runner_client = skill_runner_client

    def _build_skill_history_window(
        self,
        histories: list[AskHistory],
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
        ask_request: AskRequest,
        query: str,
        histories: list[AskHistory],
        skill: AskSkillCandidate,
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
            runtime_identity=ask_request.runtime_identity,
            actor_claims=ask_request.actor_claims,
            connectors=ask_request.connectors,
            secrets=ask_request.secrets,
            history_window=self._build_skill_history_window(histories),
            skill_config={
                **ask_request.skill_config,
                **skill.skill_config,
            },
            metadata={"request_from": ask_request.request_from},
        )

    async def _await_skill_result(
        self,
        execution_id: str,
    ):
        if not self._skill_runner_client:
            return None

        latest_result = None
        for attempt in range(DEFAULT_SKILL_RUNNER_POLL_ATTEMPTS):
            latest_result = await self._skill_runner_client.get_result(execution_id)
            if latest_result.status not in (
                SkillRunnerExecutionStatus.ACCEPTED,
                SkillRunnerExecutionStatus.RUNNING,
            ):
                return latest_result

            if attempt < DEFAULT_SKILL_RUNNER_POLL_ATTEMPTS - 1:
                await asyncio.sleep(DEFAULT_SKILL_RUNNER_POLL_INTERVAL)

        return latest_result

    def _normalize_skill_result(
        self,
        result: SkillExecutionResult,
        execution_id: str,
        skill: AskSkillCandidate,
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

    async def _run_skill_first(
        self,
        ask_request: AskRequest,
        query: str,
        histories: list[AskHistory],
    ) -> Optional[SkillExecutionResult]:
        if (
            not self._skill_runner_client
            or not self._skill_runner_client.enabled
            or not ask_request.runtime_identity
            or not ask_request.skills
        ):
            return None

        for skill in ask_request.skills:
            request = self._build_skill_runner_request(
                ask_request=ask_request,
                query=query,
                histories=histories,
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
                    return self._normalize_skill_result(
                        result=execution.result,
                        execution_id=execution.execution_id,
                        skill=skill,
                    )

                logger.warning(
                    "Skill runner fallback to NL2SQL: skill_id=%s status=%s error=%s",
                    skill.skill_id,
                    execution.status if execution else "unknown",
                    execution.error.message if execution and execution.error else None,
                )
            except SkillRunnerClientError as exc:
                logger.warning(
                    "Skill runner fallback to NL2SQL: skill_id=%s error=%s",
                    skill.skill_id,
                    exc,
                )
            except Exception as exc:
                logger.warning(
                    "Unexpected skill runner failure, fallback to NL2SQL: skill_id=%s error=%s",
                    skill.skill_id,
                    exc,
                )

        return None

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
                    skill_result = await self._run_skill_first(
                        ask_request=ask_request,
                        query=user_query,
                        histories=histories,
                    )
                    if skill_result:
                        self._ask_results[query_id] = AskResultResponse(
                            status="finished",
                            type="SKILL",
                            skill_result=skill_result,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )
                        results["skill_result"] = skill_result.model_dump(
                            mode="json",
                            by_alias=True,
                        )
                        results["metadata"]["type"] = "SKILL"
                        return results

                    # Run both pipeline operations concurrently
                    sql_samples_task, instructions_task = await asyncio.gather(
                        self._pipelines["sql_pairs_retrieval"].run(
                            query=user_query,
                            project_id=ask_request.project_id,
                        ),
                        self._pipelines["instructions_retrieval"].run(
                            query=user_query,
                            project_id=ask_request.project_id,
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
                    )
                else:
                    sql_functions = []

                if allow_sql_knowledge_retrieval:
                    sql_knowledge = await self._pipelines[
                        "sql_knowledge_retrieval"
                    ].run(
                        project_id=ask_request.project_id,
                    )

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
                    )
                else:
                    text_to_sql_generation_results = await self._pipelines[
                        "sql_generation"
                    ].run(
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

                        if allow_sql_diagnosis:
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
                                if allow_sql_diagnosis
                                else error_message,
                            },
                            project_id=ask_request.project_id,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_functions=sql_functions,
                            sql_knowledge=sql_knowledge,
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
