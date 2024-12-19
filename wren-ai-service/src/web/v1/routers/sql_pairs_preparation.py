import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_pairs_preparation import (
    DeleteSqlPairsRequest,
    DeleteSqlPairsResponse,
    SqlPairsPreparationRequest,
    SqlPairsPreparationResponse,
    SqlPairsPreparationStatusRequest,
    SqlPairsPreparationStatusResponse,
)

router = APIRouter()


"""
Sql Pairs Preparation Router

This router manages the endpoints related to users uploading SQL pairs and retrieving their status.

Endpoints:
1. **POST /sql-pairs**
   - Initiates the preparation of SQL pairs for processing.
   - **Request Body**: SqlPairsPreparationRequest
     - `sql_pairs`: List of SQL pairs, each containing:
       - `sql`: The SQL statement
       - `id`: Unique identifier for the SQL pair
     - `project_id`: (Optional) Identifier for the project context
   - **Response**: SqlPairsPreparationResponse
     - `sql_pairs_preparation_id`: A unique identifier (UUID) for tracking the preparation process

2. **DELETE /sql-pairs**
   - Deletes specified SQL pairs.
   - **Request Body**: DeleteSqlPairsRequest
     - `ids`: List of SQL pair IDs to delete
     - `project_id`: (Optional) Project identifier
   - **Response**: DeleteSqlPairsResponse
     - `sql_pairs_preparation_id`: A unique identifier (UUID) for tracking the deletion process

3. **GET /sql-pairs/{sql_pairs_preparation_id}**
   - Retrieves the current status of a SQL pairs preparation or deletion process.
   - **Path Parameter**:
     - `sql_pairs_preparation_id`: The unique identifier of the process
   - **Response**: SqlPairsPreparationStatusResponse
     - `status`: Current status ("indexing", "deleting", "finished", or "failed")
     - `error`: (Optional) Error information if the process failed, including:
       - `code`: Error code ("OTHERS")
       - `message`: Detailed error message

Process:
1. Submit SQL pairs using the POST endpoint to initiate preparation. This returns a preparation ID.
2. Use the DELETE endpoint to remove specific SQL pairs from the system.
3. Track the status of any operation using the GET endpoint with the preparation ID.

Note: All operations are processed asynchronously using background tasks. The status can be polled 
via the GET endpoint. Results are cached with a TTL of 120 seconds.
"""


@router.post("/sql-pairs")
async def prepare_sql_pairs(
    prepare_sql_pairs_request: SqlPairsPreparationRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SqlPairsPreparationResponse:
    id = str(uuid.uuid4())
    prepare_sql_pairs_request.query_id = id
    service_container.sql_pairs_preparation_service._prepare_sql_pairs_statuses[
        id
    ] = SqlPairsPreparationStatusResponse(
        status="indexing",
    )

    background_tasks.add_task(
        service_container.sql_pairs_preparation_service.prepare_sql_pairs,
        prepare_sql_pairs_request,
        service_metadata=asdict(service_metadata),
    )
    return SqlPairsPreparationResponse(sql_pairs_preparation_id=id)


@router.delete("/sql-pairs")
async def delete_sql_pairs(
    delete_sql_pairs_request: DeleteSqlPairsRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> DeleteSqlPairsResponse:
    id = str(uuid.uuid4())
    delete_sql_pairs_request.query_id = id
    service_container.sql_pairs_preparation_service._prepare_sql_pairs_statuses[
        id
    ] = SqlPairsPreparationStatusResponse(
        status="deleting",
    )

    background_tasks.add_task(
        service_container.sql_pairs_preparation_service.delete_sql_pairs,
        delete_sql_pairs_request,
        service_metadata=asdict(service_metadata),
    )
    return DeleteSqlPairsResponse(sql_pairs_preparation_id=id)


@router.get("/sql-pairs/{sql_pairs_preparation_id}")
async def get_sql_pairs_preparation_status(
    sql_pairs_preparation_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SqlPairsPreparationStatusResponse:
    return service_container.sql_pairs_preparation_service.get_prepare_sql_pairs_status(
        SqlPairsPreparationStatusRequest(
            sql_pairs_preparation_id=sql_pairs_preparation_id
        )
    )
