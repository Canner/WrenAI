import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_regeneration import (
    SQLRegenerationRequest,
    SQLRegenerationResponse,
    SQLRegenerationResultRequest,
    SQLRegenerationResultResponse,
)

router = APIRouter()

"""
SQL Regeneration Router

This router provides endpoints for initiating SQL regeneration operations and retrieving their results.

Endpoints:
1. POST /sql-regenerations
   - Initiates a new SQL regeneration operation.
   - Request body: SQLRegenerationRequest
     {
       "_query_id": null,                        # Optional unique identifier for tracking the query
       "description": "User's description",     # Description of the SQL query to regenerate
       "steps": [                                # List of steps in the SQL explanation
         {
           "summary": "Brief summary of SQL step",  # Summary of the SQL step
           "sql": "SELECT * FROM table",            # SQL query string
           "cte_name": "Common Table Expression",   # Name for the common table expression
           "corrections": []                         # List of user corrections if applicable
         }
       ],
       "mdl_hash": null,                         # Optional hash for model identification
       "thread_id": null,                        # Optional identifier for the processing thread
       "project_id": null,                       # Optional project identifier
     }
   - Response: SQLRegenerationResponse
     {
       "query_id": "unique-uuid"                 # Unique identifier for the generated regeneration request
     }

2. GET /sql-regenerations/{query_id}/result
   - Retrieves the status and result of a SQL regeneration operation.
   - Path parameter: query_id (str)             # Unique identifier for the SQL regeneration request
   - Response: SQLRegenerationResultResponse
     {
       "status": "understanding" | "generating" | "finished" | "failed",
       "response": {                             # Present only if status is "finished"
         "description": "Description of SQL operation",
         "steps": [                              # List of SQL steps generated
           {
             "summary": "Step summary",
             "sql": "Generated SQL query",
             "cte_name": "Generated CTE name",
             "corrections": []                    # User corrections if any
           }
         ]
       },
       "error": {                                # Present only if status is "failed"
         "code": "NO_RELEVANT_SQL" | "OTHERS",
         "message": "Error description"
       }
     }

The SQL regeneration process is handled asynchronously. The POST endpoint starts the regeneration and returns immediately with a unique query ID. The GET endpoint can be used to check the status and retrieve the results once processing is complete.

Usage:
1. Send a POST request to initiate the SQL regeneration process.
2. Use the returned query ID to poll the GET endpoint until the status is "finished" or "failed".

Note: The actual SQL generation occurs in the background using FastAPI's BackgroundTasks.
"""


@router.post("/sql-regenerations")
async def sql_regeneration(
    sql_regeneration_request: SQLRegenerationRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SQLRegenerationResponse:
    query_id = str(uuid.uuid4())
    sql_regeneration_request.query_id = query_id
    service_container.sql_regeneration_service._sql_regeneration_results[
        query_id
    ] = SQLRegenerationResultResponse(status="understanding")
    background_tasks.add_task(
        service_container.sql_regeneration_service.sql_regeneration,
        sql_regeneration_request,
        service_metadata=asdict(service_metadata),
    )
    return SQLRegenerationResponse(query_id=query_id)


@router.get("/sql-regenerations/{query_id}/result")
async def get_sql_regeneration_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SQLRegenerationResultResponse:
    return service_container.sql_regeneration_service.get_sql_regeneration_result(
        SQLRegenerationResultRequest(query_id=query_id)
    )
