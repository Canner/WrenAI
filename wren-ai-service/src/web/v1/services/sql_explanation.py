import asyncio
import logging
from typing import Dict, List, Literal, Optional

from haystack import Pipeline
from pydantic import BaseModel

from src.utils import async_timer

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-explanations
class SQLExplanationRequest(BaseModel):
    class StepWithAnalysisResult(BaseModel):
        sql: str
        summary: str
        sql_analysis_results: List[Dict]

    _query_id: str | None = None
    question: str
    steps_with_analysis_results: List[StepWithAnalysisResult]

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
    status: Literal["understanding", "generating", "finished", "failed"]
    response: Optional[List[List[Dict]]] = None
    error: Optional[str] = None


class SQLExplanationService:
    def __init__(self, pipelines: dict[str, Pipeline]):
        self._pipelines = pipelines
        self.sql_explanation_results: dict[str, SQLExplanationResultResponse] = {}

    @async_timer
    async def sql_explanation(self, sql_explanation_request: SQLExplanationRequest):
        try:
            query_id = sql_explanation_request.query_id

            self.sql_explanation_results[query_id] = SQLExplanationResultResponse(
                status="understanding",
            )

            self.sql_explanation_results[query_id] = SQLExplanationResultResponse(
                status="generating",
            )

            sql_explanation_results = []

            async def _task(
                question: str,
                step_with_analysis_results: SQLExplanationRequest.StepWithAnalysisResult,
            ):
                return await self._pipelines["generation"].run(
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

            logger.debug(f"sql explanation results: {sql_explanation_results}")

            self.sql_explanation_results[query_id] = SQLExplanationResultResponse(
                status="finished",
                response=[
                    generation_result["post_process"]["results"]
                    for generation_result in generation_results
                ],
            )
        except Exception as e:
            logger.exception(
                f"sql explanation pipeline - Failed to provide SQL explanation: {e}"
            )
            self.sql_explanation_results[
                sql_explanation_request.query_id
            ] = SQLExplanationResultResponse(
                status="failed",
                error=str(e),
            )

    def get_sql_explanation_result(
        self, sql_explanation_result_request: SQLExplanationResultRequest
    ) -> SQLExplanationResultResponse:
        if sql_explanation_result_request.query_id not in self.sql_explanation_results:
            return SQLExplanationResultResponse(
                status="failed",
                error=f"{sql_explanation_result_request.query_id} is not found",
            )

        return self.sql_explanation_results[sql_explanation_result_request.query_id]
