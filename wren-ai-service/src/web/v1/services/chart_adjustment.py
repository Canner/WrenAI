import logging
from typing import Any, Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel, Field

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
    adjustment_command: str
    data: Optional[Dict[str, Any]] = None
    image_url: Optional[str] = None
    chart_schema: dict
    project_id: Optional[str] = None
    thread_id: Optional[str] = None
    configurations: Configuration = Field(default_factory=Configuration)
    remove_data_from_chart_schema: bool = True
    adjustment_option: ChartAdjustmentOption | None = None  # deprecated

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
    chart_type: str = ""
    chart_schema: dict


class ChartAdjustmentResultResponse(BaseModel):
    status: Literal["fetching", "generating", "finished", "failed", "stopped"]
    response: Optional[ChartAdjustmentResult] = None
    error: Optional[ChartAdjustmentError] = None
    trace_id: Optional[str] = None


class ChartAdjustmentService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        allow_chart_validation: bool = False,
        max_chart_correction_retries: int = 3,
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._chart_adjustment_results: Dict[
            str, ChartAdjustmentResultResponse
        ] = TTLCache(maxsize=maxsize, ttl=ttl)
        self._allow_chart_validation = allow_chart_validation
        self._max_chart_correction_retries = max_chart_correction_retries

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
        trace_id = kwargs.get("trace_id")
        results = {
            "chart_adjustment_result": {},
            "metadata": {
                "error_type": "",
                "error_message": "",
            },
        }

        try:
            data_provided = False
            query_id = chart_adjustment_request.query_id
            remove_data_from_chart_schema = (
                chart_adjustment_request.remove_data_from_chart_schema
            )
            allow_chart_validation = self._allow_chart_validation
            max_chart_correction_retries = self._max_chart_correction_retries
            current_chart_correction_retries = 0

            self._chart_adjustment_results[query_id] = ChartAdjustmentResultResponse(
                status="fetching",
                trace_id=trace_id,
            )

            if not chart_adjustment_request.data:
                sql_data = (
                    await self._pipelines["sql_executor"].run(
                        sql=chart_adjustment_request.sql,
                        project_id=chart_adjustment_request.project_id,
                    )
                )["execute_sql"]["results"]
            else:
                sql_data = chart_adjustment_request.data
                data_provided = True

            self._chart_adjustment_results[query_id] = ChartAdjustmentResultResponse(
                status="generating",
                trace_id=trace_id,
            )

            chart_adjustment_result = await self._pipelines["chart_adjustment"].run(
                query=chart_adjustment_request.query,
                sql=chart_adjustment_request.sql,
                adjustment_command=chart_adjustment_request.adjustment_command,
                chart_schema=chart_adjustment_request.chart_schema,
                data=sql_data,
                language=chart_adjustment_request.configurations.language,
                data_provided=data_provided,
                image_url=chart_adjustment_request.image_url,
            )
            chart_result = chart_adjustment_result["post_process"]["results"]
            chart_schema = chart_result.get("chart_schema", {})
            reasoning = chart_result.get("reasoning", "")

            if not chart_schema and not reasoning:
                self._chart_adjustment_results[
                    query_id
                ] = ChartAdjustmentResultResponse(
                    status="failed",
                    error=ChartAdjustmentError(
                        code="NO_CHART", message="chart generation failed"
                    ),
                    trace_id=trace_id,
                )
                results["metadata"]["error_type"] = "NO_CHART"
                results["metadata"]["error_message"] = "chart generation failed"
            elif allow_chart_validation:
                while current_chart_correction_retries <= max_chart_correction_retries:
                    chart_validation_result = await self._pipelines[
                        "chart_validation"
                    ].run(
                        chart_schema=chart_schema,
                    )

                    if chart_validation_result.get("valid", True):
                        if remove_data_from_chart_schema:
                            chart_result["chart_schema"]["data"]["values"] = []

                        self._chart_adjustment_results[
                            query_id
                        ] = ChartAdjustmentResultResponse(
                            status="finished",
                            response=ChartAdjustmentResult(**chart_result),
                            trace_id=trace_id,
                        )
                        results["chart_adjustment_result"] = chart_result
                        break
                    elif (
                        current_chart_correction_retries == max_chart_correction_retries
                    ):
                        self._chart_adjustment_results[
                            query_id
                        ] = ChartAdjustmentResultResponse(
                            status="failed",
                            error=ChartAdjustmentError(
                                code="NO_CHART", message="chart generation failed"
                            ),
                            trace_id=trace_id,
                        )
                        results["metadata"]["error_type"] = "NO_CHART"
                        results["metadata"]["error_message"] = "chart generation failed"
                        break
                    else:
                        current_chart_correction_retries += 1
                        chart_correction_result = await self._pipelines[
                            "chart_correction"
                        ].run(
                            query=chart_adjustment_request.query,
                            sql=chart_adjustment_request.sql,
                            chart_schema=chart_schema,
                        )
                        chart_result = chart_correction_result["post_process"][
                            "results"
                        ]
                        chart_schema = chart_result.get("chart_schema", {})
            else:
                if remove_data_from_chart_schema:
                    chart_result["chart_schema"]["data"]["values"] = []

                self._chart_adjustment_results[
                    query_id
                ] = ChartAdjustmentResultResponse(
                    status="finished",
                    response=ChartAdjustmentResult(**chart_result),
                    trace_id=trace_id,
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
                trace_id=trace_id,
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
