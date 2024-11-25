import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_expansion import (
    SqlExpansionRequest,
    SqlExpansionResponse,
    SqlExpansionResultRequest,
    SqlExpansionResultResponse,
    StopSqlExpansionRequest,
    StopSqlExpansionResponse,
)

router = APIRouter()

"""
SQL Expansion Router

This router handles endpoints related to SQL expansion operations.

Endpoints:
1. POST /sql-expansions
   - Initiates an SQL expansion operation
   - Request body: SqlExpansionRequest
     {
       "query_id": "unique-query-id",           # Unique identifier for the query
       "query": "user's quest to modify sql result",
       "history": { ... },                       # Historical context for the query
       "project_id": "project-identifier",      # Identifier for the project
       "mdl_hash": "hash-of-model",              # Hash of the model (if applicable)
       "thread_id": "thread-identifier",        # Identifier for the thread (if applicable)
     }
   - Response: SqlExpansionResponse
     {
       "query_id": "unique-query-id"            # Unique identifier for the generated SQL expansion
     }

2. PATCH /sql-expansions/{query_id}
   - Stops an ongoing SQL expansion operation
   - Path parameter: query_id (str)
   - Request body: StopSqlExpansionRequest
     {
       "status": "stopped"                      # Status indicating the operation should be stopped
     }
   - Response: StopSqlExpansionResponse
     {
       "query_id": "unique-query-id"            # Unique identifier for the stopped operation
     }

3. GET /sql-expansions/{query_id}/result
   - Retrieves the result of an SQL expansion operation
   - Path parameter: query_id (str)
   - Response: SqlExpansionResultResponse
     {
       "status": "understanding" | "searching" | "generating" | "finished" | "failed" | "stopped",
       "response": {                             # Present only if status is "finished"
         "description": "Contextual summary of the expansion process.",
         "steps": [                              # List of generated SQL steps
           {
             "sql": "SELECT ...",                # Expanded SQL query
             "summary": "Summary of the SQL query.", # Summary of what the query does
             "cte_name": "Common Table Expression name if applicable"
           }
         ]
       },
       "error": {                                # Present only if status is "failed"
         "code": "OTHERS",
         "message": "Error description"
       }
     }

The SQL expansion process is asynchronous. The POST endpoint initiates the process and returns immediately with a query ID. The GET endpoint can be used to check the status and retrieve the result when it's ready.

Usage:
1. Send a POST request to start the SQL expansion process.
2. Use the returned query ID to poll the GET endpoint until the status is "finished" or "failed".

Note: The actual SQL expansion is performed in the background using FastAPI's BackgroundTasks.
"""


@router.post("/sql-expansions")
async def sql_expansion(
    sql_expansion_request: SqlExpansionRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SqlExpansionResponse:
    query_id = str(uuid.uuid4())
    sql_expansion_request.query_id = query_id
    service_container.sql_expansion_service._sql_expansion_results[
        query_id
    ] = SqlExpansionResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        service_container.sql_expansion_service.sql_expansion,
        sql_expansion_request,
        service_metadata=asdict(service_metadata),
    )
    return SqlExpansionResponse(query_id=query_id)


@router.patch("/sql-expansions/{query_id}")
async def stop_sql_expansion(
    query_id: str,
    stop_sql_expansion_request: StopSqlExpansionRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StopSqlExpansionResponse:
    stop_sql_expansion_request.query_id = query_id
    background_tasks.add_task(
        service_container.sql_expansion_service.stop_sql_expansion,
        stop_sql_expansion_request,
    )
    return StopSqlExpansionResponse(query_id=query_id)


@router.get("/sql-expansions/{query_id}/result")
async def get_sql_expansion_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SqlExpansionResultResponse:
    return service_container.sql_expansion_service.get_sql_expansion_result(
        SqlExpansionResultRequest(query_id=query_id)
    )
