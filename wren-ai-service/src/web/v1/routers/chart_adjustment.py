import uuid
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services.chart_adjustment import (
    ChartAdjustmentRequest,
    ChartAdjustmentResponse,
    ChartAdjustmentResultRequest,
    ChartAdjustmentResultResponse,
    StopChartAdjustmentRequest,
    StopChartAdjustmentResponse,
)

router = APIRouter()


@router.post("/chart-adjustments")
async def chart_adjustment(
    chart_adjustment_request: ChartAdjustmentRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> ChartAdjustmentResponse:
    query_id = str(uuid.uuid4())
    chart_adjustment_request.query_id = query_id
    service_container.chart_adjustment_service._chart_adjustment_results[
        query_id
    ] = ChartAdjustmentResultResponse(
        status="fetching",
    )

    background_tasks.add_task(
        service_container.chart_adjustment_service.chart_adjustment,
        chart_adjustment_request,
        service_metadata=asdict(service_metadata),
    )
    return ChartAdjustmentResponse(query_id=query_id)


@router.patch("/chart-adjustments/{query_id}")
async def stop_chart_adjustment(
    query_id: str,
    stop_chart_adjustment_request: StopChartAdjustmentRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
) -> StopChartAdjustmentResponse:
    stop_chart_adjustment_request.query_id = query_id
    background_tasks.add_task(
        service_container.chart_adjustment_service.stop_chart_adjustment,
        stop_chart_adjustment_request,
    )
    return StopChartAdjustmentResponse(query_id=query_id)


@router.get("/chart-adjustments/{query_id}")
async def get_chart_adjustment_result(
    query_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> ChartAdjustmentResultResponse:
    return service_container.chart_adjustment_service.get_chart_adjustment_result(
        ChartAdjustmentResultRequest(query_id=query_id)
    )
