import uuid
from dataclasses import asdict
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)

#added imports
from src.web.v1.services.ask import (
    AskRequest,
    AskResponse,
    AskResultRequest,
    AskResultResponse,
    StopAskRequest,
    StopAskResponse,
)

router = APIRouter()

"""Ask Router

This router handles the endpoints related to the ask functionality.

Endpoints:
- POST /asks: Initiates a new ask request
  Input: AskRequest
  Output: AskResponse
    {
        "query_id": "uuid-string"
    }

- PATCH /asks/{query_id}: Stops an ongoing ask request
  Input: StopAskRequest
  Output: StopAskResponse
    {
        "query_id": "uuid-string"
    }

- GET /asks/{query_id}/result: Retrieves the result of an ask request
  Input: query_id in path
  Output: AskResultResponse
    {
        "status": "string",
        "result": {
            // Result details (not specified in the provided code)
        }
    }

Usage:
1. To start a new ask request:
   POST /asks
   Request body: AskRequest

2. To stop an ongoing ask request:
   PATCH /asks/{query_id}
   Request body: StopAskRequest

3. To get the result of an ask request:
   GET /asks/{query_id}/result

The ask process is asynchronous. The POST request initiates the process and returns
a query_id. Use this query_id to check the status and retrieve the result using
the GET endpoint.

Request Models:
- AskRequest: Contains the necessary information to initiate an ask request
- StopAskRequest: Contains information to stop an ongoing ask request
- AskResultRequest: Contains the query_id to retrieve the ask result

Response Models:
- AskResponse: Contains the query_id of the initiated ask request
- StopAskResponse: Contains the query_id of the stopped ask request
- AskResultResponse: Contains the status and result of the ask request

Dependencies:
- ServiceContainer: Provides access to the ask service
- ServiceMetadata: Provides metadata for the service

Note:
- The initial status of a new ask request is set to "understanding".
- The actual processing of the ask request is performed in the background.
- The GET endpoint retrieves the current status and result of the ask request,
  which may change over time as the background task progresses.
"""

@router.post("/asks")
async def ask(
    ask_request: AskRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> AskResponse:
    query_id = str(uuid.uuid4())
    ask_request.query_id = query_id
    service_container.ask_service._ask_results[query_id] = AskResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        service_container.ask_service.ask,
        ask_request,
        service_metadata=asdict(service_metadata),
    )
    return AskResponse(query_id=query_id)

@router.patch("/asks/{query_id}")
async def stop_ask(
    query_id: str,
    stop_ask_request: StopAskRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StopAskResponse:
    stop_ask_request.query_id = query_id
    background_tasks.add_task(
        service_container.ask_service.stop_ask,
        stop_ask_request,
    )
    return StopAskResponse(query_id=query_id)


@router.get("/asks/{query_id}/result")
async def get_ask_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> AskResultResponse:
    return service_container.ask_service.get_ask_result(
        AskResultRequest(query_id=query_id)
    )


