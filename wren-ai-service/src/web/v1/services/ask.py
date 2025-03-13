import asyncio
import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import Configuration, SSEEvent

logger = logging.getLogger("wren-ai-service")


class AskHistory(BaseModel):
    sql: str
    question: str


# POST /v1/asks
class AskRequest(BaseModel):
    _query_id: str | None = None
    query: str
    # for identifying which collection to access from vectordb
    project_id: Optional[str] = None
    # don't recommend to use id as a field name, but it's used in the older version of API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: Optional[str] = Field(validation_alias=AliasChoices("mdl_hash", "id"))
    thread_id: Optional[str] = None
    histories: Optional[list[AskHistory]] = Field(default_factory=list)
    configurations: Optional[Configuration] = Configuration()

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class AskResponse(BaseModel):
    query_id: str


# PATCH /v1/asks/{query_id}
class StopAskRequest(BaseModel):
    _query_id: str | None = None
    status: Literal["stopped"]

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


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


class AskResultResponse(BaseModel):
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
    type: Optional[Literal["MISLEADING_QUERY", "GENERAL", "TEXT_TO_SQL"]] = None
    retrieved_tables: Optional[List[str]] = None
    response: Optional[List[AskResult]] = None
    invalid_sql: Optional[str] = None
    error: Optional[AskError] = None
    trace_id: Optional[str] = None


# POST /v1/ask-feedbacks
class AskFeedbackRequest(BaseModel):
    _query_id: str | None = None
    tables: List[str]
    sql_generation_reasoning: str
    sql: str
    project_id: Optional[str] = None
    configurations: Optional[Configuration] = Configuration()

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class AskFeedbackResponse(BaseModel):
    query_id: str


# PATCH /v1/ask-feedbacks/{query_id}
class StopAskFeedbackRequest(BaseModel):
    _query_id: str | None = None
    status: Literal["stopped"]

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class StopAskFeedbackResponse(BaseModel):
    query_id: str


# GET /v1/ask-feedbacks/{query_id}
class AskFeedbackResultRequest(BaseModel):
    query_id: str


class AskFeedbackResultResponse(BaseModel):
    status: Literal[
        "searching",
        "generating",
        "correcting",
        "finished",
        "failed",
        "stopped",
    ]
    error: Optional[AskError] = None
    response: Optional[List[AskResult]] = None
    trace_id: Optional[str] = None


class AskService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        allow_intent_classification: bool = True,
        allow_sql_generation_reasoning: bool = True,
        max_histories: int = 10,
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._ask_results: Dict[str, AskResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._ask_feedback_results: Dict[str, AskFeedbackResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._allow_sql_generation_reasoning = allow_sql_generation_reasoning
        self._allow_intent_classification = allow_intent_classification
        self._max_histories = max_histories

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
            },
        }

        query_id = ask_request.query_id
        histories = ask_request.histories[: self._max_histories]
        rephrased_question = None
        intent_reasoning = None
        sql_generation_reasoning = None
        sql_samples = []
        api_results = []
        table_names = []
        error_message = ""

        try:
            user_query = ask_request.query

            # ask status can be understanding, searching, generating, finished, failed, stopped
            # we will need to handle business logic for each status
            if not self._is_stopped(query_id, self._ask_results):
                self._ask_results[query_id] = AskResultResponse(
                    status="understanding",
                    trace_id=trace_id,
                )

                historical_question = await self._pipelines["historical_question"].run(
                    query=user_query,
                    id=ask_request.project_id,
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
                                "type": "view",
                                "viewId": result.get("viewId"),
                            }
                        )
                        for result in historical_question_result
                    ]
                    sql_generation_reasoning = ""
                elif self._allow_intent_classification:
                    intent_classification_result = (
                        await self._pipelines["intent_classification"].run(
                            query=user_query,
                            histories=histories,
                            id=ask_request.project_id,
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
                        self._ask_results[query_id] = AskResultResponse(
                            status="finished",
                            type="MISLEADING_QUERY",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            trace_id=trace_id,
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
                            )
                        )

                        self._ask_results[query_id] = AskResultResponse(
                            status="finished",
                            type="GENERAL",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            trace_id=trace_id,
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
                        )
            if not self._is_stopped(query_id, self._ask_results) and not api_results:
                self._ask_results[query_id] = AskResultResponse(
                    status="searching",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    trace_id=trace_id,
                )

                retrieval_result = await self._pipelines["retrieval"].run(
                    query=user_query,
                    histories=histories,
                    id=ask_request.project_id,
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
                        )
                    results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

            if (
                not self._is_stopped(query_id, self._ask_results)
                and not api_results
                and self._allow_sql_generation_reasoning
            ):
                self._ask_results[query_id] = AskResultResponse(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    trace_id=trace_id,
                )

                sql_samples = (
                    await self._pipelines["sql_pairs_retrieval"].run(
                        query=ask_request.query,
                        id=ask_request.project_id,
                    )
                )["formatted_output"].get("documents", [])

                sql_generation_reasoning = (
                    await self._pipelines["sql_generation_reasoning"].run(
                        query=user_query,
                        contexts=table_ddls,
                        sql_samples=sql_samples,
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
                )

            invalid_sql = None
            error_message = None

            if not self._is_stopped(query_id, self._ask_results) and not api_results:
                self._ask_results[query_id] = AskResultResponse(
                    status="generating",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    trace_id=trace_id,
                )

                has_calculated_field = _retrieval_result.get(
                    "has_calculated_field", False
                )
                has_metric = _retrieval_result.get("has_metric", False)

                if histories:
                    text_to_sql_generation_results = await self._pipelines[
                        "followup_sql_generation"
                    ].run(
                        query=user_query,
                        contexts=table_ddls,
                        sql_generation_reasoning=sql_generation_reasoning,
                        histories=histories,
                        project_id=ask_request.project_id,
                        configuration=ask_request.configurations,
                        sql_samples=sql_samples,
                        has_calculated_field=has_calculated_field,
                        has_metric=has_metric,
                    )
                else:
                    text_to_sql_generation_results = await self._pipelines[
                        "sql_generation"
                    ].run(
                        query=user_query,
                        contexts=table_ddls,
                        sql_generation_reasoning=sql_generation_reasoning,
                        project_id=ask_request.project_id,
                        configuration=ask_request.configurations,
                        sql_samples=sql_samples,
                        has_calculated_field=has_calculated_field,
                        has_metric=has_metric,
                    )

                if sql_valid_results := text_to_sql_generation_results["post_process"][
                    "valid_generation_results"
                ]:
                    api_results = [
                        AskResult(
                            **{
                                "sql": result.get("sql"),
                                "type": "llm",
                            }
                        )
                        for result in sql_valid_results
                    ][:1]
                elif failed_dry_run_results := text_to_sql_generation_results[
                    "post_process"
                ]["invalid_generation_results"]:
                    if failed_dry_run_results[0]["type"] != "TIME_OUT":
                        self._ask_results[query_id] = AskResultResponse(
                            status="correcting",
                            type="TEXT_TO_SQL",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            retrieved_tables=table_names,
                            sql_generation_reasoning=sql_generation_reasoning,
                            trace_id=trace_id,
                        )
                        sql_correction_results = await self._pipelines[
                            "sql_correction"
                        ].run(
                            contexts=table_ddls,
                            invalid_generation_results=failed_dry_run_results,
                            project_id=ask_request.project_id,
                        )

                        if valid_generation_results := sql_correction_results[
                            "post_process"
                        ]["valid_generation_results"]:
                            api_results = [
                                AskResult(
                                    **{
                                        "sql": valid_generation_result.get("sql"),
                                        "type": "llm",
                                    }
                                )
                                for valid_generation_result in valid_generation_results
                            ][:1]
                        elif failed_dry_run_results := sql_correction_results[
                            "post_process"
                        ]["invalid_generation_results"]:
                            invalid = failed_dry_run_results[0]
                            invalid_sql = invalid["sql"]
                            error_message = invalid["error"]
                    else:
                        invalid = failed_dry_run_results[0]
                        invalid_sql = invalid["sql"]
                        error_message = invalid["error"]

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
            if self._ask_results.get(query_id).type == "GENERAL":
                async for chunk in self._pipelines[
                    "data_assistance"
                ].get_streaming_results(query_id):
                    event = SSEEvent(
                        data=SSEEvent.SSEEventMessage(message=chunk),
                    )
                    yield event.serialize()
            elif self._ask_results.get(query_id).status == "planning":
                async for chunk in self._pipelines[
                    "sql_generation_reasoning"
                ].get_streaming_results(query_id):
                    event = SSEEvent(
                        data=SSEEvent.SSEEventMessage(message=chunk),
                    )
                    yield event.serialize()

    @observe(name="Ask Feedback")
    @trace_metadata
    async def ask_feedback(
        self,
        ask_feedback_request: AskFeedbackRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        results = {
            "ask_feedback_result": {},
            "metadata": {
                "error_type": "",
                "error_message": "",
            },
        }

        query_id = ask_feedback_request.query_id
        api_results = []
        error_message = ""

        try:
            if not self._is_stopped(query_id, self._ask_feedback_results):
                self._ask_feedback_results[query_id] = AskFeedbackResultResponse(
                    status="searching",
                    trace_id=trace_id,
                )

                retrieval_result = await self._pipelines["retrieval"].run(
                    tables=ask_feedback_request.tables,
                    id=ask_feedback_request.project_id,
                )
                _retrieval_result = retrieval_result.get(
                    "construct_retrieval_results", {}
                )
                documents = _retrieval_result.get("retrieval_results", [])
                table_ddls = [document.get("table_ddl") for document in documents]

            if not self._is_stopped(query_id, self._ask_feedback_results):
                self._ask_feedback_results[query_id] = AskFeedbackResultResponse(
                    status="generating",
                    trace_id=trace_id,
                )

                text_to_sql_generation_results = await self._pipelines[
                    "sql_regeneration"
                ].run(
                    contexts=table_ddls,
                    sql_generation_reasoning=ask_feedback_request.sql_generation_reasoning,
                    sql=ask_feedback_request.sql,
                    project_id=ask_feedback_request.project_id,
                    configuration=ask_feedback_request.configurations,
                )

                if sql_valid_results := text_to_sql_generation_results["post_process"][
                    "valid_generation_results"
                ]:
                    api_results = [
                        AskResult(
                            **{
                                "sql": result.get("sql"),
                                "type": "llm",
                            }
                        )
                        for result in sql_valid_results
                    ][:1]
                elif failed_dry_run_results := text_to_sql_generation_results[
                    "post_process"
                ]["invalid_generation_results"]:
                    if failed_dry_run_results[0]["type"] != "TIME_OUT":
                        self._ask_feedback_results[
                            query_id
                        ] = AskFeedbackResultResponse(
                            status="correcting",
                            trace_id=trace_id,
                        )
                        sql_correction_results = await self._pipelines[
                            "sql_correction"
                        ].run(
                            contexts=[],
                            invalid_generation_results=failed_dry_run_results,
                            project_id=ask_feedback_request.project_id,
                        )

                        if valid_generation_results := sql_correction_results[
                            "post_process"
                        ]["valid_generation_results"]:
                            api_results = [
                                AskResult(
                                    **{
                                        "sql": valid_generation_result.get("sql"),
                                        "type": "llm",
                                    }
                                )
                                for valid_generation_result in valid_generation_results
                            ][:1]
                        elif failed_dry_run_results := sql_correction_results[
                            "post_process"
                        ]["invalid_generation_results"]:
                            error_message = failed_dry_run_results[0]["error"]
                    else:
                        error_message = failed_dry_run_results[0]["error"]

            if api_results:
                if not self._is_stopped(query_id, self._ask_feedback_results):
                    self._ask_feedback_results[query_id] = AskFeedbackResultResponse(
                        status="finished",
                        response=api_results,
                        trace_id=trace_id,
                    )
                results["ask_feedback_result"] = api_results
            else:
                logger.exception("ask feedback pipeline - NO_RELEVANT_SQL")
                if not self._is_stopped(query_id, self._ask_feedback_results):
                    self._ask_feedback_results[query_id] = AskFeedbackResultResponse(
                        status="failed",
                        error=AskError(
                            code="NO_RELEVANT_SQL",
                            message=error_message or "No relevant SQL",
                        ),
                        trace_id=trace_id,
                    )
                results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                results["metadata"]["error_message"] = error_message

            return results

        except Exception as e:
            logger.exception(f"ask feedback pipeline - OTHERS: {e}")

            self._ask_feedback_results[query_id] = AskFeedbackResultResponse(
                status="failed",
                error=AskError(
                    code="OTHERS",
                    message=str(e),
                ),
                trace_id=trace_id,
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            return results

    def stop_ask_feedback(
        self,
        stop_ask_feedback_request: StopAskFeedbackRequest,
    ):
        self._ask_feedback_results[
            stop_ask_feedback_request.query_id
        ] = AskFeedbackResultResponse(
            status="stopped",
        )

    def get_ask_feedback_result(
        self,
        ask_feedback_result_request: AskFeedbackResultRequest,
    ) -> AskFeedbackResultResponse:
        if (
            result := self._ask_feedback_results.get(
                ask_feedback_result_request.query_id
            )
        ) is None:
            logger.exception(
                f"ask feedback pipeline - OTHERS: {ask_feedback_result_request.query_id} is not found"
            )
            return AskFeedbackResultResponse(
                status="failed",
                error=AskError(
                    code="OTHERS",
                    message=f"{ask_feedback_result_request.query_id} is not found",
                ),
            )

        return result
