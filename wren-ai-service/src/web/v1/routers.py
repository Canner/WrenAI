import uuid

from fastapi import APIRouter, BackgroundTasks

import src.globals as container
from src.web.v1.services.ask import (
    AskRequest,
    AskResponse,
    AskResultRequest,
    AskResultResponse,
    StopAskRequest,
    StopAskResponse,
)
from src.web.v1.services.ask_details import (
    AskDetailsRequest,
    AskDetailsResponse,
    AskDetailsResultRequest,
    AskDetailsResultResponse,
)
from src.web.v1.services.indexing import (
    SemanticsPreparationRequest,
    SemanticsPreparationResponse,
    SemanticsPreparationStatusRequest,
    SemanticsPreparationStatusResponse,
)
from src.web.v1.services.sql_explanation import (
    SQLExplanationRequest,
    SQLExplanationResponse,
    SQLExplanationResultRequest,
    SQLExplanationResultResponse,
)
from src.web.v1.services.sql_regeneration import (
    SQLRegenerationRequest,
    SQLRegenerationResponse,
    SQLRegenerationResultRequest,
    SQLRegenerationResultResponse,
)

router = APIRouter()


@router.post("/semantics-preparations")
async def prepare_semantics(
    prepare_semantics_request: SemanticsPreparationRequest,
    background_tasks: BackgroundTasks,
) -> SemanticsPreparationResponse:
    container.INDEXING_SERVICE._prepare_semantics_statuses[
        prepare_semantics_request.mdl_hash
    ] = SemanticsPreparationStatusResponse(
        status="indexing",
    )

    background_tasks.add_task(
        container.INDEXING_SERVICE.prepare_semantics,
        prepare_semantics_request,
    )
    return SemanticsPreparationResponse(mdl_hash=prepare_semantics_request.mdl_hash)


@router.get("/semantics-preparations/{mdl_hash}/status")
async def get_prepare_semantics_status(
    mdl_hash: str,
) -> SemanticsPreparationStatusResponse:
    return container.INDEXING_SERVICE.get_prepare_semantics_status(
        SemanticsPreparationStatusRequest(mdl_hash=mdl_hash)
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


@router.post("/sql-regenerations")
async def sql_regeneration(
    sql_regeneration_request: SQLRegenerationRequest,
    background_tasks: BackgroundTasks,
) -> SQLRegenerationResponse:
    query_id = str(uuid.uuid4())
    sql_regeneration_request.query_id = query_id
    container.SQL_REGENERATION_SERVICE.sql_regeneration_results[
        query_id
    ] = SQLRegenerationResultResponse(status="understanding")
    background_tasks.add_task(
        container.SQL_REGENERATION_SERVICE.sql_regeneration,
        sql_regeneration_request,
    )
    return SQLRegenerationResponse(query_id=query_id)


@router.get("/sql-regenerations/{query_id}/result")
async def get_sql_regeneration_result(
    query_id: str,
) -> SQLRegenerationResultResponse:
    return container.SQL_REGENERATION_SERVICE.get_sql_regeneration_result(
        SQLRegenerationResultRequest(query_id=query_id)
    )
