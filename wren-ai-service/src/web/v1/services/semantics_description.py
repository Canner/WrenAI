import asyncio
import logging
from typing import Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import Configuration, MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class SemanticsDescription:
    class Input(BaseModel):
        id: str
        selected_models: list[str]
        user_prompt: str
        mdl: str
        configuration: Optional[Configuration] = Configuration()
        project_id: Optional[str] = None  # this is for tracing purpose

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

    def _chunking(
        self, mdl_dict: dict, request: Input, chunk_size: int = 50
    ) -> list[dict]:
        template = {
            "user_prompt": request.user_prompt,
            "language": request.configuration.language,
        }

        chunks = [
            {
                **model,
                "columns": model["columns"][i : i + chunk_size],
            }
            for model in mdl_dict["models"]
            if model["name"] in request.selected_models
            for i in range(0, len(model["columns"]), chunk_size)
        ]

        return [
            {
                **template,
                "mdl": {"models": [chunk]},
                "selected_models": [chunk["name"]],
            }
            for chunk in chunks
        ]

    async def _generate_task(self, request_id: str, chunk: dict):
        resp = await self._pipelines["semantics_description"].run(**chunk)
        normalize = resp.get("normalize")

        current = self[request_id]
        current.response = current.response or {}

        for key in normalize.keys():
            if key not in current.response:
                current.response[key] = normalize[key]
                continue

            current.response[key]["columns"].extend(normalize[key]["columns"])

    @observe(name="Generate Semantics Description")
    @trace_metadata
    async def generate(self, request: Input, **kwargs) -> Resource:
        logger.info("Generate Semantics Description pipeline is running...")

        try:
            mdl_dict = orjson.loads(request.mdl)

            chunks = self._chunking(mdl_dict, request)
            tasks = [self._generate_task(request.id, chunk) for chunk in chunks]

            await asyncio.gather(*tasks)

            self[request.id].status = "finished"
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
