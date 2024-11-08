import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import Configuration, MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class DraftCandidate:
    class Input(BaseModel):
        id: str
        sql: str
        question: str
        project_id: Optional[str] = None
        configuration: Optional[Configuration] = Configuration()

    class Resource(BaseModel, MetadataTraceable):
        class Error(BaseModel):
            code: Literal["OTHERS", "SQL_PARSE_ERROR", "RESOURCE_NOT_FOUND"]
            message: str

        id: str
        status: Literal["generating", "finished", "failed"] = "generating"
        response: Optional[dict] = {"candidates": []}
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, DraftCandidate.Resource] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    def _handle_exception(
        self,
        input: Input,
        error_message: str,
        code: str = "OTHERS",
    ):
        self._cache[input.id] = self.Resource(
            id=input.id,
            status="failed",
            error=self.Resource.Error(code=code, message=error_message),
        )
        logger.error(error_message)

    @observe(name="Generate Draft Candidates")
    @trace_metadata
    async def generate(self, input: Input, **kwargs) -> Resource:
        logger.info("Generate Draft Candidates pipeline is running...")

        try:
            request = {
                "sql": input.sql,
                "question": input.question,
                "language": input.configuration.language,
                "current_date": input.configuration.show_current_time(),
            }

            resp = await self._pipelines["draft_candidate"].run(**request)
            candidates = resp.get("normalized", {}).get("candidates", [])

            self._cache[request.id] = self.Resource(
                id=request.id,
                status="finished",
                response={"candidates": candidates},
            )
        except Exception as e:
            self._handle_exception(
                request,
                f"An error occurred during draft candidate generation: {str(e)}",
            )

        return self._cache[request.id].with_metadata()

    def __getitem__(self, id: str) -> Resource:
        response = self._cache.get(id)

        if response is None:
            message = f"Draft Candidate Resource with ID '{id}' not found."
            logger.exception(message)
            return self.Resource(
                id=id,
                status="failed",
                error=self.Resource.Error(code="RESOURCE_NOT_FOUND", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Resource):
        self._cache[id] = value
