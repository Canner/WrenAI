import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")


# POST /v1/charts
class ChartRequest(BaseModel):
    _query_id: str | None = None
    data: dict[str, dict]
    thread_id: Optional[str] = None
    user_id: Optional[str] = None

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


class ChartResultResponse(BaseModel):
    status: Literal["understanding", "generating", "finished", "failed", "stopped"]
    response: Optional[dict] = None
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

    @async_timer
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

            self._chart_results[query_id] = ChartResultResponse(status="understanding")

            self._chart_results[query_id] = ChartResultResponse(status="generating")

            chart_generation_result = await self._pipelines["chart_generation"].run(
                data=chart_request.data,
            )
            chart_result = chart_generation_result["post_process"]["results"]["schema"]

            if not chart_result:
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
                    status="finished", response=chart_result
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
