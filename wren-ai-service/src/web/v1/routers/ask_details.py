import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.ask_details import (
    AskDetailsRequest,
    AskDetailsResponse,
    AskDetailsResultRequest,
    AskDetailsResultResponse,
)

router = APIRouter()

"""
Ask Details Router

This router manages endpoints for initiating and retrieving SQL query breakdown requests.

Endpoints:
1. POST /ask-details
   - Initiates the SQL query breakdown operation.
   - Request body: AskDetailsRequest
     {
       "query": "SELECT * FROM table;",        # SQL query to be analyzed
       "sql": "SELECT * FROM table;",           # Original SQL string
       "mdl_hash": "optional-hash",             # Optional model hash for reference
       "thread_id": "optional-thread-id",       # Optional thread identifier
       "project_id": "optional-project-id",     # Optional project identifier
     }
   - Response: AskDetailsResponse
     {
       "query_id": "unique-uuid"                # Unique identifier for the analysis request
     }

2. GET /ask-details/{query_id}/result
   - Retrieves the status and results of a specific SQL query breakdown.
   - Path parameter: query_id (str)
   - Response: AskDetailsResultResponse
     {
       "status": "understanding" | "searching" | "generating" | "finished" | "failed",
       "response": {                             # Present only if status is "finished"
         "description": "Detailed description of the SQL breakdown",
         "steps": [                              # List of SQL breakdown steps
           {
             "sql": "SELECT * FROM table;",      # SQL step
             "summary": "Summary of this step",  # Summary of this step
             "cte_name": "optional-cte-name"     # Optional CTE name
           }
         ]
       },
       "error": {                                # Present only if status is "failed"
         "code": "NO_RELEVANT_SQL" | "OTHERS",
         "message": "Description of the error"
       }
     }

The SQL query breakdown process is asynchronous. The POST endpoint starts the analysis and returns immediately with an ID. The GET endpoint can be used to check the status and retrieve results once they are available.

Usage:
1. Send a POST request to start the SQL analysis.
2. Use the returned query ID to poll the GET endpoint until the status indicates "finished" or "failed".

Note: The actual analysis is performed in the background using FastAPI's BackgroundTasks.
"""


@router.post("/ask-details")
async def ask_details(
    ask_details_request: AskDetailsRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> AskDetailsResponse:
    query_id = str(uuid.uuid4())
    ask_details_request.query_id = query_id
    service_container.ask_details_service._ask_details_results[
        query_id
    ] = AskDetailsResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        service_container.ask_details_service.ask_details,
        ask_details_request,
        service_metadata=asdict(service_metadata),
    )
    return AskDetailsResponse(query_id=query_id)


@router.get("/ask-details/{query_id}/result")
async def get_ask_details_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> AskDetailsResultResponse:
    return service_container.ask_details_service.get_ask_details_result(
        AskDetailsResultRequest(query_id=query_id)
    )
