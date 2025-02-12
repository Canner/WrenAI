import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


# POST /v1/chart-adjustments
class ChartAdjustmentOption(BaseModel):
    chart_type: Literal[
        "bar", "grouped_bar", "line", "pie", "stacked_bar", "area", "multi_line"
    ]
    x_axis: Optional[str] = None
    y_axis: Optional[str] = None
    x_offset: Optional[str] = None
    color: Optional[str] = None
    theta: Optional[str] = None


class ChartAdjustmentRequest(BaseModel):
    _query_id: str | None = None
    query: str
    sql: str
    adjustment_option: ChartAdjustmentOption
    chart_schema: dict
    project_id: Optional[str] = None
    thread_id: Optional[str] = None
    configurations: Optional[Configuration] = Configuration()

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class ChartAdjustmentResponse(BaseModel):
    query_id: str


# PATCH /v1/chart-adjustments/{query_id}
class StopChartAdjustmentRequest(BaseModel):
    _query_id: str | None = None
    status: Literal["stopped"]

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class StopChartAdjustmentResponse(BaseModel):
    query_id: str


# GET /v1/chart-adjustments/{query_id}/result
class ChartAdjustmentError(BaseModel):
    code: Literal["NO_CHART", "OTHERS"]
    message: str


class ChartAdjustmentResultRequest(BaseModel):
    query_id: str


class ChartAdjustmentResult(BaseModel):
    reasoning: str
    chart_type: Literal[
        "line", "bar", "pie", "grouped_bar", "stacked_bar", "area", "multi_line", ""
    ]  # empty string for no chart
    chart_schema: dict


class ChartAdjustmentResultResponse(BaseModel):
    status: Literal[
        "understanding", "fetching", "generating", "finished", "failed", "stopped"
    ]
    response: Optional[ChartAdjustmentResult] = None
    error: Optional[ChartAdjustmentError] = None


class ChartAdjustmentService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._chart_adjustment_results: Dict[
            str, ChartAdjustmentResultResponse
        ] = TTLCache(maxsize=maxsize, ttl=ttl)

    def _is_stopped(self, query_id: str):
        if (
            result := self._chart_adjustment_results.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    @observe(name="Adjust Chart")
    @trace_metadata
    async def chart_adjustment(
        self,
        chart_adjustment_request: ChartAdjustmentRequest,
        **kwargs,
    ):
        results = {
            "chart_adjustment_result": {},
            "metadata": {
                "error_type": "",
                "error_message": "",
            },
        }

        try:
            query_id = chart_adjustment_request.query_id

            self._chart_adjustment_results[query_id] = ChartAdjustmentResultResponse(
                status="fetching"
            )

            sql_data = (
                await self._pipelines["sql_executor"].run(
                    sql=chart_adjustment_request.sql,
                    project_id=chart_adjustment_request.project_id,
                )
            )["execute_sql"]["results"]

            self._chart_adjustment_results[query_id] = ChartAdjustmentResultResponse(
                status="generating"
            )

            chart_adjustment_result = await self._pipelines["chart_adjustment"].run(
                query=chart_adjustment_request.query,
                sql=chart_adjustment_request.sql,
                adjustment_option=chart_adjustment_request.adjustment_option,
                chart_schema=chart_adjustment_request.chart_schema,
                data=sql_data,
                language=chart_adjustment_request.configurations.language,
            )
            chart_result = chart_adjustment_result["post_process"]["results"]

            if not chart_result.get("chart_schema", {}) and not chart_result.get(
                "reasoning", ""
            ):
                self._chart_adjustment_results[
                    query_id
                ] = ChartAdjustmentResultResponse(
                    status="failed",
                    error=ChartAdjustmentError(
                        code="NO_CHART", message="chart generation failed"
                    ),
                )
                results["metadata"]["error_type"] = "NO_CHART"
                results["metadata"]["error_message"] = "chart generation failed"
            else:
                self._chart_adjustment_results[
                    query_id
                ] = ChartAdjustmentResultResponse(
                    status="finished",
                    response=ChartAdjustmentResult(**chart_result),
                )
                results["chart_adjustment_result"] = chart_result

            return results
        except Exception as e:
            logger.exception(f"chart adjustment pipeline - OTHERS: {e}")

            self._chart_adjustment_results[
                chart_adjustment_request.query_id
            ] = ChartAdjustmentResultResponse(
                status="failed",
                error=ChartAdjustmentError(
                    code="OTHERS",
                    message=str(e),
                ),
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            return results

    def stop_chart_adjustment(
        self,
        stop_chart_adjustment_request: StopChartAdjustmentRequest,
    ):
        self._chart_adjustment_results[
            stop_chart_adjustment_request.query_id
        ] = ChartAdjustmentResultResponse(
            status="stopped",
        )

    def get_chart_adjustment_result(
        self,
        chart_adjustment_result_request: ChartAdjustmentResultRequest,
    ) -> ChartAdjustmentResultResponse:
        if (
            result := self._chart_adjustment_results.get(
                chart_adjustment_result_request.query_id
            )
        ) is None:
            logger.exception(
                f"chart adjustment pipeline - OTHERS: {chart_adjustment_result_request.query_id} is not found"
            )
            return ChartAdjustmentResultResponse(
                status="failed",
                error=ChartAdjustmentError(
                    code="OTHERS",
                    message=f"{chart_adjustment_result_request.query_id} is not found",
                ),
            )

        return result
