import logging
from typing import Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata

logger = logging.getLogger("wren-ai-service")


class SemanticsDescription:
    class Input(BaseModel):
        id: str
        selected_models: list[str]
        user_prompt: str
        mdl: str

    class Resource(BaseModel):
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
        input: Input,
        error_message: str,
        code: str = "OTHERS",
    ) -> Resource:
        resource = self.Resource(
            id=input.id,
            status="failed",
            error=self.Resource.Error(code=code, message=error_message),
        )
        self._cache[input.id] = resource
        logger.error(error_message)
        return resource

    @observe(name="Generate Semantics Description")
    @trace_metadata
    async def generate(self, input: Input, **kwargs) -> Resource:
        logger.info("Generate Semantics Description pipeline is running...")

        resource = self.Resource(id=input.id, status="generating")
        self._cache[input.id] = resource

        try:
            mdl_dict = orjson.loads(input.mdl)

            pipeline_input = {
                "user_prompt": input.user_prompt,
                "selected_models": input.selected_models,
                "mdl": mdl_dict,
            }

            resp = await self._pipelines["semantics_description"].run(**pipeline_input)

            resource.status = "finished"
            resource.response = resp.get("normalize")
            self._cache[input.id] = resource

        except orjson.JSONDecodeError as e:
            resource = self._handle_exception(
                input,
                f"Failed to parse MDL: {str(e)}",
                code="MDL_PARSE_ERROR",
            )
        except Exception as e:
            resource = self._handle_exception(
                input,
                f"An error occurred during semantics description generation: {str(e)}",
            )

        return resource

    def get_resource(self, id: str) -> Resource:
        resource = self._cache.get(id)

        if resource is None:
            message = f"Semantics Description Resource with ID '{id}' not found."
            logger.exception(message)
            return self.Resource(
                id=id,
                status="failed",
                error=self.Resource.Error(code="RESOURCE_NOT_FOUND", message=message),
            )

        return resource
