import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.pipelines.indexing.sql_pairs import SqlPair
from src.utils import trace_metadata

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-pairs
class SqlPairsPreparationRequest(BaseModel):
    _query_id: str | None = None
    sql_pairs: List[SqlPair]
    project_id: Optional[str] = None

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class SqlPairsPreparationResponse(BaseModel):
    sql_pairs_preparation_id: str


# DELETE /v1/sql-pairs
class DeleteSqlPairsRequest(BaseModel):
    _query_id: str | None = None
    ids: List[str]
    project_id: Optional[str] = None

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class DeleteSqlPairsResponse(BaseModel):
    sql_pairs_preparation_id: str


# GET /v1/sql-pairs/{sql_pairs_preparation_id}
class SqlPairsPreparationStatusRequest(BaseModel):
    sql_pairs_preparation_id: str


class SqlPairsPreparationStatusResponse(BaseModel):
    class SqlPairsPreparationError(BaseModel):
        code: Literal["OTHERS"]
        message: str

    status: Literal["indexing", "deleting", "finished", "failed"]
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

    @observe(name="Prepare SQL Pairs")
    @trace_metadata
    async def prepare_sql_pairs(
        self,
        prepare_sql_pairs_request: SqlPairsPreparationRequest,
        **kwargs,
    ):
        results = {
            "metadata": {
                "error_type": "",
                "error_message": "",
            },
        }

        try:
            # TODO: Implement proper SQL pairs preparation functionality. Current implementation needs to be updated.
            await self._pipelines["sql_pairs_preparation"].run(
                sql_pairs=prepare_sql_pairs_request.sql_pairs,
                project_id=prepare_sql_pairs_request.project_id,
            )

            self._prepare_sql_pairs_statuses[
                prepare_sql_pairs_request.query_id
            ] = SqlPairsPreparationStatusResponse(
                status="finished",
            )
        except Exception as e:
            logger.exception(f"Failed to prepare SQL pairs: {e}")

            self._prepare_sql_pairs_statuses[
                prepare_sql_pairs_request.query_id
            ] = SqlPairsPreparationStatusResponse(
                status="failed",
                error=SqlPairsPreparationStatusResponse.SqlPairsPreparationError(
                    code="OTHERS",
                    message=f"Failed to prepare SQL pairs: {e}",
                ),
            )

            results["metadata"]["error_type"] = "INDEXING_FAILED"
            results["metadata"]["error_message"] = str(e)

        return results

    @observe(name="Delete SQL Pairs")
    @trace_metadata
    async def delete_sql_pairs(
        self,
        delete_sql_pairs_request: DeleteSqlPairsRequest,
        **kwargs,
    ):
        results = {
            "metadata": {
                "error_type": "",
                "error_message": "",
            },
        }

        try:
            await self._pipelines["sql_pairs_deletion"].run(
                sql_pair_ids=delete_sql_pairs_request.ids,
                id=delete_sql_pairs_request.project_id,
            )

            self._prepare_sql_pairs_statuses[
                delete_sql_pairs_request.query_id
            ] = SqlPairsPreparationStatusResponse(
                status="finished",
            )
        except Exception as e:
            logger.exception(f"Failed to delete SQL pairs: {e}")

            self._prepare_sql_pairs_statuses[
                delete_sql_pairs_request.query_id
            ] = SqlPairsPreparationStatusResponse(
                status="failed",
                error=SqlPairsPreparationStatusResponse.SqlPairsPreparationError(
                    code="OTHERS",
                    message=f"Failed to delete SQL pairs: {e}",
                ),
            )

            results["metadata"]["error_type"] = "DELETION_FAILED"
            results["metadata"]["error_message"] = str(e)

        return results

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
