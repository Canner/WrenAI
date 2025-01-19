import logging
from typing import Any, Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


# POST /v1/charts
class ChartRequest(BaseModel):
    _query_id: str | None = None
    query: str
    sql: str
    project_id: Optional[str] = None
    thread_id: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    remove_data_from_chart_schema: Optional[bool] = True
    configurations: Optional[Configuration] = Configuration()

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class ChartResponse(BaseModel):
    query_id: str


# PATCH /v1/charts/{query_id}
class StopChartRequest(BaseModel):
    _query_id: str | None = None
    status: Literal["stopped"]

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


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
    chart_type: Literal[
        "line", "bar", "pie", "grouped_bar", "stacked_bar", "area", "multi_line", ""
    ]  # empty string for no chart
    chart_schema: dict


class ChartResultResponse(BaseModel):
    status: Literal["fetching", "generating", "finished", "failed", "stopped"]
    response: Optional[ChartResult] = None
    error: Optional[ChartError] = None


class ChartService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._chart_results: Dict[str, ChartResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

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
        results = {
            "chart_result": {},
            "metadata": {
                "error_type": "",
                "error_message": "",
            },
        }

        try:
            query_id = chart_request.query_id

            if not chart_request.data:
                self._chart_results[query_id] = ChartResultResponse(status="fetching")

                sql_data = (
                    await self._pipelines["sql_executor"].run(
                        sql=chart_request.sql,
                        project_id=chart_request.project_id,
                    )
                )["execute_sql"]["results"]
            else:
                sql_data = chart_request.data

            self._chart_results[query_id] = ChartResultResponse(status="generating")

            chart_generation_result = await self._pipelines["chart_generation"].run(
                query=chart_request.query,
                sql=chart_request.sql,
                data=sql_data,
                language=chart_request.configurations.language,
                remove_data_from_chart_schema=chart_request.remove_data_from_chart_schema,
            )
            chart_result = chart_generation_result["post_process"]["results"]

            if not chart_result.get("chart_schema", {}) and not chart_result.get(
                "reasoning", ""
            ):
                self._chart_results[query_id] = ChartResultResponse(
                    status="failed",
                    error=ChartError(
                        code="NO_CHART", message="chart generation failed"
                    ),
                )
                results["metadata"]["error_type"] = "NO_CHART"
                results["metadata"]["error_message"] = "chart generation failed"
            else:
                self._chart_results[query_id] = ChartResultResponse(
                    status="finished",
                    response=ChartResult(**chart_result),
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
