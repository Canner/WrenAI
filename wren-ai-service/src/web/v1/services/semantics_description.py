import asyncio
import logging
from typing import Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class SemanticsDescription:
    class Resource(BaseModel, MetadataTraceable):
        class Error(BaseModel):
            code: Literal["OTHERS", "MDL_PARSE_ERROR", "RESOURCE_NOT_FOUND"]
            message: str

        id: str
        status: Literal["generating", "finished", "failed"] = "generating"
        response: Optional[dict] = None
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
        self._cache: Dict[str, self.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)

    def _handle_exception(
        self,
        id: str,
        error_message: str,
        code: str = "OTHERS",
        trace_id: Optional[str] = None,
        request_from: Literal["ui", "api"] = "ui",
    ):
        self[id] = self.Resource(
            id=id,
            status="failed",
            error=self.Resource.Error(code=code, message=error_message),
            trace_id=trace_id,
            request_from=request_from,
        )
        logger.error(error_message)

    class GenerateRequest(BaseRequest):
        id: str
        selected_models: list[str]
        user_prompt: str
        mdl: str

    def _chunking(
        self, mdl_dict: dict, request: GenerateRequest, chunk_size: int = 50
    ) -> list[dict]:
        template = {
            "user_prompt": request.user_prompt,
            "language": request.configurations.language,
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
        output = resp.get("output")

        current = self[request_id]
        current.response = current.response or {}

        for key in output.keys():
            if key not in current.response:
                current.response[key] = output[key]
                continue

            current.response[key]["columns"].extend(output[key]["columns"])

    @observe(name="Generate Semantics Description")
    @trace_metadata
    async def generate(self, request: GenerateRequest, **kwargs) -> Resource:
        logger.info("Generate Semantics Description pipeline is running...")
        trace_id = kwargs.get("trace_id")

        try:
            mdl_dict = orjson.loads(request.mdl)

            chunks = self._chunking(mdl_dict, request)
            tasks = [self._generate_task(request.id, chunk) for chunk in chunks]

            await asyncio.gather(*tasks)

            self[request.id].status = "finished"
            self[request.id].trace_id = trace_id
            self[request.id].request_from = request.request_from
        except orjson.JSONDecodeError as e:
            self._handle_exception(
                request.id,
                f"Failed to parse MDL: {str(e)}",
                code="MDL_PARSE_ERROR",
                trace_id=trace_id,
                request_from=request.request_from,
            )
        except Exception as e:
            self._handle_exception(
                request.id,
                f"An error occurred during semantics description generation: {str(e)}",
                trace_id=trace_id,
                request_from=request.request_from,
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
