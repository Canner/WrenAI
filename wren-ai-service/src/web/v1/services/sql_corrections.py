import logging
from typing import Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class SqlCorrectionService:
    class Error(BaseModel):
        code: Literal["OTHERS"]
        message: str

    class Event(BaseModel, MetadataTraceable):
        event_id: str
        status: Literal["correcting", "finished", "failed"] = "correcting"
        response: Optional[str] = None
        error: Optional["SqlCorrectionService.Error"] = None
        trace_id: Optional[str] = None

    def __init__(
        self,
        pipelines: dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: dict[str, self.Event] = TTLCache(maxsize=maxsize, ttl=ttl)

    def _handle_exception(
        self,
        event_id: str,
        error_message: str,
        code: str = "OTHERS",
        trace_id: Optional[str] = None,
    ):
        self._cache[event_id] = self.Event(
            event_id=event_id,
            status="failed",
            error=self.Error(code=code, message=error_message),
            trace_id=trace_id,
        )
        logger.error(error_message)

    class CorrectionRequest(BaseModel):
        event_id: str
        sql: str
        error: str
        project_id: Optional[str] = None

    @observe(name="SQL Correction")
    @trace_metadata
    async def correct(
        self,
        request: CorrectionRequest,
        **kwargs,
    ):
        logger.info(f"Request {request.event_id}: SQL Correction process is running...")
        trace_id = kwargs.get("trace_id")
        event_id = request.event_id
        sql = request.sql
        error = request.error
        project_id = request.project_id

        try:
            _invalid = {
                "sql": sql,
                "error": error,
            }

            tables = (
                await self._pipelines["sql_tables_extraction"].run(
                    sql=sql,
                )
            )["post_process"]

            documents = (
                (
                    await self._pipelines["db_schema_retrieval"].run(
                        project_id=project_id,
                        tables=tables,
                    )
                )
                .get("construct_retrieval_results", {})
                .get("retrieval_results", [])
            )
            table_ddls = [document.get("table_ddl") for document in documents]

            res = await self._pipelines["sql_correction"].run(
                contexts=table_ddls,
                invalid_generation_results=[_invalid],
                project_id=project_id,
            )

            post_process = res["post_process"]
            valid = post_process["valid_generation_results"]
            invalid = post_process["invalid_generation_results"]

            if not valid:
                error_message = invalid[0]["error"]
                self._handle_exception(
                    event_id,
                    f"An error occurred during SQL correction: {error_message}",
                    trace_id=trace_id,
                )
            else:
                corrected = valid[0]["sql"]
                self._cache[event_id] = self.Event(
                    event_id=event_id,
                    status="finished",
                    trace_id=trace_id,
                    response=corrected,
                )

        except Exception as e:
            self._handle_exception(
                event_id,
                f"An error occurred during SQL correction: {str(e)}",
                trace_id=trace_id,
            )

        return self._cache[event_id].with_metadata()

    def __getitem__(self, event_id: str) -> Event:
        response = self._cache.get(event_id)

        if response is None:
            message = f"SQL Correction Event with ID '{event_id}' not found."
            logger.exception(message)
            return self.Event(
                event_id=event_id,
                status="failed",
                error=self.Error(code="OTHERS", message=message),
            )

        return response

    def __setitem__(self, event_id: str, value: Event):
        self._cache[event_id] = value
