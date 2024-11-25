import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_explanation import (
    SQLExplanationRequest,
    SQLExplanationResponse,
    SQLExplanationResultRequest,
    SQLExplanationResultResponse,
)

router = APIRouter()

"""
SQL Explanations Router

This router handles endpoints related to generating and retrieving SQL explanations.

Endpoints:
1. POST /sql-explanations
   - Initiates a new SQL explanation request.
   - Request body: SQLExplanationRequest
     {
       "question": "What does this SQL query do?",            # User's question regarding the SQL query
       "steps_with_analysis_results": [                       # List of analysis results for each step in the SQL query
         {
           "sql": "SELECT * FROM table",                     # The SQL statement being analyzed
           "summary": "Retrieves all records from the table.", # A brief summary of the SQL statement
           "sql_analysis_results": []                          # Analysis results for the SQL statement
         }
       ],
       "mdl_hash": "hash_value",                             # Optional hash for the model used
       "thread_id": "thread-123",                            # Optional identifier for the thread
       "project_id": "project-456",                          # Optional identifier for the project
     }
   - Response: SQLExplanationResponse
     {
       "query_id": "unique-uuid"                             # Unique identifier for the SQL explanation request
     }

2. GET /sql-explanations/{query_id}/result
   - Retrieves the status and result of an SQL explanation request.
   - Path parameter: query_id (str)
   - Response: SQLExplanationResultResponse
     {
       "status": "understanding" | "generating" | "finished" | "failed",  # Current status of the SQL explanation
       "response": [                                                     # Present only if status is "finished"
         [
           {
             "column_name": "col1",
             "description": "Unique identifier for each record in the example model."
           }
         ]
       ],
       "error": {                                                       # Present only if status is "failed"
         "code": "OTHERS",
         "message": "Error description"
       }
     }

The SQL explanation generation is an asynchronous process. The POST endpoint initiates the explanation process and returns immediately with a query ID. The GET endpoint can then be used to check the status and retrieve the result when it’s ready.
"""


@router.post("/sql-explanations")
async def sql_explanation(
    sql_explanation_request: SQLExplanationRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SQLExplanationResponse:
    query_id = str(uuid.uuid4())
    sql_explanation_request.query_id = query_id
    service_container.sql_explanation_service._sql_explanation_results[
        query_id
    ] = SQLExplanationResultResponse(status="understanding")
    background_tasks.add_task(
        service_container.sql_explanation_service.sql_explanation,
        sql_explanation_request,
        service_metadata=asdict(service_metadata),
    )
    return SQLExplanationResponse(query_id=query_id)


@router.get("/sql-explanations/{query_id}/result")
async def get_sql_explanation_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SQLExplanationResultResponse:
    return service_container.sql_explanation_service.get_sql_explanation_result(
        SQLExplanationResultRequest(query_id=query_id)
    )
