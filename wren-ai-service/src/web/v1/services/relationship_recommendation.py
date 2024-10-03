import logging
from typing import Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata

logger = logging.getLogger("wren-ai-service")


class RelationshipRecommendation:
    """
    RelationshipRecommendation Service

    This service provides endpoints for generating and retrieving relationship recommendations
    based on data models.

    Endpoints:
    1. POST /v1/relationship-recommendations
        Generate new relationship recommendations.

        Request body:
        {
            "mdl": "..."  # MDL (Model Definition Language) string
        }

        Response:
        {
            "id": "unique_id",  # Unique identifier for the generated recommendations
            "status": "generating"  # Initial status
        }

    2. GET /v1/relationship-recommendations/{id}
        Retrieve the status and result of relationship recommendations generation.

        Path parameter:
        - id: Unique identifier of the relationship recommendations resource.

        Response:
        {
            "id": "unique_id",
            "status": "finished",  # Can be "generating", "finished", or "failed"
            "response": {  # Present only if status is "finished"
                // Generated relationship recommendations
            },
            "error": {  # Present only if status is "failed"
                "code": "OTHERS",
                "message": "Error description"
            }
        }

    Usage:
    1. Call the POST endpoint to initiate relationship recommendations generation.
    2. Use the returned ID to poll the GET endpoint until the status is "finished" or "failed".
    3. Once finished, retrieve the generated recommendations from the "response" field.

    Note: The generation process may take some time, so implement appropriate polling
    intervals when checking the status.
    """

    class Request(BaseModel):
        _id: str | None = None
        mdl: str | None = None

        @property
        def id(self) -> str:
            return self._id

        @id.setter
        def id(self, id: str):
            self._id = id

    class Response(BaseModel):
        class Error(BaseModel):
            code: Literal["OTHERS"]
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
        self._cache: Dict[str, RelationshipRecommendation.Response] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    def _handle_exception(self, request: Request, error_message: str):
        self._cache[request.id] = self.Response(
            id=request.id,
            status="failed",
            error=self.Response.Error(code="OTHERS", message=error_message),
        )
        logger.error(error_message)

    @observe(name="Generate Relationship Recommendation")
    @trace_metadata
    async def recommend(self, request: Request, **kwargs) -> Response:
        logger.info("Generate Relationship Recommendation pipeline is running...")

        try:
            if request.mdl is None:
                raise ValueError("MDL must be provided")

            mdl_dict = orjson.loads(request.mdl)

            input = {
                "mdl": mdl_dict,
            }

            resp = await self._pipelines["relationship_recommendation"].run(**input)

            self._cache[request.id] = self.Response(
                id=request.id, status="finished", response=resp.get("recommendations")
            )
        except orjson.JSONDecodeError as e:
            self._handle_exception(request, f"Failed to parse MDL: {str(e)}")
        except Exception as e:
            self._handle_exception(
                request,
                f"An error occurred during relationship recommendation generation: {str(e)}",
            )

        return self._cache[request.id]

    def __getitem__(self, request: Request) -> Response:
        response = self._cache.get(request.id)

        if response is None:
            message = f"Relationship Recommendation Resource with ID '{request.id}' not found."
            logger.exception(message)
            return self.Response(
                id=request.id,
                status="failed",
                error=self.Response.Error(code="OTHERS", message=message),
            )

        return response

    def __setitem__(self, request: Request, value: Response):
        self._cache[request.id] = value
