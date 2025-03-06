import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.pipelines.indexing.instructions import Instruction
from src.utils import trace_metadata
from src.web.v1.services import MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class InstructionsService:
    class Error(BaseModel):
        code: Literal["OTHERS"]
        message: str

    class Event(BaseModel, MetadataTraceable):
        id: str
        status: Literal["indexing", "deleting", "finished", "failed"] = "indexing"
        error: Optional["InstructionsService.Error"] = None
        trace_id: Optional[str] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, self.Event] = TTLCache(maxsize=maxsize, ttl=ttl)

    # todo: move it to utils for super class?
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

    class IndexRequest(BaseModel):
        id: str
        instructions: List[Instruction]
        project_id: Optional[str] = None

    @observe(name="Index Instructions")
    @trace_metadata
    async def index(
        self,
        request: IndexRequest,
        **kwargs,
    ):
        logger.info(
            f"Request {request.id}: Instructions Indexing process is running..."
        )
        trace_id = kwargs.get("trace_id")

        try:
            await self._pipelines["instructions_indexing"].run(
                project_id=request.project_id,
                instructions=request.instructions,
            )

            self._cache[request.id] = self.Event(
                id=request.id,
                status="finished",
                trace_id=trace_id,
            )

        except Exception as e:
            self._handle_exception(
                request.id,
                f"An error occurred during instructions indexing: {str(e)}",
                trace_id=trace_id,
            )

        return self._cache[request.id].with_metadata()

    class DeleteRequest(BaseModel):
        id: str
        instruction_ids: List[str]
        project_id: Optional[str] = None

    @observe(name="Delete Instructions")
    @trace_metadata
    async def delete(
        self,
        request: DeleteRequest,
        **kwargs,
    ):
        logger.info(
            f"Request {request.id}: Instructions Deletion process is running..."
        )
        trace_id = kwargs.get("trace_id")

        try:
            instructions = [Instruction(id=id) for id in request.instruction_ids]
            await self._pipelines["instructions_indexing"].clean(
                instructions=instructions, project_id=request.project_id
            )

            self._cache[request.id] = self.Event(
                id=request.id,
                status="finished",
                trace_id=trace_id,
            )
        except Exception as e:
            self._handle_exception(
                request.id,
                f"Failed to delete instructions: {e}",
                trace_id=trace_id,
            )

        return self._cache[request.id].with_metadata()

    def __getitem__(self, id: str) -> Event:
        response = self._cache.get(id)

        if response is None:
            message = f"Instructions Event with ID '{id}' not found."
            logger.exception(message)
            return self.Event(
                id=id,
                status="failed",
                error=self.Event.Error(code="OTHERS", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Event):
        self._cache[id] = value
