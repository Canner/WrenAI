import logging
from typing import Any, Dict, Literal, Optional

import orjson
import pandas as pd
from haystack import component
from jsonschema.exceptions import ValidationError
from pydantic import BaseModel, Field

logger = logging.getLogger("wren-ai-service")


chart_generation_instructions = """
1. Please check VEGA-LITE SCHEMA SPECIFICATION to make sure the vega-lite schema is valid.
2. The following are examples of several chart types and their corresponding vega-lite schema:

a.  Chart Type: Candlestick Chart
    When to use: When you want to visualize the price changes of a stock or other financial instrument over time.
    Vega-Lite Schema in JSON format(only include the necessary part):
    {
        "encoding": {
            "x": {
                "field": "date",
                "type": "temporal",
                "title": "<title>",
                "axis": {
                    "format": "<format>",
                    "labelAngle": <labelAngle>,
                    "title": "<x_axis_title>"
                }
            },
            "y": {
                "type": "quantitative",
                "scale": {"zero": false},
                "axis": {"title": "<y_axis_title>"}
            },
            "color": {
                "condition": {
                    "test": "datum.open < datum.close",
                    "value": "#06982d"
                },
                "value": "#ae1325"
            }
        },
        "layer": [
            {
                "mark": "rule",
                "encoding": {
                    "y": {"field": "low"},
                    "y2": {"field": "high"}
                }
            },
            {
                "mark": "bar",
                "encoding": {
                    "y": {"field": "open"},
                    "y2": {"field": "close"}
                }
            }
        ]
    }
"""


def load_custom_theme() -> Dict[str, Any]:
    with open("src/pipelines/generation/utils/theme_powerbi.json", "r") as f:
        return orjson.loads(f.read())


@component
class ChartDataPreprocessor:
    @component.output_types(
        sample_data=list[dict],
        sample_column_values=dict[str, Any],
    )
    def run(
        self,
        data: Dict[str, Any],
        sample_data_count: int = 15,
        sample_column_size: int = 5,
    ):
        columns = [
            column.get("name", "") if isinstance(column, dict) else column
            for column in data.get("columns", [])
        ]
        data = data.get("data", [])

        df = pd.DataFrame(data, columns=columns)
        sample_column_values = {
            col: list(df[col].unique())[:sample_column_size] for col in df.columns
        }

        if len(df) > sample_data_count:
            sample_data = df.sample(n=sample_data_count).to_dict(orient="records")
        else:
            sample_data = df.to_dict(orient="records")

        return {
            "raw_data": df.to_dict(orient="records"),
            "sample_data": sample_data,
            "sample_column_values": sample_column_values,
        }


@component
class ChartGenerationPostProcessor:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(
        self,
        replies: str,
        sample_data: list[dict],
        remove_data_from_chart_schema: Optional[bool] = True,
    ):
        try:
            generation_result = orjson.loads(replies[0])
            reasoning = generation_result.get("reasoning", "")
            chart_type = generation_result.get("chart_type", "")
            if chart_schema := generation_result.get("chart_schema", {}):
                # sometimes the chart_schema is still in string format
                if isinstance(chart_schema, str):
                    chart_schema = orjson.loads(chart_schema)

                chart_schema[
                    "$schema"
                ] = "https://vega.github.io/schema/vega-lite/v5.json"
                chart_schema["data"] = {"values": sample_data}
                chart_schema["config"] = load_custom_theme()

                if remove_data_from_chart_schema:
                    chart_schema["data"]["values"] = []

                return {
                    "results": {
                        "chart_schema": chart_schema,
                        "reasoning": reasoning,
                        "chart_type": chart_type,
                    }
                }

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": reasoning,
                    "chart_type": chart_type,
                }
            }
        except ValidationError as e:
            logger.exception(f"Vega-lite schema is not valid: {e}")

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": "",
                    "chart_type": "",
                }
            }
        except Exception as e:
            logger.exception(f"JSON deserialization failed: {e}")

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": "",
                    "chart_type": "",
                }
            }


def read_vega_lite_schema() -> Dict[str, Any]:
    with open("src/pipelines/generation/utils/vega-lite-schema-v5.json", "r") as f:
        vega_lite_schema = orjson.loads(f.read())

    return vega_lite_schema


class ChartSchema(BaseModel):
    class ChartType(BaseModel):
        type: Literal["bar", "line", "area", "arc"]

    class ChartEncoding(BaseModel):
        field: str
        type: Literal["ordinal", "quantitative", "nominal"]
        title: str

    title: str
    mark: ChartType
    encoding: ChartEncoding


class TemporalChartEncoding(ChartSchema.ChartEncoding):
    type: Literal["temporal"] = Field(default="temporal")
    timeUnit: str = Field(default="yearmonth")


class LineChartSchema(ChartSchema):
    class LineChartMark(BaseModel):
        type: Literal["line"] = Field(default="line")

    class LineChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: LineChartMark
    encoding: LineChartEncoding


class MultiLineChartSchema(ChartSchema):
    class MultiLineChartMark(BaseModel):
        type: Literal["line"] = Field(default="line")

    class MultiLineChartTransform(BaseModel):
        fold: list[str]
        as_: list[str] = Field(alias="as")

    class MultiLineChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: MultiLineChartMark
    transform: list[MultiLineChartTransform]
    encoding: MultiLineChartEncoding


class BarChartSchema(ChartSchema):
    class BarChartMark(BaseModel):
        type: Literal["bar"] = Field(default="bar")

    class BarChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: BarChartMark
    encoding: BarChartEncoding


class GroupedBarChartSchema(ChartSchema):
    class GroupedBarChartMark(BaseModel):
        type: Literal["bar"] = Field(default="bar")

    class GroupedBarChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: ChartSchema.ChartEncoding
        xOffset: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: GroupedBarChartMark
    encoding: GroupedBarChartEncoding


class StackedBarChartYEncoding(ChartSchema.ChartEncoding):
    stack: Literal["zero"] = Field(default="zero")


class StackedBarChartSchema(ChartSchema):
    class StackedBarChartMark(BaseModel):
        type: Literal["bar"] = Field(default="bar")

    class StackedBarChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: StackedBarChartYEncoding
        color: ChartSchema.ChartEncoding

    mark: StackedBarChartMark
    encoding: StackedBarChartEncoding


class PieChartSchema(ChartSchema):
    class PieChartMark(BaseModel):
        type: Literal["arc"] = Field(default="arc")

    class PieChartEncoding(BaseModel):
        theta: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: PieChartMark
    encoding: PieChartEncoding


class AreaChartSchema(ChartSchema):
    class AreaChartMark(BaseModel):
        type: Literal["area"] = Field(default="area")

    class AreaChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: ChartSchema.ChartEncoding

    mark: AreaChartMark
    encoding: AreaChartEncoding


class ChartGenerationResults(BaseModel):
    reasoning: str
    chart_type: Literal[
        "line", "multi_line", "bar", "pie", "grouped_bar", "stacked_bar", "area", ""
    ]  # empty string for no chart
    chart_schema: (
        LineChartSchema
        | MultiLineChartSchema
        | BarChartSchema
        | PieChartSchema
        | GroupedBarChartSchema
        | StackedBarChartSchema
        | AreaChartSchema
    )
