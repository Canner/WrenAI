import logging
from typing import Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata

logger = logging.getLogger("wren-ai-service")


class QuestionRecommendation:
    class Input(BaseModel):
        id: str
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
        self._cache: Dict[str, QuestionRecommendation.Resource] = TTLCache(
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

    @observe(name="Generate Question Recommendation")
    @trace_metadata
    async def recommend(self, request: Input, **kwargs) -> Resource:
        logger.info("Generate Question Recommendation pipeline is running...")

        try:
            mdl_dict = orjson.loads(request.mdl)

            input = {
                "mdl": mdl_dict,
            }

            resp = await self._pipelines["question_recommendation"].run(**input)

            # todo: validate the question can be answered by the ask pipeline

            self._cache[request.id] = self.Resource(
                id=request.id, status="finished", response=resp.get("normalized")
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
                f"An error occurred during question recommendation generation: {str(e)}",
            )

        return self._cache[request.id]

    def __getitem__(self, id: str) -> Resource:
        response = self._cache.get(id)

        if response is None:
            message = f"Question Recommendation Resource with ID '{id}' not found."
            logger.exception(message)
            return self.Resource(
                id=id,
                status="failed",
                error=self.Resource.Error(code="RESOURCE_NOT_FOUND", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Resource):
        self._cache[id] = value
