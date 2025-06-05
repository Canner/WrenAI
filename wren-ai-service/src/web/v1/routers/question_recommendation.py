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
from src.web.v1.services import Configuration, QuestionRecommendation

router = APIRouter()

"""
Question Recommendation Router

This router handles endpoints related to generating and retrieving question recommendations.

Endpoints:
1. POST /question-recommendations
   - Generates new question recommendations
   - Request body: PostRequest
     {
       "mdl": "{ ... }",                                 # JSON string of the MDL (Model Definition Language)
       "previous_questions": ["question1", "question2"], # Optional list of previous questions
       "project_id": "project-id",                       # Optional project ID
       "max_questions": 5,                               # Optional max number of questions to generate, defaults to 5
       "max_categories": 3,                              # Optional max number of categories, defaults to 3
       "regenerate": false,                              # Optional flag to force regeneration, defaults to false
       "configuration": {                                # Optional configuration settings
         "language": "English",                          # Optional language, defaults to "English"
         "timezone": {                                   # Optional timezone settings
           "name": "Asia/Taipei",                        # Timezone name, defaults to "Asia/Taipei"
         }
       }
     }
   - Response: PostResponse
     {
       "id": "unique-uuid"                               # Unique identifier for the generated recommendations
     }

2. GET /question-recommendations/{id}
   - Retrieves the status and result of question recommendations generation
   - Path parameter: id (str)
   - Response: GetResponse
     {
       "id": "unique-uuid",                      # Unique identifier of the recommendations
       "status": "generating" | "finished" | "failed",
       "response": {                             # Present only if status is "finished"
         "questions": [...]                      # List of question recommendations
       },
       "error": {                                # Present only if status is "failed"
         "code": "OTHERS" | "MDL_PARSE_ERROR" | "RESOURCE_NOT_FOUND",
         "message": "Error description"
       }
     }

The question recommendation generation is an asynchronous process. The POST endpoint
initiates the generation and returns immediately with an ID. The GET endpoint can
then be used to check the status and retrieve the result when it's ready.

Usage:
1. Send a POST request to start the generation process.
2. Use the returned ID to poll the GET endpoint until the status is "finished" or "failed".

Note: The actual generation is performed in the background using FastAPI's BackgroundTasks.
"""


class PostRequest(BaseModel):
    mdl: str
    previous_questions: list[str] = []
    project_id: Optional[str] = None
    max_questions: int = 5
    max_categories: int = 3
    regenerate: bool = False
    configuration: Configuration = Configuration()


class PostResponse(BaseModel):
    id: str


@router.post(
    "/question-recommendations",
    response_model=PostResponse,
)
async def recommend(
    request: PostRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    event_id = str(uuid.uuid4())
    service = service_container.question_recommendation
    service[event_id] = QuestionRecommendation.Event(event_id=event_id)

    _request = QuestionRecommendation.Request(event_id=event_id, **request.model_dump())

    background_tasks.add_task(
        service.recommend,
        _request,
        service_metadata=asdict(service_metadata),
    )

    return PostResponse(id=event_id)


class GetResponse(BaseModel):
    id: str
    status: Literal["generating", "finished", "failed"]
    response: Optional[dict]
    error: Optional[dict]
    trace_id: Optional[str] = None


@router.get(
    "/question-recommendations/{event_id}",
    response_model=GetResponse,
)
async def get(
    event_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    event: QuestionRecommendation.Event = service_container.question_recommendation[
        event_id
    ]

    def _formatter(response: dict) -> dict:
        questions = [
            question
            for _, questions in response["questions"].items()
            for question in questions
        ]
        return {"questions": questions}

    return GetResponse(
        id=event.event_id,
        status=event.status,
        response=_formatter(event.response),
        error=event.error and event.error.model_dump(),
        trace_id=event.trace_id,
    )
