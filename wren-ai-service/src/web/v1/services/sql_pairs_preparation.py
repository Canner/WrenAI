import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-pairs-preparations
class SqlPairsPreparationRequest(BaseModel):
    _query_id: str | None = None
    sqls: List[str]
    project_id: Optional[str] = None

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class SqlPairsPreparationResponse(BaseModel):
    sql_pairs_preparation_id: str


# GET /v1/sql-pairs-preparations/{sql_pairs_preparation_id}/status
class SqlPairsPreparationStatusRequest(BaseModel):
    sql_pairs_preparation_id: str


class SqlPairsPreparationStatusResponse(BaseModel):
    class SqlPairsPreparationError(BaseModel):
        code: Literal["OTHERS"]
        message: str

    status: Literal["indexing", "finished", "failed"]
    error: Optional[SqlPairsPreparationError] = None


class SqlPairsPreparationService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._prepare_sql_pairs_statuses: Dict[
            str, SqlPairsPreparationStatusResponse
        ] = TTLCache(maxsize=maxsize, ttl=ttl)

    @async_timer
    @observe(name="Prepare SQL Pairs")
    @trace_metadata
    async def prepare_sql_pairs(
        self,
        prepare_sql_pairs_request: SqlPairsPreparationRequest,
        **kwargs,
    ):
        pass

    def get_prepare_sql_pairs_status(
        self, prepare_sql_pairs_status_request: SqlPairsPreparationStatusRequest
    ) -> SqlPairsPreparationStatusResponse:
        if (
            result := self._prepare_sql_pairs_statuses.get(
                prepare_sql_pairs_status_request.sql_pairs_preparation_id
            )
        ) is None:
            logger.exception(
                f"id is not found for SqlPairsPreparation: {prepare_sql_pairs_status_request.sql_pairs_preparation_id}"
            )
            return SqlPairsPreparationStatusResponse(
                status="failed",
                error=SqlPairsPreparationStatusResponse.SqlPairsPreparationError(
                    code="OTHERS",
                    message=f"{prepare_sql_pairs_status_request.sql_pairs_preparation_id} is not found",
                ),
            )

        return result
