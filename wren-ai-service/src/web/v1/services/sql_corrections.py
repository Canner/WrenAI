import logging
from typing import List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, MetadataTraceable

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
        invalid_sql: Optional[str] = None
        trace_id: Optional[str] = None
        request_from: Literal["ui", "api"] = "ui"

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
        invalid_sql: Optional[str] = None,
        trace_id: Optional[str] = None,
        request_from: Literal["ui", "api"] = "ui",
    ):
        self._cache[event_id] = self.Event(
            event_id=event_id,
            status="failed",
            error=self.Error(code=code, message=error_message),
            trace_id=trace_id,
            invalid_sql=invalid_sql,
            request_from=request_from,
        )
        logger.error(error_message)

    class CorrectionRequest(BaseRequest):
        event_id: str
        sql: str
        error: str
        retrieved_tables: Optional[List[str]] = None
        use_dry_plan: bool = False
        allow_dry_plan_fallback: bool = True

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
        retrieved_tables = request.retrieved_tables
        use_dry_plan = request.use_dry_plan
        allow_dry_plan_fallback = request.allow_dry_plan_fallback

        try:
            _invalid = {
                "sql": sql,
                "error": error,
            }

            if not retrieved_tables:
                retrieved_tables = (
                    await self._pipelines["sql_tables_extraction"].run(
                        sql=sql,
                    )
                )["post_process"]

            documents = (
                (
                    await self._pipelines["db_schema_retrieval"].run(
                        project_id=project_id,
                        tables=retrieved_tables,
                    )
                )
                .get("construct_retrieval_results", {})
                .get("retrieval_results", [])
            )
            table_ddls = [document.get("table_ddl") for document in documents]

            res = await self._pipelines["sql_correction"].run(
                contexts=table_ddls,
                invalid_generation_result=_invalid,
                project_id=project_id,
                use_dry_plan=use_dry_plan,
                allow_dry_plan_fallback=allow_dry_plan_fallback,
            )

            post_process = res["post_process"]
            valid = post_process["valid_generation_result"]
            invalid = post_process["invalid_generation_result"]

            if not valid:
                error_message = invalid["error"]
                self._handle_exception(
                    event_id,
                    f"An error occurred during SQL correction: {error_message}",
                    trace_id=trace_id,
                    invalid_sql=invalid["sql"],
                    request_from=request.request_from,
                )
            else:
                corrected = valid["sql"]
                self._cache[event_id] = self.Event(
                    event_id=event_id,
                    status="finished",
                    trace_id=trace_id,
                    response=corrected,
                    request_from=request.request_from,
                )

        except Exception as e:
            self._handle_exception(
                event_id,
                f"An error occurred during SQL correction: {str(e)}",
                trace_id=trace_id,
                request_from=request.request_from,
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
