import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from haystack import Pipeline
from pydantic import BaseModel

from src.web.v1.services.ask_details import SQLBreakdown

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-regenerations
class DecisionPoint(BaseModel):
    type: Literal["filter", "selectItems", "relation", "groupByKeys", "sortings"]
    value: str


class CorrectionPoint(BaseModel):
    type: Literal[
        "sql_expression", "nl_expression"
    ]  # nl_expression is natural language expression
    value: str


class UserCorrection(BaseModel):
    before: DecisionPoint
    after: CorrectionPoint


class SQLExplanationWithUserCorrections(BaseModel):
    summary: str
    sql: str
    cte_name: str
    corrections: List[UserCorrection]


class SQLRegenerationRequest(BaseModel):
    _query_id: str | None = None
    description: str
    steps: List[SQLExplanationWithUserCorrections]
    mdl_hash: Optional[str] = None
    thread_id: Optional[str] = None
    project_id: Optional[str] = None

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


class SQLRegenerationResultResponse(BaseModel):
    class SQLRegenerationResponseDetails(BaseModel):
        description: str
        steps: List[SQLBreakdown]

    class SQLRegenerationError(BaseModel):
        code: Literal["NO_RELEVANT_SQL", "OTHERS"]
        message: str

    status: Literal["understanding", "generating", "finished", "failed"]
    response: Optional[SQLRegenerationResponseDetails] = None
    error: Optional[SQLRegenerationError] = None


class SqlRegenerationService:
    def __init__(
        self,
        pipelines: Dict[str, Pipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._sql_regeneration_results: Dict[
            str, SQLRegenerationResultResponse
        ] = TTLCache(maxsize=maxsize, ttl=ttl)

    async def sql_regeneration(
        self,
        sql_regeneration_request: SQLRegenerationRequest,
        **kwargs,
    ):
        try:
            query_id = sql_regeneration_request.query_id

            self._sql_regeneration_results[query_id] = SQLRegenerationResultResponse(
                status="understanding",
            )

            self._sql_regeneration_results[query_id] = SQLRegenerationResultResponse(
                status="generating",
            )

            generation_result = await self._pipelines["sql_regeneration"].run(
                description=sql_regeneration_request.description,
                steps=sql_regeneration_request.steps,
                project_id=sql_regeneration_request.project_id,
            )

            sql_regeneration_result = generation_result[
                "sql_regeneration_post_process"
            ]["results"]

            if not sql_regeneration_result["steps"]:
                self._sql_regeneration_results[
                    query_id
                ] = SQLRegenerationResultResponse(
                    status="failed",
                    error=SQLRegenerationResultResponse.SQLRegenerationError(
                        code="NO_RELEVANT_SQL",
                        message="SQL is not executable",
                    ),
                )
            else:
                self._sql_regeneration_results[
                    query_id
                ] = SQLRegenerationResultResponse(
                    status="finished",
                    response=sql_regeneration_result,
                )
        except Exception as e:
            logger.exception(f"sql regeneration pipeline - OTHERS: {e}")
            self._sql_regeneration_results[
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
            not in self._sql_regeneration_results
        ):
            return SQLRegenerationResultResponse(
                status="failed",
                error=SQLRegenerationResultResponse.SQLRegenerationError(
                    code="OTHERS",
                    message=f"{sql_regeneration_result_request.query_id} is not found",
                ),
            )

        return self._sql_regeneration_results[sql_regeneration_result_request.query_id]
