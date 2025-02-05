import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.pipelines.indexing.sql_pairs import SqlPair
from src.utils import trace_metadata
from src.web.v1.services import MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class SqlPairsService:
    class Resource(BaseModel, MetadataTraceable):
        class Error(BaseModel):
            code: Literal["OTHERS"]
            message: str

        id: str
        status: Literal["indexing", "deleting", "finished", "failed"] = "indexing"
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, self.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)

    def _handle_exception(
        self,
        id: str,
        error_message: str,
        code: str = "OTHERS",
    ):
        self._cache[id] = self.Resource(
            id=id,
            status="failed",
            error=self.Resource.Error(code=code, message=error_message),
        )
        logger.error(error_message)

    @observe(name="Prepare SQL Pairs")
    @trace_metadata
    async def index(
        self,
        id: str,
        sql_pairs: List[SqlPair],
        project_id: Optional[str] = None,
        **kwargs,
    ):
        logger.info(f"Request {id}: SQL Pairs Indexing process is running...")

        try:
            input = {
                "mdl_str": '{"models": [{"properties": {"boilerplate": "sql_pairs"}}]}',
                "project_id": project_id,
                "external_pairs": {
                    "sql_pairs": [sql_pair.model_dump() for sql_pair in sql_pairs],
                },
            }
            await self._pipelines["sql_pairs"].run(**input)

            self._cache[id] = self.Resource(id=id, status="finished")

        except Exception as e:
            self._handle_exception(
                id,
                f"An error occurred during SQL pairs indexing: {str(e)}",
            )

        return self._cache[id].with_metadata()

    @observe(name="Delete SQL Pairs")
    @trace_metadata
    async def delete(
        self,
        id: str,
        sql_pair_ids: List[str],
        project_id: Optional[str] = None,
        **kwargs,
    ):
        logger.info(f"Request {id}: SQL Pairs Deletion process is running...")

        try:
            sql_pairs = [SqlPair(id=id) for id in sql_pair_ids]
            await self._pipelines["sql_pairs"].clean(
                sql_pairs=sql_pairs, project_id=project_id
            )

            self._cache[id] = self.Resource(id=id, status="finished")
        except Exception as e:
            self._handle_exception(
                id,
                f"Failed to delete SQL pairs: {e}",
            )

        return self._cache[id].with_metadata()

    def __getitem__(self, id: str) -> Resource:
        response = self._cache.get(id)

        if response is None:
            message = f"SQL Pairs Resource with ID '{id}' not found."
            logger.exception(message)
            return self.Resource(
                id=id,
                status="failed",
                error=self.Resource.Error(code="OTHERS", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Resource):
        self._cache[id] = value
