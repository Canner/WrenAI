from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationRequest,
    SemanticsPreparationResponse,
    SemanticsPreparationStatusRequest,
    SemanticsPreparationStatusResponse,
)

router = APIRouter()


"""
Semantics Preparation Router

This router handles endpoints related to initiating and retrieving the status of semantics preparation processes.

Endpoints:
1. POST /semantics-preparations
   - Initiates the semantics preparation process asynchronously.
   - Request body: SemanticsPreparationRequest
     {
       "mdl": "model_data_string",                # String representing the model data to be indexed
       "mdl_hash": "unique_hash",                 # Unique identifier for the model (hash or ID)
       "project_id": "optional_project_id",       # Optional project identifier
       "user_id": "optional_user_id"              # Optional user identifier
     }
   - Response: SemanticsPreparationResponse
     {
       "mdl_hash": "unique_hash"                  # Unique identifier for tracking the preparation process
     }

2. GET /semantics-preparations/{mdl_hash}/status
   - Retrieves the current status of the semantics preparation for a given model.
   - Path parameter: mdl_hash (str)
   - Response: SemanticsPreparationStatusResponse
     {
       "status": "indexing" | "finished" | "failed",  # Current status of the preparation process
       "error": {                                    # Present only if status is "failed"
         "code": "OTHERS",
         "message": "Detailed error message"
       }
     }

The semantics preparation process involves indexing the model data and is performed asynchronously.
The POST endpoint starts the process and returns a unique identifier (`mdl_hash`),
which can be used to track the status of the preparation through the GET endpoint.

Usage:
1. Send a POST request to initiate the preparation process.
2. Use the `mdl_hash` returned by the POST request to check the preparation status via the GET endpoint.

Note: The preparation process is handled in the background using FastAPI's BackgroundTasks.
"""


@router.post("/semantics-preparations")
async def prepare_semantics(
    prepare_semantics_request: SemanticsPreparationRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SemanticsPreparationResponse:
    service_container.semantics_preparation_service._prepare_semantics_statuses[
        prepare_semantics_request.mdl_hash
    ] = SemanticsPreparationStatusResponse(
        status="indexing",
    )

    background_tasks.add_task(
        service_container.semantics_preparation_service.prepare_semantics,
        prepare_semantics_request,
        service_metadata=asdict(service_metadata),
    )
    return SemanticsPreparationResponse(mdl_hash=prepare_semantics_request.mdl_hash)


@router.get("/semantics-preparations/{mdl_hash}/status")
async def get_prepare_semantics_status(
    mdl_hash: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SemanticsPreparationStatusResponse:
    return service_container.semantics_preparation_service.get_prepare_semantics_status(
        SemanticsPreparationStatusRequest(mdl_hash=mdl_hash)
    )


@router.delete("/documents")
async def delete_documents(
    project_id: Optional[str] = None,
    service_container: ServiceContainer = Depends(get_service_container),
) -> None:
    await service_container.semantics_preparation_service.delete_documents(project_id)
