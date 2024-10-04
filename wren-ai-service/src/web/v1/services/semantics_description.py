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
    """
    SemanticsDescription Service

    This service provides endpoints for generating and optimizing semantic descriptions
    based on user prompts and selected models.

    Endpoints:
    1. POST /v1/semantics-descriptions
       Generate a new semantic description.

       Request body:
       {
           "selected_models": ["model1", "model2"],  # List of selected model names
           "user_prompt": "Describe the data model",  # User's prompt for description
           "mdl": "..."  # MDL (Model Definition Language) string
       }

       Response:
       {
           "id": "unique_id",  # Unique identifier for the generated description
       }

    2. GET /v1/semantics-descriptions/{id}
       Retrieve the status and result of a semantic description generation.

       Path parameter:
       - id: Unique identifier of the semantic description resource.

       Response:
       {
           "id": "unique_id",
           "status": "finished",  # Can be "generating", "finished", or "failed"
           "response": {  # Present only if status is "finished"
               // Generated semantic description
           },
           "error": {  # Present only if status is "failed"
               "code": "OTHERS",
               "message": "Error description"
           }
       }

    Usage:
    1. Call the POST endpoint to initiate a semantic description generation.
    2. Use the returned ID to poll the GET endpoint until the status is "finished" or "failed".
    3. Once finished, retrieve the generated description from the "response" field.

    Note: The generation process may take some time, so implement appropriate polling
    intervals when checking the status.
    """

    class Request(BaseModel):
        _id: str | None = None
        selected_models: list[str] = []
        user_prompt: str = ""
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
        status: Literal["generating", "finished", "failed"] = None
        response: Optional[dict] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, SemanticsDescription.Response] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    def _handle_exception(self, request: Request, error_message: str):
        self._cache[request.id] = self.Response(
            id=request.id,
            status="failed",
            error=self.Response.Error(code="OTHERS", message=error_message),
        )
        logger.error(error_message)

    @observe(name="Generate Semantics Description")
    @trace_metadata
    async def generate(self, request: Request, **kwargs) -> Response:
        logger.info("Generate Semantics Description pipeline is running...")

        try:
            if request.mdl is None:
                raise ValueError("MDL must be provided")

            mdl_dict = orjson.loads(request.mdl)

            input = {
                "user_prompt": request.user_prompt,
                "selected_models": request.selected_models,
                "mdl": mdl_dict,
            }

            resp = await self._pipelines["semantics_description"].run(**input)

            self._cache[request.id] = self.Response(
                id=request.id, status="finished", response=resp.get("normalize")
            )
        except orjson.JSONDecodeError as e:
            self._handle_exception(request, f"Failed to parse MDL: {str(e)}")
        except Exception as e:
            self._handle_exception(
                request,
                f"An error occurred during semantics description generation: {str(e)}",
            )

        return self._cache[request.id]

    def __getitem__(self, request: Request) -> Response:
        response = self._cache.get(request.id)

        if response is None:
            message = (
                f"Semantics Description Resource with ID '{request.id}' not found."
            )
            logger.exception(message)
            return self.Response(
                id=request.id,
                status="failed",
                error=self.Response.Error(code="OTHERS", message=message),
            )

        return response

    def __setitem__(self, request: Request, value: Response):
        self._cache[request.id] = value
