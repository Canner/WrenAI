import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.web.v1.services.chart import ChartRequest, ChartResultRequest, ChartService


FIXTURES_DIR = Path(__file__).resolve().parents[2] / "data"


class RecordingPipeline(SimpleNamespace):
    def __init__(self, result=None):
        super().__init__(run=AsyncMock(return_value=result if result is not None else {}))


def load_cases(file_name: str) -> list[dict]:
    return json.loads((FIXTURES_DIR / file_name).read_text())


CHART_GOLDEN_CASES = load_cases("chart_golden_cases.json")


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CHART_GOLDEN_CASES, ids=lambda case: case["name"])
async def test_chart_golden_regression_baseline(case: dict):
    scenario = case["scenario"]
    sql_executor = RecordingPipeline(
        {"execute_sql": scenario["sql_executor_results"]}
    )
    chart_generation = RecordingPipeline(
        {"post_process": {"results": scenario["chart_generation_result"]}}
    )
    service = ChartService(
        pipelines={
            "sql_executor": sql_executor,
            "chart_generation": chart_generation,
        }
    )
    request = ChartRequest.model_validate(
        {
            "query": case["query"],
            "sql": case["sql"],
            "runtime_scope_id": case["project_id"],
        }
    )
    request.query_id = f"chart-{case['name']}"

    result = await service.chart(request)
    chart_result = service.get_chart_result(
        ChartResultRequest(query_id=request.query_id)
    )
    expected = case["expected"]

    assert chart_result.status == expected["status"], case["allowed_variance"]
    assert chart_result.response is not None
    assert chart_result.response.chart_type == expected["chartType"]
    assert chart_result.response.reasoning == expected["reasoning"]
    assert result["chart_result"]["chart_type"] == expected["chartType"]
    assert sql_executor.run.await_count == 1
    assert sql_executor.run.await_args.kwargs == {
        "sql": case["sql"],
        "runtime_scope_id": case["project_id"],
    }
    assert chart_generation.run.await_count == 1
    assert chart_generation.run.await_args.kwargs["data"] == scenario[
        "sql_executor_results"
    ]["results"]
