import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.sql_question import (
    SqlQuestionRequest,
    SqlQuestionResponse,
    SqlQuestionResultRequest,
    SqlQuestionResultResponse,
)

router = APIRouter()

"""
SQL Questions Router

This router handles SQL question-related endpoints:

POST /sql-questions
    Accepts a SQL query and initiates asynchronous processing
    Returns a query ID for tracking the request

GET /sql-questions/{query_id}
    Retrieves the processing status and results for a given query ID
    Returns the current status (generating/succeeded/failed), questions, and any error details
"""


@router.post("/sql-questions")
async def sql_question(
    sql_question_request: SqlQuestionRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SqlQuestionResponse:
    """
    Initiate an asynchronous SQL question processing workflow with unique query tracking.
    
    Generates a unique query ID, initializes the processing status, and schedules background task for SQL question generation.
    
    Parameters:
        sql_question_request (SqlQuestionRequest): The incoming SQL question request to be processed
        background_tasks (BackgroundTasks): FastAPI background task manager for async processing
        service_container (ServiceContainer, optional): Container holding service dependencies
        service_metadata (ServiceMetadata, optional): Metadata associated with the service request
    
    Returns:
        SqlQuestionResponse: Response containing the generated unique query ID for tracking processing status
    
    Side Effects:
        - Stores initial processing status in service container
        - Adds background task for SQL question generation
    """
    query_id = str(uuid.uuid4())
    sql_question_request.query_id = query_id
    service_container.sql_question_service._sql_question_results[
        query_id
    ] = SqlQuestionResultResponse(
        status="generating",
    )

    background_tasks.add_task(
        service_container.sql_question_service.sql_question,
        sql_question_request,
        service_metadata=asdict(service_metadata),
    )
    return SqlQuestionResponse(query_id=query_id)


@router.get("/sql-questions/{query_id}")
async def get_sql_question_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SqlQuestionResultResponse:
    """
    Retrieve the processing status and results for a specific SQL question query.
    
    This asynchronous method fetches the current state and results of a SQL question processing task identified by a unique query ID.
    
    Parameters:
        query_id (str): A unique identifier for the SQL question query previously submitted.
        service_container (ServiceContainer, optional): Dependency-injected service container for accessing SQL question services. Defaults to the result of get_service_container().
    
    Returns:
        SqlQuestionResultResponse: A response object containing the current processing status, generated questions, or any error details associated with the query.
    
    Raises:
        Potential service-level exceptions if the query cannot be retrieved or processed.
    """
    return service_container.sql_question_service.get_sql_question_result(
        SqlQuestionResultRequest(query_id=query_id)
    )
