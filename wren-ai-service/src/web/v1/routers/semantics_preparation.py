from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

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

This router handles endpoints related to initiating and retrieving the status of semantics preparation processes, 
as well as deleting semantic data.

Endpoints:
1. POST /semantics-preparations
   - Initiates the semantics preparation process asynchronously.
   - Request body: SemanticsPreparationRequest
     {
       "mdl": "model_data_string",                # String representing the model data to be indexed
       "mdl_hash": "unique_hash",                 # Unique identifier for the model (hash or ID)
       "project_id": "optional_project_id",       # Optional project identifier
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

3. DELETE /semantics
   - Deletes semantic data for a specific project or all projects.
   - Query parameter: project_id (Optional[str]) 
      - If provided, deletes semantics only for that project.
      - If not provided, deletes all semantic data.
   - Response: HTTP 200 OK or HTTP 500 Internal Server Error if failed to delete semantics.

The semantics preparation process involves indexing the model data and is performed asynchronously.
The POST endpoint starts the process and returns a unique identifier (`mdl_hash`),
which can be used to track the status of the preparation through the GET endpoint.

Usage:
1. Send a POST request to initiate the preparation process.
2. Use the `mdl_hash` returned by the POST request to check the preparation status via the GET endpoint.
3. Use the DELETE endpoint to remove semantic data when no longer needed.

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


@router.delete("/semantics")
async def delete_semantics(
    project_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> None:
    if not project_id:
        raise HTTPException(status_code=400, detail="Project ID is required")
    await service_container.semantics_preparation_service.delete_semantics(project_id)
