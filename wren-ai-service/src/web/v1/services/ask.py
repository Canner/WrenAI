import asyncio
import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, remove_sql_summary_duplicates, trace_metadata
from src.web.v1.services import SSEEvent
from src.web.v1.services.ask_details import SQLBreakdown

logger = logging.getLogger("wren-ai-service")


class AskHistory(BaseModel):
    sql: str
    summary: str
    steps: List[SQLBreakdown]


class AskConfigurations(BaseModel):
    class FiscalYear(BaseModel):
        start: str
        end: str

    class Timezone(BaseModel):
        name: str
        utc_offset: str

    fiscal_year: Optional[FiscalYear] = None
    language: Optional[str] = "English"
    timezone: Optional[Timezone] = Timezone(name="Asia/Taipei", utc_offset="+8:00")


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
    user_id: Optional[str] = None
    history: Optional[AskHistory] = None
    configurations: Optional[AskConfigurations] = AskConfigurations()

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
    summary: str
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
        "generating",
        "finished",
        "failed",
        "stopped",
    ]
    type: Optional[Literal["MISLEADING_QUERY", "GENERAL", "TEXT_TO_SQL"]] = None
    response: Optional[List[AskResult]] = None
    error: Optional[AskError] = None


class AskService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._ask_results: Dict[str, AskResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    def _is_stopped(self, query_id: str):
        if (
            result := self._ask_results.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    def _get_failed_dry_run_results(self, invalid_generation_results: list[dict]):
        return list(
            filter(lambda x: x["type"] == "DRY_RUN", invalid_generation_results)
        )

    async def _add_summary_to_sql_candidates(
        self, sqls: list[str], query: str, language: str
    ):
        sql_summary_results = await self._pipelines["sql_summary"].run(
            query=query,
            sqls=sqls,
            language=language,
        )
        valid_sql_summary_results = sql_summary_results["post_process"][
            "sql_summary_results"
        ]
        # remove duplicates of valid_sql_summary_results, which consists of a sql and a summary
        return remove_sql_summary_duplicates(valid_sql_summary_results)

    @async_timer
    @observe(name="Ask Question")
    @trace_metadata
    async def ask(
        self,
        ask_request: AskRequest,
        **kwargs,
    ):
        results = {
            "ask_result": {},
            "metadata": {
                "type": "",
                "error_type": "",
                "error_message": "",
            },
        }

        try:
            # ask status can be understanding, searching, generating, finished, failed, stopped
            # we will need to handle business logic for each status
            query_id = ask_request.query_id

            if not self._is_stopped(query_id):
                self._ask_results[query_id] = AskResultResponse(
                    status="understanding",
                )

                intent_classification_result = (
                    await self._pipelines["intent_classification"].run(
                        query=ask_request.query,
                        id=ask_request.project_id,
                    )
                ).get("post_process", {})
                intent = intent_classification_result.get("intent")
                if intent == "MISLEADING_QUERY":
                    self._ask_results[query_id] = AskResultResponse(
                        status="finished",
                        type="MISLEADING_QUERY",
                    )
                    results["metadata"]["type"] = "MISLEADING_QUERY"
                    return results
                elif intent == "GENERAL":
                    asyncio.create_task(
                        self._pipelines["data_assistance"].run(
                            query=ask_request.query,
                            db_schemas=intent_classification_result.get("db_schemas"),
                            language=ask_request.configurations.language,
                            query_id=ask_request.query_id,
                        )
                    )

                    self._ask_results[query_id] = AskResultResponse(
                        status="finished", type="GENERAL"
                    )
                    results["metadata"]["type"] = "GENERAL"
                    return results

            if not self._is_stopped(query_id):
                self._ask_results[query_id] = AskResultResponse(
                    status="searching",
                )

                query_for_retrieval = (
                    ask_request.history.summary + " " + ask_request.query
                    if ask_request.history
                    else ask_request.query
                )

                retrieval_result = await self._pipelines["retrieval"].run(
                    query=query_for_retrieval,
                    id=ask_request.project_id,
                )
                documents = retrieval_result.get("construct_retrieval_results", [])

                if not documents:
                    logger.exception(
                        f"ask pipeline - NO_RELEVANT_DATA: {query_for_retrieval}"
                    )
                    if not self._is_stopped(query_id):
                        self._ask_results[query_id] = AskResultResponse(
                            status="failed",
                            type="TEXT_TO_SQL",
                            error=AskError(
                                code="NO_RELEVANT_DATA",
                                message="No relevant data",
                            ),
                        )
                    results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

            if not self._is_stopped(query_id):
                self._ask_results[query_id] = AskResultResponse(
                    status="generating",
                )

                historical_question = await self._pipelines["historical_question"].run(
                    query=query_for_retrieval,
                    id=ask_request.project_id,
                )

                # we only return top 1 result
                historical_question_result = historical_question.get(
                    "formatted_output", {}
                ).get("documents", [])[:1]

                api_results = []
                if historical_question_result:
                    api_results = [
                        AskResult(
                            **{
                                "sql": result.get("statement"),
                                "summary": result.get("summary"),
                                "type": "view",
                                "viewId": result.get("viewId"),
                            }
                        )
                        for result in historical_question_result
                    ]
                else:
                    if ask_request.history:
                        text_to_sql_generation_results = await self._pipelines[
                            "followup_sql_generation"
                        ].run(
                            query=ask_request.query,
                            contexts=documents,
                            history=ask_request.history,
                            project_id=ask_request.project_id,
                            configurations=ask_request.configurations,
                        )
                    else:
                        text_to_sql_generation_results = await self._pipelines[
                            "sql_generation"
                        ].run(
                            query=ask_request.query,
                            contexts=documents,
                            exclude=historical_question_result,
                            project_id=ask_request.project_id,
                            configurations=ask_request.configurations,
                        )

                    if sql_valid_results := text_to_sql_generation_results[
                        "post_process"
                    ]["valid_generation_results"]:
                        valid_sql_summary_results = (
                            await self._add_summary_to_sql_candidates(
                                sql_valid_results,
                                query_for_retrieval,
                                ask_request.configurations.language,
                            )
                        )

                        api_results = [
                            AskResult(**result) for result in valid_sql_summary_results
                        ][:1]
                    elif failed_dry_run_results := self._get_failed_dry_run_results(
                        text_to_sql_generation_results["post_process"][
                            "invalid_generation_results"
                        ]
                    ):
                        # Run sql_correction and _add_summary_to_sql_candidates concurrently
                        sql_correction_task = self._pipelines["sql_correction"].run(
                            contexts=documents,
                            invalid_generation_results=failed_dry_run_results,
                            project_id=ask_request.project_id,
                        )
                        valid_sql_summary_task = self._add_summary_to_sql_candidates(
                            [
                                {
                                    "sql": failed_dry_run_results[0]["sql"],
                                }
                            ],
                            ask_request.query,
                            ask_request.configurations.language,
                        )

                        (
                            sql_correction_results,
                            valid_sql_summary_results,
                        ) = await asyncio.gather(
                            sql_correction_task, valid_sql_summary_task
                        )

                        if valid_generation_results := sql_correction_results[
                            "post_process"
                        ]["valid_generation_results"]:
                            api_results = [
                                AskResult(
                                    **{
                                        "sql": valid_generation_result.get("sql"),
                                        "summary": sql_summary_result.get("summary"),
                                        "type": "llm",
                                    }
                                )
                                for sql_summary_result, valid_generation_result in zip(
                                    valid_sql_summary_results, valid_generation_results
                                )
                            ][:1]

                if api_results:
                    if not self._is_stopped(query_id):
                        self._ask_results[query_id] = AskResultResponse(
                            status="finished",
                            type="TEXT_TO_SQL",
                            response=api_results,
                        )
                    results["ask_result"] = api_results
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                else:
                    logger.exception(
                        f"ask pipeline - NO_RELEVANT_SQL: {ask_request.query}"
                    )
                    if not self._is_stopped(query_id):
                        self._ask_results[query_id] = AskResultResponse(
                            status="failed",
                            type="TEXT_TO_SQL",
                            error=AskError(
                                code="NO_RELEVANT_SQL",
                                message="No relevant SQL",
                            ),
                        )
                    results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                    results["metadata"]["type"] = "TEXT_TO_SQL"

            return results
        except Exception as e:
            logger.exception(f"ask pipeline - OTHERS: {e}")

            self._ask_results[ask_request.query_id] = AskResultResponse(
                status="failed",
                type="TEXT_TO_SQL",
                error=AskError(
                    code="OTHERS",
                    message=str(e),
                ),
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
        if (
            self._ask_results.get(query_id)
            and self._ask_results.get(query_id).type == "GENERAL"
        ):
            async for chunk in self._pipelines["data_assistance"].get_streaming_results(
                query_id
            ):
                event = SSEEvent(
                    data=SSEEvent.SSEEventMessage(message=chunk),
                )
                yield event.serialize()
