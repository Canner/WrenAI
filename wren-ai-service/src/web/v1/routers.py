import uuid
from typing import List

from fastapi import APIRouter, BackgroundTasks

import src.globals as container
from src.web.v1.services.ask import (
    AskRequest,
    AskResponse,
    AskResultRequest,
    AskResultResponse,
    SemanticsPreparationRequest,
    SemanticsPreparationResponse,
    SemanticsPreparationStatusRequest,
    SemanticsPreparationStatusResponse,
    StopAskRequest,
    StopAskResponse,
)
from src.web.v1.services.ask_details import (
    AskDetailsRequest,
    AskDetailsResponse,
    AskDetailsResultRequest,
    AskDetailsResultResponse,
)
from src.web.v1.services.semantics import (
    BulkGenerateDescriptionRequest,
    GenerateDescriptionResponse,
)
from src.web.v1.services.sql_explanation import (
    SQLExplanationRequest,
    SQLExplanationResponse,
    SQLExplanationResultRequest,
    SQLExplanationResultResponse,
)

router = APIRouter()


@router.post("/semantics-descriptions")
async def bulk_generate_description(
    bulk_request: BulkGenerateDescriptionRequest,
) -> List[GenerateDescriptionResponse]:
    return [
        container.SEMANTIC_SERVICE.generate_description(request)
        for request in bulk_request
    ]


@router.post("/semantics-preparations")
async def prepare_semantics(
    prepare_semantics_request: SemanticsPreparationRequest,
    background_tasks: BackgroundTasks,
) -> SemanticsPreparationResponse:
    container.ASK_SERVICE._prepare_semantics_statuses[
        prepare_semantics_request.id
    ] = SemanticsPreparationStatusResponse(
        status="indexing",
    )

    background_tasks.add_task(
        container.ASK_SERVICE.prepare_semantics,
        prepare_semantics_request,
    )
    return SemanticsPreparationResponse(id=prepare_semantics_request.id)


@router.get("/semantics-preparations/{task_id}/status")
async def get_prepare_semantics_status(
    task_id: str,
) -> SemanticsPreparationStatusResponse:
    return container.ASK_SERVICE.get_prepare_semantics_status(
        SemanticsPreparationStatusRequest(id=task_id)
    )


@router.post("/asks")
async def ask(
    ask_request: AskRequest,
    background_tasks: BackgroundTasks,
) -> AskResponse:
    query_id = str(uuid.uuid4())
    ask_request.query_id = query_id
    container.ASK_SERVICE._ask_results[query_id] = AskResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        container.ASK_SERVICE.ask,
        ask_request,
    )
    return AskResponse(query_id=query_id)


@router.patch("/asks/{query_id}")
async def stop_ask(
    query_id: str,
    stop_ask_request: StopAskRequest,
    background_tasks: BackgroundTasks,
) -> StopAskResponse:
    stop_ask_request.query_id = query_id
    background_tasks.add_task(
        container.ASK_SERVICE.stop_ask,
        stop_ask_request,
    )
    return StopAskResponse(query_id=query_id)


@router.get("/asks/{query_id}/result")
async def get_ask_result(query_id: str) -> AskResultResponse:
    return container.ASK_SERVICE.get_ask_result(AskResultRequest(query_id=query_id))


@router.post("/ask-details")
async def ask_details(
    ask_details_request: AskDetailsRequest,
    background_tasks: BackgroundTasks,
) -> AskDetailsResponse:
    query_id = str(uuid.uuid4())
    ask_details_request.query_id = query_id
    container.ASK_DETAILS_SERVICE._ask_details_results[
        query_id
    ] = AskDetailsResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        container.ASK_DETAILS_SERVICE.ask_details,
        ask_details_request,
    )
    return AskDetailsResponse(query_id=query_id)


@router.get("/ask-details/{query_id}/result")
async def get_ask_details_result(query_id: str) -> AskDetailsResultResponse:
    return container.ASK_DETAILS_SERVICE.get_ask_details_result(
        AskDetailsResultRequest(query_id=query_id)
    )


@router.post("/sql-explanations")
async def sql_explanation(
    sql_explanation_request: SQLExplanationRequest,
    background_tasks: BackgroundTasks,
) -> SQLExplanationResponse:
    query_id = str(uuid.uuid4())
    sql_explanation_request.query_id = query_id
    container.SQL_EXPLANATION_SERVICE.sql_explanation_results[
        query_id
    ] = SQLExplanationResultResponse(status="understanding")
    background_tasks.add_task(
        container.SQL_EXPLANATION_SERVICE.sql_explanation,
        sql_explanation_request,
    )
    return SQLExplanationResponse(query_id=query_id)


@router.get("/sql-explanations/{query_id}/result")
async def get_sql_explanation_result(
    query_id: str,
) -> SQLExplanationResultResponse:
    return container.SQL_EXPLANATION_SERVICE.get_sql_explanation_result(
        SQLExplanationResultRequest(query_id=query_id)
    )
