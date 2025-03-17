import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from haystack import Document
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class SqlCorrectionService:
    class Event(BaseModel, MetadataTraceable):
        class Error(BaseModel):
            code: Literal["OTHERS"]
            message: str

        id: str
        status: Literal["correcting", "finished", "failed"] = "correcting"
        response: Optional[Dict] = None
        error: Optional[Error] = None
        trace_id: Optional[str] = None

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
    ):
        self._cache[id] = self.Event(
            id=id,
            status="failed",
            error=self.Event.Error(code=code, message=error_message),
            trace_id=trace_id,
        )
        logger.error(error_message)

    class CorrectionRequest(BaseModel):
        id: str
        contexts: List[Document]
        invalid_generation_results: List[Dict[str, str]]
        project_id: Optional[str] = None

    @observe(name="SQL Correction")
    @trace_metadata
    async def correct(
        self,
        request: CorrectionRequest,
        **kwargs,
    ):
        logger.info(f"Request {request.id}: SQL Correction process is running...")
        trace_id = kwargs.get("trace_id")

        try:
            # todo: modify the contexts
            # todo: check the result format
            result = await self._pipelines["sql_correction"].run(
                contexts=request.contexts,
                invalid_generation_results=request.invalid_generation_results,
                project_id=request.project_id,
            )

            self._cache[request.id] = self.Event(
                id=request.id,
                status="finished",
                trace_id=trace_id,
                response=result,
            )

        except Exception as e:
            self._handle_exception(
                request.id,
                f"An error occurred during SQL correction: {str(e)}",
                trace_id=trace_id,
            )

        return self._cache[request.id].with_metadata()

    def __getitem__(self, id: str) -> Event:
        response = self._cache.get(id)

        if response is None:
            message = f"SQL Correction Event with ID '{id}' not found."
            logger.exception(message)
            return self.Event(
                id=id,
                status="failed",
                error=self.Event.Error(code="OTHERS", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Event):
        self._cache[id] = value
