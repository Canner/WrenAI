import logging
from typing import List, Literal, Optional

from haystack import Pipeline
from pydantic import BaseModel

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-regenerations
class DecisionPoint(BaseModel):
    type: Literal["filters"]
    value: str


class CorrectionPoint(BaseModel):
    type: Literal["sql_highlight", "ui_highlight"]
    value: str | DecisionPoint


class Correction(BaseModel):
    before: DecisionPoint
    after: CorrectionPoint


class SQLRegenerationRequest(BaseModel):
    _query_id: str | None = None
    corrections: List[Correction]

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class SQLRegenerationResponse(BaseModel):
    query_id: str


# GET /v1/sql-regenerations/{query_id}/result
class SQLRegenerationResultRequest(BaseModel):
    query_id: str


class SQLExplanation(BaseModel):
    sql: str
    summary: str
    cte_name: str


class SQLRegenerationResultResponse(BaseModel):
    class SQLRegenerationResponseDetails(BaseModel):
        description: str
        steps: List[SQLExplanation]

    class SQLRegenerationError(BaseModel):
        code: Literal["NO_RELEVANT_SQL", "OTHERS"]
        message: str

    status: Literal["understanding", "generating", "finished", "failed"]
    response: Optional[SQLRegenerationResponseDetails] = None
    error: Optional[SQLRegenerationError] = None


class SQLRegenerationService:
    def __init__(self, pipelines: dict[str, Pipeline]):
        self._pipelines = pipelines
        self.sql_regeneration_results: dict[str, SQLRegenerationResultResponse] = {}

    def sql_regeneration(
        self,
        sql_regeneration_request: SQLRegenerationRequest,
    ):
        try:
            query_id = sql_regeneration_request.query_id

            self.sql_regeneration_results[query_id] = SQLRegenerationResultResponse(
                status="understanding",
            )

            self.sql_regeneration_results[query_id] = SQLRegenerationResultResponse(
                status="generating",
            )

            generation_result = self._pipelines["generation"].run(
                corrections=sql_regeneration_request.corrections,
            )

            sql_regeneration_result = generation_result["post_processor"]["results"]

            logger.debug(f"sql regeneration results: {sql_regeneration_result}")

            self.sql_regeneration_results[query_id] = SQLRegenerationResultResponse(
                status="finished",
                response=sql_regeneration_result,
            )
        except Exception as e:
            logger.error(f"sql regeneration pipeline - OTHERS: {e}")
            self.sql_regeneration_results[
                sql_regeneration_request.query_id
            ] = SQLRegenerationResultResponse(
                status="failed",
                error=SQLRegenerationResultResponse.SQLRegenerationError(
                    code="OTHERS",
                    message=str(e),
                ),
            )

    def get_sql_regeneration_result(
        self, sql_regeneration_result_request: SQLRegenerationResultRequest
    ) -> SQLRegenerationResultResponse:
        if (
            sql_regeneration_result_request.query_id
            not in self.sql_regeneration_results
        ):
            return SQLRegenerationResultResponse(
                status="failed",
                error=SQLRegenerationResultResponse.SQLRegenerationError(
                    code="OTHERS",
                    message=f"{sql_regeneration_result_request.query_id} is not found",
                ),
            )

        return self.sql_regeneration_results[sql_regeneration_result_request.query_id]
