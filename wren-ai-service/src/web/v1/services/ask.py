import logging
from typing import List, Literal, Optional

import sqlparse
from haystack import Pipeline
from pydantic import BaseModel

from src.utils import remove_duplicates, timer

logger = logging.getLogger("wren-ai-service")


# POST /v1/semantics-preparations
class SemanticsPreparationRequest(BaseModel):
    mdl: str
    id: str


class SemanticsPreparationResponse(BaseModel):
    id: str


# GET /v1/semantics-preparations/{task_id}/status
class SemanticsPreparationStatusRequest(BaseModel):
    id: str


class SemanticsPreparationStatusResponse(BaseModel):
    status: Literal["indexing", "finished", "failed"]
    error: Optional[str] = None


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
    id: str  # for identifying which collection to access from vectordb, the same hash string for identifying which mdl model deployment from backend
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

    class ViewResult(AskResult):
        viewId: str

    class AskError(BaseModel):
        code: Literal[
            "MISLEADING_QUERY", "NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"
        ]
        message: str

    status: Literal[
        "understanding", "searching", "generating", "finished", "failed", "stopped"
    ]
    response: Optional[List[AskResult | ViewResult]] = None
    error: Optional[AskError] = None


class AskService:
    def __init__(self, pipelines: dict[str, Pipeline]):
        self._pipelines = pipelines
        self.prepare_semantics_statuses: dict[
            str, SemanticsPreparationStatusResponse.status
        ] = {}
        self.ask_results: dict[str, AskResultResponse] = {}

    def prepare_semantics(self, prepare_semantics_request: SemanticsPreparationRequest):
        try:
            print(prepare_semantics_request.mdl)
            self._pipelines["indexing"].run(prepare_semantics_request.mdl)

            self.prepare_semantics_statuses[
                prepare_semantics_request.id
            ] = SemanticsPreparationStatusResponse(status="finished")
        except Exception as e:
            logger.error(f"ask pipeline - Failed to prepare semantics: {e}")
            self.prepare_semantics_statuses[
                prepare_semantics_request.id
            ] = SemanticsPreparationStatusResponse(
                status="failed",
                error=f"Failed to prepare semantics: {e}",
            )

    def get_prepare_semantics_status(
        self, prepare_semantics_status_request: SemanticsPreparationStatusRequest
    ) -> SemanticsPreparationStatusResponse:
        if prepare_semantics_status_request.id not in self.prepare_semantics_statuses:
            logger.error(
                f"ask pipeline - id is not found for SemanticsPreparation: {prepare_semantics_status_request.id}"
            )
            return SemanticsPreparationStatusResponse(
                status="failed",
                error=f"{prepare_semantics_status_request.id} is not found",
            )

        return self.prepare_semantics_statuses[prepare_semantics_status_request.id]

    def _is_stopped(self, query_id: str):
        return (
            query_id in self.ask_results
            and self.ask_results[query_id].status == "stopped"
        )

    @timer
    def ask(
        self,
        ask_request: AskRequest,
    ):
        try:
            # ask status can be understanding, searching, generating, finished, failed, stopped
            # we will need to handle business logic for each status
            query_id = ask_request.query_id

            if not self._is_stopped(query_id):
                self.ask_results[query_id] = AskResultResponse(status="understanding")

                query_understanding_result = self._pipelines["query_understanding"].run(
                    query=ask_request.query,
                )

                if not query_understanding_result["post_processor"]["is_valid_query"]:
                    logger.error(
                        f"ask pipeline - MISLEADING_QUERY: {ask_request.query}"
                    )
                    self.ask_results[query_id] = AskResultResponse(
                        status="failed",
                        error=AskResultResponse.AskError(
                            code="MISLEADING_QUERY",
                            message="Misleading query, please ask a more specific question.",
                        ),
                    )
                    return

            if not self._is_stopped(query_id):
                self.ask_results[query_id] = AskResultResponse(status="searching")

                retrieval_result = self._pipelines["retrieval"].run(
                    query=ask_request.query,
                )
                documents = retrieval_result["retriever"]["documents"]

                if not documents:
                    logger.error(
                        f"ask pipeline - NO_RELEVANT_DATA: {ask_request.query}"
                    )
                    self.ask_results[query_id] = AskResultResponse(
                        status="failed",
                        error=AskResultResponse.AskError(
                            code="NO_RELEVANT_DATA",
                            message="No relevant data",
                        ),
                    )
                    return

            if not self._is_stopped(query_id):
                self.ask_results[query_id] = AskResultResponse(status="generating")

                historical_question_result = (
                    self._pipelines["historical_question"]
                    .run(query=ask_request.query)
                    .get("output_formatter", {})
                    .get("documents")
                )

                if ask_request.history:
                    text_to_sql_generation_results = self._pipelines[
                        "followup_generation"
                    ].run(
                        query=ask_request.query,
                        contexts=documents,
                        history=ask_request.history,
                    )
                else:
                    text_to_sql_generation_results = self._pipelines["generation"].run(
                        query=ask_request.query,
                        contexts=documents,
                        exclude=historical_question_result,
                    )

                valid_generation_results = []
                if text_to_sql_generation_results["post_processor"][
                    "valid_generation_results"
                ]:
                    valid_generation_results += text_to_sql_generation_results[
                        "post_processor"
                    ]["valid_generation_results"]

                logger.debug("Documents:")
                for document in documents:
                    logger.debug(f"score: {document.score}")
                    logger.debug(f"content: {document.content}")

                logger.debug("Before sql correction:")
                logger.debug(f"valid_generation_results: {valid_generation_results}")

                if text_to_sql_generation_results["post_processor"][
                    "invalid_generation_results"
                ]:
                    sql_correction_results = self._pipelines["sql_correction"].run(
                        contexts=documents,
                        invalid_generation_results=text_to_sql_generation_results[
                            "post_processor"
                        ]["invalid_generation_results"],
                    )
                    valid_generation_results += sql_correction_results[
                        "post_processor"
                    ]["valid_generation_results"]

                    logger.debug(
                        f'sql_correction_results: {sql_correction_results["post_processor"]}'
                    )

                    for results in sql_correction_results["post_processor"][
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
                    logger.error(f"ask pipeline - NO_RELEVANT_SQL: {ask_request.query}")
                    self.ask_results[query_id] = AskResultResponse(
                        status="failed",
                        error=AskResultResponse.AskError(
                            code="NO_RELEVANT_SQL",
                            message="No relevant SQL",
                        ),
                    )
                    return

                results = [
                    AskResultResponse.ViewResult(
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

                self.ask_results[query_id] = AskResultResponse(
                    status="finished",
                    response=results,
                )
        except Exception as e:
            logger.error(f"ask pipeline - OTHERS: {e}")
            self.ask_results[ask_request.query_id] = AskResultResponse(
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
        self.ask_results[stop_ask_request.query_id] = AskResultResponse(
            status="stopped",
        )

    @timer
    def get_ask_result(
        self,
        ask_result_request: AskResultRequest,
    ) -> AskResultResponse:
        if ask_result_request.query_id not in self.ask_results:
            logger.error(
                f"ask pipeline - OTHERS: {ask_result_request.query_id} is not found"
            )
            return AskResultResponse(
                status="failed",
                error=AskResultResponse.AskError(
                    code="OTHERS",
                    message=f"{ask_result_request.query_id} is not found",
                ),
            )

        return self.ask_results[ask_result_request.query_id]
