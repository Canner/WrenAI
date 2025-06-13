import logging
from typing import Any, Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest

logger = logging.getLogger("wren-ai-service")


# POST /v1/charts
class ChartRequest(BaseRequest):
    query: str
    sql: str
    data: Optional[Dict[str, Any]] = None
    remove_data_from_chart_schema: bool = True


class ChartResponse(BaseModel):
    query_id: str


# PATCH /v1/charts/{query_id}
class StopChartRequest(BaseRequest):
    status: Literal["stopped"]


class StopChartResponse(BaseModel):
    query_id: str


# GET /v1/charts/{query_id}/result
class ChartError(BaseModel):
    code: Literal["NO_CHART", "OTHERS"]
    message: str


class ChartResultRequest(BaseModel):
    query_id: str


class ChartResult(BaseModel):
    reasoning: str
    chart_schema: dict


class ChartResultResponse(BaseModel):
    status: Literal["fetching", "generating", "finished", "failed", "stopped"]
    response: Optional[ChartResult] = None
    error: Optional[ChartError] = None
    trace_id: Optional[str] = None


class ChartService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        allow_chart_validation: bool = False,
        max_chart_correction_retries: int = 3,
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._chart_results: Dict[str, ChartResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._allow_chart_validation = allow_chart_validation
        self._max_chart_correction_retries = max_chart_correction_retries

    def _is_stopped(self, query_id: str):
        if (
            result := self._chart_results.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    @observe(name="Generate Chart")
    @trace_metadata
    async def chart(
        self,
        chart_request: ChartRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        results = {
            "chart_result": {},
            "metadata": {
                "error_type": "",
                "error_message": "",
                "request_from": chart_request.request_from,
            },
        }

        try:
            data_provided = False
            query_id = chart_request.query_id
            allow_chart_validation = self._allow_chart_validation
            remove_data_from_chart_schema = chart_request.remove_data_from_chart_schema
            max_chart_correction_retries = self._max_chart_correction_retries
            current_chart_correction_retries = 0

            if not chart_request.data:
                self._chart_results[query_id] = ChartResultResponse(
                    status="fetching",
                    trace_id=trace_id,
                )

                sql_data = (
                    await self._pipelines["sql_executor"].run(
                        sql=chart_request.sql,
                        project_id=chart_request.project_id,
                    )
                )["execute_sql"]["results"]
            else:
                sql_data = chart_request.data
                data_provided = True

            self._chart_results[query_id] = ChartResultResponse(
                status="generating",
                trace_id=trace_id,
            )

            chart_generation_result = await self._pipelines["chart_generation"].run(
                query=chart_request.query,
                sql=chart_request.sql,
                data=sql_data,
                language=chart_request.configurations.language,
                data_provided=data_provided,
            )
            chart_result = chart_generation_result["post_process"]["results"]
            chart_schema = chart_result.get("chart_schema", {})
            reasoning = chart_result.get("reasoning", "")

            if not chart_schema and not reasoning:
                self._chart_results[query_id] = ChartResultResponse(
                    status="failed",
                    error=ChartError(
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

                    if chart_validation_result.get("valid", False):
                        if remove_data_from_chart_schema:
                            if (
                                "data" in chart_result["chart_schema"]
                                and "values" in chart_result["chart_schema"]["data"]
                            ):
                                chart_result["chart_schema"]["data"]["values"] = []

                        self._chart_results[query_id] = ChartResultResponse(
                            status="finished",
                            response=ChartResult(**chart_result),
                            trace_id=trace_id,
                        )
                        results["chart_result"] = chart_result
                        break
                    elif (
                        current_chart_correction_retries == max_chart_correction_retries
                    ):
                        self._chart_results[query_id] = ChartResultResponse(
                            status="failed",
                            error=ChartError(
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
                            query=chart_request.query,
                            sql=chart_request.sql,
                            chart_schema=chart_schema,
                            language=chart_request.configurations.language,
                        )
                        chart_result = chart_correction_result["post_process"][
                            "results"
                        ]
                        chart_schema = chart_result.get("chart_schema", {})
            else:
                if remove_data_from_chart_schema:
                    if (
                        "data" in chart_result["chart_schema"]
                        and "values" in chart_result["chart_schema"]["data"]
                    ):
                        chart_result["chart_schema"]["data"]["values"] = []

                self._chart_results[query_id] = ChartResultResponse(
                    status="finished",
                    response=ChartResult(**chart_result),
                    trace_id=trace_id,
                )
                results["chart_result"] = chart_result

            return results
        except Exception as e:
            logger.exception(f"chart pipeline - OTHERS: {e}")

            self._chart_results[chart_request.query_id] = ChartResultResponse(
                status="failed",
                error=ChartError(
                    code="OTHERS",
                    message=str(e),
                ),
                trace_id=trace_id,
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            return results

    def stop_chart(
        self,
        stop_chart_request: StopChartRequest,
    ):
        self._chart_results[stop_chart_request.query_id] = ChartResultResponse(
            status="stopped",
        )

    def get_chart_result(
        self,
        chart_result_request: ChartResultRequest,
    ) -> ChartResultResponse:
        if (result := self._chart_results.get(chart_result_request.query_id)) is None:
            logger.exception(
                f"chart pipeline - OTHERS: {chart_result_request.query_id} is not found"
            )
            return ChartResultResponse(
                status="failed",
                error=ChartError(
                    code="OTHERS",
                    message=f"{chart_result_request.query_id} is not found",
                ),
            )

        return result
