import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.chart import (
    ChartRequest,
    ChartResponse,
    ChartResultRequest,
    ChartResultResponse,
    StopChartRequest,
    StopChartResponse,
)

router = APIRouter()


@router.post("/charts")
async def chart(
    chart_request: ChartRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> ChartResponse:
    query_id = str(uuid.uuid4())
    chart_request.query_id = query_id
    service_container.chart_service._chart_results[query_id] = ChartResultResponse(
        status="fetching",
    )

    background_tasks.add_task(
        service_container.chart_service.chart,
        chart_request,
        service_metadata=asdict(service_metadata),
    )
    return ChartResponse(query_id=query_id)


@router.patch("/charts/{query_id}")
async def stop_chart(
    query_id: str,
    stop_chart_request: StopChartRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StopChartResponse:
    stop_chart_request.query_id = query_id
    background_tasks.add_task(
        service_container.ask_service.stop_ask,
        stop_chart_request,
    )
    return StopChartResponse(query_id=query_id)


@router.get("/charts/{query_id}")
async def get_chart_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> ChartResultResponse:
    return service_container.chart_service.get_chart_result(
        ChartResultRequest(query_id=query_id)
    )
