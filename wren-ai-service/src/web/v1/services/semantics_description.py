import logging
from typing import Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class SemanticsDescription:
    class Input(BaseModel):
        id: str
        selected_models: list[str]
        user_prompt: str
        mdl: str

    class Resource(BaseModel, MetadataTraceable):
        class Error(BaseModel):
            code: Literal["OTHERS", "MDL_PARSE_ERROR", "RESOURCE_NOT_FOUND"]
            message: str

        id: str
        status: Literal["generating", "finished", "failed"] = "generating"
        response: Optional[dict] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, SemanticsDescription.Resource] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    def _handle_exception(
        self,
        request: Input,
        error_message: str,
        code: str = "OTHERS",
    ):
        self[request.id] = self.Resource(
            id=request.id,
            status="failed",
            error=self.Resource.Error(code=code, message=error_message),
        )
        logger.error(error_message)

    @observe(name="Generate Semantics Description")
    @trace_metadata
    async def generate(self, request: Input, **kwargs) -> Resource:
        logger.info("Generate Semantics Description pipeline is running...")

        try:
            mdl_dict = orjson.loads(request.mdl)

            input = {
                "user_prompt": request.user_prompt,
                "selected_models": request.selected_models,
                "mdl": mdl_dict,
            }

            resp = await self._pipelines["semantics_description"].run(**input)

            self[request.id] = self.Resource(
                id=request.id, status="finished", response=resp.get("normalize")
            )
        except orjson.JSONDecodeError as e:
            self._handle_exception(
                request,
                f"Failed to parse MDL: {str(e)}",
                code="MDL_PARSE_ERROR",
            )
        except Exception as e:
            self._handle_exception(
                request,
                f"An error occurred during semantics description generation: {str(e)}",
            )

        return self[request.id].with_metadata()

    def __getitem__(self, id: str) -> Resource:
        response = self._cache.get(id)

        if response is None:
            message = f"Semantics Description Resource with ID '{id}' not found."
            logger.exception(message)
            return self.Resource(
                id=id,
                status="failed",
                error=self.Resource.Error(code="RESOURCE_NOT_FOUND", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Resource):
        self._cache[id] = value
