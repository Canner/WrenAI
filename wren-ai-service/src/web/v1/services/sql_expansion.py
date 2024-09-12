import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, trace_metadata
from src.web.v1.services.ask import AskError, AskHistory, AskResult

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-expansions
class SqlExpansionRequest(BaseModel):
    _query_id: str | None = None
    query: str
    history: AskHistory
    # for identifying which collection to access from vectordb
    project_id: Optional[str] = None
    mdl_hash: Optional[str] = None
    thread_id: Optional[str] = None
    user_id: Optional[str] = None


class SqlExpansionResponse(BaseModel):
    query_id: str


# PATCH /v1/sql-expansions/{query_id}
class StopSqlExpansionRequest(BaseModel):
    _query_id: str | None = None
    status: Literal["stopped"]

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class StopSqlExpansionResponse(BaseModel):
    query_id: str


# GET /v1/sql-expansions/{query_id}/result
class SqlExpansionResultRequest(BaseModel):
    query_id: str


class SqlExpansionResultResponse(BaseModel):
    status: Literal[
        "understanding", "searching", "generating", "finished", "failed", "stopped"
    ]
    response: Optional[AskResult] = None
    error: Optional[AskError] = None


class SqlExpansionService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._sql_expansion_results: Dict[str, SqlExpansionResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    def _is_stopped(self, query_id: str):
        if (
            result := self._sql_expansion_results.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    @async_timer
    @observe(name="SQL Expansion")
    @trace_metadata
    async def sql_expansion(
        self,
        sql_expansion_request: SqlExpansionRequest,
    ):
        pass

    def stop_sql_expansion(
        self,
        stop_sql_expansion_request: StopSqlExpansionRequest,
    ):
        self._sql_expansion_results[
            stop_sql_expansion_request.query_id
        ] = SqlExpansionResultResponse(status="stopped")

    def get_sql_expansion_result(
        self,
        sql_expansion_result_request: SqlExpansionResultRequest,
    ) -> SqlExpansionResultResponse:
        if (
            result := self._sql_expansion_results.get(
                sql_expansion_result_request.query_id
            )
        ) is None:
            logger.exception(
                f"sql-expansion pipeline - OTHERS: {sql_expansion_result_request.query_id} is not found"
            )
            return SqlExpansionResultRequest(
                status="failed",
                error=AskError(
                    code="OTHERS",
                    message=f"{sql_expansion_result_request.query_id} is not found",
                ),
            )

        return result
