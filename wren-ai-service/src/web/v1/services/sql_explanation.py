import logging
from typing import Literal, Optional

from haystack import Pipeline
from pydantic import BaseModel

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-explanations
class SQLExplanationRequest(BaseModel):
    _query_id: str | None = None
    question: str
    sql: str
    sql_summary: str
    sql_analysis: dict
    full_sql: str

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
    response: Optional[dict] = None
    error: Optional[str] = None


class SQLExplanationService:
    def __init__(self, pipelines: dict[str, Pipeline]):
        self._pipelines = pipelines
        self.sql_explanation_results: dict[str, SQLExplanationResultResponse] = {}

    def sql_explanation(self, sql_explanation_request: SQLExplanationRequest):
        try:
            query_id = sql_explanation_request.query_id

            self.sql_explanation_results[query_id] = SQLExplanationResultResponse(
                status="understanding",
            )

            self.sql_explanation_results[query_id] = SQLExplanationResultResponse(
                status="generating",
            )

            generation_result = self._pipelines["generation"].run(
                question=sql_explanation_request.question,
                sql=sql_explanation_request.sql,
                sql_summary=sql_explanation_request.sql_summary,
                sql_analysis=sql_explanation_request.sql_analysis,
                full_sql=sql_explanation_request.full_sql,
            )

            sql_explanation_result = generation_result["post_processor"]["results"]

            logger.debug(f"sql explanation results: {sql_explanation_result}")

            self.sql_explanation_results[query_id] = SQLExplanationResultResponse(
                status="finished",
                response=sql_explanation_result,
            )
        except Exception as e:
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
