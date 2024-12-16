import asyncio
import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from haystack import Pipeline
from pydantic import BaseModel

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-explanations
class StepWithAnalysisResult(BaseModel):
    sql: str
    summary: str
    sql_analysis_results: List[Dict]


class SQLExplanationRequest(BaseModel):
    _query_id: str | None = None
    question: str
    steps_with_analysis_results: List[StepWithAnalysisResult]
    mdl_hash: Optional[str] = None
    thread_id: Optional[str] = None
    project_id: Optional[str] = None

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class SQLExplanationResponse(BaseModel):
    query_id: str


# GET /v1/sql-explanations/{query_id}/result
class SQLExplanationResultRequest(BaseModel):
    query_id: str


class SQLExplanationResultResponse(BaseModel):
    class SQLExplanationResultError(BaseModel):
        code: Literal["OTHERS"]
        message: str

    status: Literal["understanding", "generating", "finished", "failed"]
    response: Optional[List[List[Dict]]] = None
    error: Optional[SQLExplanationResultError] = None


class SqlExplanationService:
    def __init__(
        self,
        pipelines: Dict[str, Pipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._sql_explanation_results: Dict[
            str, SQLExplanationResultResponse
        ] = TTLCache(maxsize=maxsize, ttl=ttl)

    async def sql_explanation(
        self,
        sql_explanation_request: SQLExplanationRequest,
        **kwargs,
    ):
        try:
            query_id = sql_explanation_request.query_id

            self._sql_explanation_results[query_id] = SQLExplanationResultResponse(
                status="understanding",
            )

            self._sql_explanation_results[query_id] = SQLExplanationResultResponse(
                status="generating",
            )

            async def _task(
                question: str,
                step_with_analysis_results: StepWithAnalysisResult,
            ):
                return await self._pipelines["sql_explanation"].run(
                    question=question,
                    step_with_analysis_results=step_with_analysis_results,
                )

            tasks = [
                _task(
                    sql_explanation_request.question,
                    step_with_analysis_results,
                )
                for step_with_analysis_results in sql_explanation_request.steps_with_analysis_results
            ]
            generation_results = await asyncio.gather(*tasks)

            sql_explanation_results = [
                generation_result["post_process"]["results"]
                for generation_result in generation_results
            ]

            if sql_explanation_results:
                self._sql_explanation_results[query_id] = SQLExplanationResultResponse(
                    status="finished",
                    response=sql_explanation_results,
                )
            else:
                self._sql_explanation_results[query_id] = SQLExplanationResultResponse(
                    status="failed",
                    error=SQLExplanationResultResponse.SQLExplanationResultError(
                        code="OTHERS",
                        message="No SQL explanation is found",
                    ),
                )
        except Exception as e:
            logger.exception(
                f"sql explanation pipeline - Failed to provide SQL explanation: {e}"
            )
            self._sql_explanation_results[
                sql_explanation_request.query_id
            ] = SQLExplanationResultResponse(
                status="failed",
                error=SQLExplanationResultResponse.SQLExplanationResultError(
                    code="OTHERS",
                    message=str(e),
                ),
            )

    def get_sql_explanation_result(
        self, sql_explanation_result_request: SQLExplanationResultRequest
    ) -> SQLExplanationResultResponse:
        if sql_explanation_result_request.query_id not in self._sql_explanation_results:
            return SQLExplanationResultResponse(
                status="failed",
                error=f"{sql_explanation_result_request.query_id} is not found",
            )

        return self._sql_explanation_results[sql_explanation_result_request.query_id]
