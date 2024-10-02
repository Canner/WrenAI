import logging
import uuid
from dataclasses import asdict
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from fastapi import APIRouter, BackgroundTasks, Depends
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
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
           "status": "generating"  # Initial status
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
        mdl: str

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
        self._cache: Dict[str, SemanticsDescription.Response] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    @observe(name="Generate Semantics Description")
    @trace_metadata
    async def generate(self, request: Request, **kwargs) -> Response:
        logger.info("Generate Semantics Description pipeline is running...")
        # todo: implement the service flow
        pass

    def get(self, request: Request) -> Response:
        response = self._cache.get(request.id)

        if response is None:
            # todo: error handling
            logger.error(
                f"Semantics Description Resource with ID '{request.id}' not found."
            )
            return self.Response()

        return response


router = APIRouter()


@router.post("/v1/semantics-descriptions", response_model=SemanticsDescription.Response)
async def generate(
    request: SemanticsDescription.Request,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SemanticsDescription.Response:
    id = str(uuid.uuid4())
    request.id = id
    service = service_container.semantics_description

    # todo: consider to simplify the code by using the service_container
    service._cache[request.id] = SemanticsDescription.Response(id=id)

    background_tasks.add_task(
        service.generate, request, service_metadata=asdict(service_metadata)
    )
    return service._cache[request.id]


@router.get(
    "/v1/semantics-descriptions/{id}",
    response_model=SemanticsDescription.Response,
)
async def get(
    id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SemanticsDescription.Response:
    return service_container.semantics_description.get(
        SemanticsDescription.Request(id=id)
    )
