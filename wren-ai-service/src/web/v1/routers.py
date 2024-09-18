import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
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
from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationRequest,
    SemanticsPreparationResponse,
    SemanticsPreparationStatusRequest,
    SemanticsPreparationStatusResponse,
)
from src.web.v1.services.sql_answer import (
    SqlAnswerRequest,
    SqlAnswerResponse,
    SqlAnswerResultRequest,
    SqlAnswerResultResponse,
)
from src.web.v1.services.sql_expansion import (
    SqlExpansionRequest,
    SqlExpansionResponse,
    SqlExpansionResultRequest,
    SqlExpansionResultResponse,
    StopSqlExpansionRequest,
    StopSqlExpansionResponse,
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
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SemanticsPreparationResponse:
    service_container.semantics_preparation_service._prepare_semantics_statuses[
        prepare_semantics_request.mdl_hash
    ] = SemanticsPreparationStatusResponse(
        status="indexing",
    )

    background_tasks.add_task(
        service_container.semantics_preparation_service.prepare_semantics,
        prepare_semantics_request,
        service_metadata=asdict(service_metadata),
    )
    return SemanticsPreparationResponse(mdl_hash=prepare_semantics_request.mdl_hash)


@router.get("/semantics-preparations/{mdl_hash}/status")
async def get_prepare_semantics_status(
    mdl_hash: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SemanticsPreparationStatusResponse:
    return service_container.semantics_preparation_service.get_prepare_semantics_status(
        SemanticsPreparationStatusRequest(mdl_hash=mdl_hash)
    )


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


@router.post("/sql-answers")
async def sql_answer(
    sql_answer_request: SqlAnswerRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> SqlAnswerResponse:
    query_id = str(uuid.uuid4())
    sql_answer_request.query_id = query_id
    service_container.sql_answer_service._sql_answer_results[
        query_id
    ] = SqlAnswerResultResponse(
        status="understanding",
    )

    background_tasks.add_task(
        service_container.sql_answer_service.sql_answer,
        sql_answer_request,
        service_metadata=asdict(service_metadata),
    )
    return SqlAnswerResponse(query_id=query_id)


@router.get("/sql-answers/{query_id}/result")
async def get_sql_answer_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> SqlAnswerResultResponse:
    return service_container.sql_answer_service.get_sql_answer_result(
        SqlAnswerResultRequest(query_id=query_id)
    )


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
