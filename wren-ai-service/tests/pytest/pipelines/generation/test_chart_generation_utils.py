import pytest

from src.pipelines.generation.utils.chart import (
    ChartDataPreprocessor,
    _is_schema_compatible_with_sample_data,
    build_fallback_chart_result,
)
from src.web.v1.services.chart import ChartRequest, ChartService


def test_chart_preprocessor_uses_deterministic_sql_result_order():
    data = {
        "columns": [{"name": "Market"}, {"name": "Revenue"}],
        "data": [[f"Market {index}", index] for index in range(20)],
    }

    result = ChartDataPreprocessor().run(data, sample_data_count=3)

    assert result["sample_data"] == [
        {"Market": "Market 0", "Revenue": 0},
        {"Market": "Market 1", "Revenue": 1},
        {"Market": "Market 2", "Revenue": 2},
    ]


def test_fallback_chart_requires_a_real_quantitative_measure():
    result = build_fallback_chart_result(
        "Create a chart comparing completed repairs across engineers.",
        {
            "columns": [{"name": "Status"}],
            "data": [["completed"], ["completed"], ["in-progress"]],
        },
    )

    assert result == {"chart_schema": {}, "reasoning": "", "chart_type": ""}


def test_fallback_chart_uses_grouped_bar_for_two_business_dimensions():
    result = build_fallback_chart_result(
        "Which Customers have the highest New Orders in each Market?",
        {
            "columns": [
                {"name": "Market"},
                {"name": "Customer"},
                {"name": "OrderCount"},
            ],
            "data": [["North", "Acme", 10], ["South", "Globex", 8]],
        },
    )

    assert result["chart_type"] == "grouped_bar"
    assert result["chart_schema"]["encoding"]["x"]["field"] == "Customer"
    assert result["chart_schema"]["encoding"]["y"]["field"] == "OrderCount"
    assert result["chart_schema"]["encoding"]["color"]["field"] == "Market"
    assert result["chart_schema"]["encoding"]["xOffset"]["field"] == "Market"


def test_chart_schema_rejects_vega_aggregate_count_without_sql_metric():
    assert not _is_schema_compatible_with_sample_data(
        {
            "mark": {"type": "bar"},
            "encoding": {
                "x": {"field": "Inv Date", "type": "temporal"},
                "y": {"aggregate": "count", "type": "quantitative"},
            },
        },
        [{"Inv Date": "2026-01-01"}, {"Inv Date": "2026-07-01"}],
    )


@pytest.mark.asyncio
async def test_chart_service_returns_deterministic_chart_without_llm_wait():
    class FakeChartGenerationPipeline:
        async def run(self, **kwargs):
            raise AssertionError("chart LLM pipeline should not be called")

    service = ChartService({"chart_generation": FakeChartGenerationPipeline()})
    request = ChartRequest(
        query_id="chart-task",
        query="Compare customer performance across markets.",
        sql="SELECT Market, SUM(Revenue) AS Revenue FROM Sales GROUP BY Market",
        data={
            "columns": [{"name": "Market"}, {"name": "Revenue"}],
            "data": [["North", 100], ["South", 200]],
        },
    )

    result = await service.chart(request)

    assert result["chart_result"]["reasoning"] == (
        "Generated from the SQL result columns and requested chart type."
    )
    assert result["chart_result"]["chart_type"] == "bar"
