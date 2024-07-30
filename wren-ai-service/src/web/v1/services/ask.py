import logging
from typing import List, Literal, Optional

import sqlparse
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")


class SQLExplanation(BaseModel):
    sql: str
    summary: str
    cte_name: str


# POST /v1/asks
class AskRequest(BaseModel):
    class AskResponseDetails(BaseModel):
        sql: str
        summary: str
        steps: List[SQLExplanation]

    _query_id: str | None = None
    query: str
    # for identifying which collection to access from vectordb,
    # the same hash string for identifying which mdl model deployment from backend
    deploy_id: str
    thread_id: Optional[str] = None
    project_id: Optional[str] = None
    history: Optional[AskResponseDetails] = None

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
class AskResultRequest(BaseModel):
    query_id: str


class AskResultResponse(BaseModel):
    class AskResult(BaseModel):
        sql: str
        summary: str
        type: Literal["llm", "view"] = "llm"
        viewId: Optional[str] = None

    class AskError(BaseModel):
        code: Literal[
            "MISLEADING_QUERY", "NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"
        ]  # MISLEADING_QUERY is not in use now, we may add it back in the future when we implement the clarification pipeline
        message: str

    status: Literal[
        "understanding", "searching", "generating", "finished", "failed", "stopped"
    ]
    response: Optional[List[AskResult]] = None
    error: Optional[AskError] = None


class AskService:
    def __init__(
        self,
        pipelines: dict[str, BasicPipeline],
    ):
        self._pipelines = pipelines
        self._ask_results = {}

    def _is_stopped(self, query_id: str):
        if (
            result := self._ask_results.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    @async_timer
    @observe(name="Ask Question")
    @trace_metadata
    async def ask(
        self,
        ask_request: AskRequest,
    ):
        try:
            # ask status can be understanding, searching, generating, finished, failed, stopped
            # we will need to handle business logic for each status
            query_id = ask_request.query_id

            if not self._is_stopped(query_id):
                self._ask_results[query_id] = AskResultResponse(
                    status="understanding",
                )

            if not self._is_stopped(query_id):
                self._ask_results[query_id] = AskResultResponse(
                    status="searching",
                )

                retrieval_result = await self._pipelines["retrieval"].run(
                    query=ask_request.query,
                )
                documents = retrieval_result.get("retrieval", {}).get("documents", [])

                if not documents:
                    logger.exception(
                        f"ask pipeline - NO_RELEVANT_DATA: {ask_request.query}"
                    )
                    self._ask_results[query_id] = AskResultResponse(
                        status="failed",
                        error=AskResultResponse.AskError(
                            code="NO_RELEVANT_DATA",
                            message="No relevant data",
                        ),
                    )
                    return

            if not self._is_stopped(query_id):
                self._ask_results[query_id] = AskResultResponse(
                    status="generating",
                )

                historical_question = await self._pipelines["historical_question"].run(
                    query=ask_request.query
                )

                # we only return top 1 result
                historical_question_result = historical_question.get(
                    "formatted_output", {}
                ).get("documents", [])[:1]

                logger.debug(
                    f"historical_question_result: {historical_question_result}"
                )

                if ask_request.history:
                    text_to_sql_generation_results = await self._pipelines[
                        "followup_generation"
                    ].run(
                        query=ask_request.query,
                        contexts=documents,
                        history=ask_request.history,
                    )
                else:
                    text_to_sql_generation_results = await self._pipelines[
                        "generation"
                    ].run(
                        query=ask_request.query,
                        contexts=documents,
                        exclude=historical_question_result,
                    )

                valid_generation_results = []
                if text_to_sql_generation_results["post_process"][
                    "valid_generation_results"
                ]:
                    valid_generation_results += text_to_sql_generation_results[
                        "post_process"
                    ]["valid_generation_results"]

                logger.debug("Documents:")
                for document in documents:
                    logger.debug(f"score: {document.score}")
                    logger.debug(f"content: {document.content}")

                logger.debug("Before sql correction:")
                logger.debug(f"valid_generation_results: {valid_generation_results}")

                if text_to_sql_generation_results["post_process"][
                    "invalid_generation_results"
                ]:
                    sql_correction_results = await self._pipelines[
                        "sql_correction"
                    ].run(
                        contexts=documents,
                        invalid_generation_results=text_to_sql_generation_results[
                            "post_process"
                        ]["invalid_generation_results"],
                    )
                    valid_generation_results += sql_correction_results["post_process"][
                        "valid_generation_results"
                    ]

                    logger.debug(
                        f'sql_correction_results: {sql_correction_results["post_process"]}'
                    )

                    for results in sql_correction_results["post_process"][
                        "invalid_generation_results"
                    ]:
                        logger.debug(
                            f"{sqlparse.format(
                                results['sql'],
                                reindent=True,
                                keyword_case='upper')
                            }"
                        )
                        logger.debug(results["error"])
                        logger.debug("\n\n")

                # remove duplicates of valid_generation_results, which consists of a sql and a summary
                valid_generation_results = remove_duplicates(valid_generation_results)

                logger.debug("After sql correction:")
                logger.debug(f"valid_generation_results: {valid_generation_results}")

                if not valid_generation_results and not historical_question_result:
                    logger.exception(
                        f"ask pipeline - NO_RELEVANT_SQL: {ask_request.query}"
                    )
                    self._ask_results[query_id] = AskResultResponse(
                        status="failed",
                        error=AskResultResponse.AskError(
                            code="NO_RELEVANT_SQL",
                            message="No relevant SQL",
                        ),
                    )
                    return

                results = [
                    AskResultResponse.AskResult(
                        **{
                            "sql": result.get("statement"),
                            "summary": result.get("summary"),
                            "type": "view",
                            "viewId": result.get("viewId"),
                        }
                    )
                    for result in historical_question_result
                ] + [
                    AskResultResponse.AskResult(**result)
                    for result in valid_generation_results
                ]

                # only return top 3 results, thus remove the rest
                if len(results) > 3:
                    del results[3:]

                self._ask_results[query_id] = AskResultResponse(
                    status="finished",
                    response=results,
                )
        except Exception as e:
            logger.exception(f"ask pipeline - OTHERS: {e}")

            self._ask_results[query_id] = AskResultResponse(
                status="failed",
                error=AskResultResponse.AskError(
                    code="OTHERS",
                    message=str(e),
                ),
            )

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
                error=AskResultResponse.AskError(
                    code="OTHERS",
                    message=f"{ask_result_request.query_id} is not found",
                ),
            )

        return result


def remove_duplicates(dicts):
    """
    Removes duplicates from a list of dictionaries based on 'sql' and 'summary' fields.

    Args:
    dicts (list of dict): The list of dictionaries to be deduplicated.

    Returns:
    list of dict: A list of dictionaries after removing duplicates.
    """
    # Convert each dictionary to a tuple of (sql, summary) to make them hashable
    seen = set()
    unique_dicts = []
    for d in dicts:
        identifier = (
            d["sql"],
            d["summary"],
        )  # This assumes 'sql' and 'summary' always exist
        if identifier not in seen:
            seen.add(identifier)
            unique_dicts.append(d)
    return unique_dicts
