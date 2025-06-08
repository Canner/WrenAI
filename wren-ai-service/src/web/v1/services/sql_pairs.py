import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.pipelines.indexing.sql_pairs import SqlPair
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class SqlPairsService:
    class Event(BaseModel, MetadataTraceable):
        class Error(BaseModel):
            code: Literal["OTHERS"]
            message: str

        id: str
        status: Literal["indexing", "deleting", "finished", "failed"] = "indexing"
        error: Optional[Error] = None
        trace_id: Optional[str] = None
        request_from: Literal["ui", "api"] = "ui"

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, self.Event] = TTLCache(maxsize=maxsize, ttl=ttl)

    def _handle_exception(
        self,
        id: str,
        error_message: str,
        code: str = "OTHERS",
        trace_id: Optional[str] = None,
        request_from: Literal["ui", "api"] = "ui",
    ):
        self._cache[id] = self.Event(
            id=id,
            status="failed",
            error=self.Event.Error(code=code, message=error_message),
            trace_id=trace_id,
            request_from=request_from,
        )
        logger.error(error_message)

    class IndexRequest(BaseRequest):
        id: str
        sql_pairs: List[SqlPair]

    @observe(name="Prepare SQL Pairs")
    @trace_metadata
    async def index(
        self,
        request: IndexRequest,
        **kwargs,
    ):
        logger.info(f"Request {request.id}: SQL Pairs Indexing process is running...")
        trace_id = kwargs.get("trace_id")

        try:
            input = {
                "mdl_str": '{"models": [{"properties": {"boilerplate": "sql_pairs"}}]}',
                "project_id": request.project_id,
                "external_pairs": {
                    "sql_pairs": [
                        sql_pair.model_dump() for sql_pair in request.sql_pairs
                    ],
                },
            }
            await self._pipelines["sql_pairs"].run(**input)

            self._cache[request.id] = self.Event(
                id=request.id,
                status="finished",
                trace_id=trace_id,
                request_from=request.request_from,
            )

        except Exception as e:
            self._handle_exception(
                request.id,
                f"An error occurred during SQL pairs indexing: {str(e)}",
                trace_id=trace_id,
                request_from=request.request_from,
            )

        return self._cache[request.id].with_metadata()

    class DeleteRequest(BaseRequest):
        id: str
        sql_pair_ids: List[str]

    @observe(name="Delete SQL Pairs")
    @trace_metadata
    async def delete(
        self,
        request: DeleteRequest,
        **kwargs,
    ):
        logger.info(f"Request {request.id}: SQL Pairs Deletion process is running...")

        try:
            sql_pairs = [SqlPair(id=id) for id in request.sql_pair_ids]
            await self._pipelines["sql_pairs"].clean(
                sql_pairs=sql_pairs, project_id=request.project_id
            )

            self._cache[request.id] = self.Event(
                id=request.id,
                status="finished",
                request_from=request.request_from,
            )
        except Exception as e:
            self._handle_exception(
                request.id,
                f"Failed to delete SQL pairs: {e}",
                request_from=request.request_from,
            )

        return self._cache[request.id].with_metadata()

    def __getitem__(self, id: str) -> Event:
        response = self._cache.get(id)

        if response is None:
            message = f"SQL Pairs Event with ID '{id}' not found."
            logger.exception(message)
            return self.Event(
                id=id,
                status="failed",
                error=self.Event.Error(code="OTHERS", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Event):
        self._cache[id] = value
