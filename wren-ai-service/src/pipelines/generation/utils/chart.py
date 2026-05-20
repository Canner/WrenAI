import logging
import re
from copy import deepcopy
from typing import Any, Dict, Literal, Optional

import orjson
import pandas as pd
from haystack import component
from jsonschema import validate
from jsonschema.exceptions import ValidationError
from pydantic import BaseModel, Field

logger = logging.getLogger("wren-ai-service")


def _humanize_title(name: str) -> str:
    return name.replace("_", " ").strip().title()


def _detect_requested_chart_type(query: str | None) -> str:
    normalized = (query or "").lower()
    checks = [
        ("grouped_bar", ["grouped bar"]),
        ("stacked_bar", ["stacked bar"]),
        ("multi_line", ["multi line", "multi-line"]),
        ("line", ["line chart", "line graph", "line plot"]),
        ("bar", ["bar chart", "bar graph", "column chart"]),
        ("pie", ["pie chart", "donut chart", "doughnut chart"]),
        ("area", ["area chart", "area graph"]),
    ]
    for chart_type, patterns in checks:
        if any(pattern in normalized for pattern in patterns):
            return chart_type
    if re.search(r"\b(chart|graph|plot|visuali[sz](?:e|ation)?)\b", normalized):
        return "bar"
    return ""


def _match_column_name(field: str, columns: list[str]) -> str:
    if field in columns:
        return field

    lowered = {column.lower(): column for column in columns}
    normalized = lowered.get(field.lower())
    if normalized:
        return normalized

    compact = re.sub(r"[\s_]+", "", field.lower())
    for column in columns:
        if re.sub(r"[\s_]+", "", column.lower()) == compact:
            return column

    return field


def _normalize_chart_schema_fields(chart_schema: dict, columns: list[str]) -> dict:
    normalized = deepcopy(chart_schema)
    encoding = normalized.get("encoding", {})

    for key in ("x", "y", "color", "xOffset", "theta"):
        axis = encoding.get(key)
        if isinstance(axis, dict) and axis.get("field"):
            axis["field"] = _match_column_name(axis["field"], columns)

    for transform in normalized.get("transform", []) or []:
        if isinstance(transform, dict) and isinstance(transform.get("fold"), list):
            transform["fold"] = [
                _match_column_name(field, columns) for field in transform["fold"]
            ]

    return normalized


def _infer_column_types(sample_data: list[dict]) -> dict[str, list[str]]:
    if not sample_data:
        return {"quantitative": [], "temporal": [], "nominal": []}

    df = pd.DataFrame(sample_data)
    quantitative: list[str] = []
    temporal: list[str] = []
    nominal: list[str] = []

    for column in df.columns:
        values = df[column].dropna()
        if values.empty:
            nominal.append(column)
            continue

        column_name = str(column).lower()
        numeric_values = pd.to_numeric(
            values.astype(str).str.replace(",", "", regex=False),
            errors="coerce",
        )
        temporal_values = pd.to_datetime(values, errors="coerce")
        is_temporal_name = bool(
            re.search(r"(date|time|month|year|day|created|updated)", column_name)
        )

        if numeric_values.notna().all() and not is_temporal_name:
            quantitative.append(column)
        elif temporal_values.notna().all() or is_temporal_name:
            temporal.append(column)
        else:
            nominal.append(column)

    return {
        "quantitative": quantitative,
        "temporal": temporal,
        "nominal": nominal,
    }


def _build_fallback_chart_schema(
    query: str | None,
    chart_type: str,
    sample_data: list[dict],
) -> dict:
    if not sample_data:
        return {}

    columns = list(sample_data[0].keys())
    inferred = _infer_column_types(sample_data)
    quantitative = inferred["quantitative"]
    temporal = inferred["temporal"]
    nominal = inferred["nominal"]

    title = _humanize_title(query or "Chart")

    def axis(field: str, field_type: str) -> dict:
        base = {"field": field, "type": field_type, "title": _humanize_title(field)}
        if field_type == "temporal":
            base["timeUnit"] = "yearmonth"
        return base

    if chart_type == "pie":
        color_field = nominal[0] if nominal else columns[0]
        theta_field = quantitative[0] if quantitative else (
            columns[1] if len(columns) > 1 else columns[0]
        )
        return {
            "title": title,
            "mark": {"type": "arc"},
            "encoding": {
                "theta": axis(theta_field, "quantitative"),
                "color": axis(color_field, "nominal"),
            },
        }

    if chart_type in {"line", "area", "multi_line"}:
        y_field = quantitative[0] if quantitative else columns[-1]
        if {"year", "month"}.issubset({c.lower() for c in columns}):
            month_field = next(c for c in columns if c.lower() == "month")
            encoding = {
                "x": axis(month_field, "ordinal"),
                "y": axis(y_field, "quantitative"),
            }
            years = [c for c in columns if c.lower() == "year"]
            if years:
                encoding["color"] = axis(years[0], "nominal")
            return {
                "title": title,
                "mark": {"type": "area" if chart_type == "area" else "line"},
                "encoding": encoding,
            }

        x_field = temporal[0] if temporal else (nominal[0] if nominal else columns[0])
        x_type = "temporal" if x_field in temporal else "ordinal"
        return {
            "title": title,
            "mark": {"type": "area" if chart_type == "area" else "line"},
            "encoding": {
                "x": axis(x_field, x_type),
                "y": axis(y_field, "quantitative"),
            },
        }

    x_field = nominal[0] if nominal else (temporal[0] if temporal else columns[0])
    y_field = quantitative[0] if quantitative else (columns[1] if len(columns) > 1 else columns[0])
    x_type = "nominal" if x_field in nominal else ("temporal" if x_field in temporal else "ordinal")
    encoding = {
        "x": axis(x_field, x_type),
        "y": axis(y_field, "quantitative"),
    }
    if chart_type == "grouped_bar" and len(nominal) > 1:
        encoding["xOffset"] = axis(nominal[1], "nominal")
        encoding["color"] = axis(nominal[1], "nominal")
    elif nominal:
        encoding["color"] = axis(nominal[0], "nominal")

    mark = {"type": "bar"}
    if chart_type == "stacked_bar":
        encoding["y"]["stack"] = "zero"

    return {
        "title": title,
        "mark": mark,
        "encoding": encoding,
    }


def _is_schema_compatible_with_sample_data(
    chart_schema: dict,
    sample_data: list[dict],
) -> bool:
    if not chart_schema or not sample_data:
        return False

    columns = set(sample_data[0].keys())
    encoding = chart_schema.get("encoding", {})
    for key in ("x", "y", "color", "xOffset", "theta"):
        axis = encoding.get(key)
        if isinstance(axis, dict) and axis.get("field") and axis["field"] not in columns:
            return False

    for transform in chart_schema.get("transform", []) or []:
        if isinstance(transform, dict):
            for field in transform.get("fold", []) or []:
                if field not in columns:
                    return False

    return True


chart_generation_instructions = """
### INSTRUCTIONS ###

- Chart types: Bar chart, Line chart, Multi line chart, Area chart, Pie chart, Stacked bar chart, Grouped bar chart
- You can only use the chart types provided in the instructions
- Generated chart should answer the user's question and based on the semantics of the SQL query, and the sample data, sample column values are used to help you generate the suitable chart type
- If the sample data is not suitable for visualization, you must return an empty string for the schema and chart type
- If the sample data is empty, you must return an empty string for the schema and chart type
- The language for the chart and reasoning must be the same language provided by the user
- Please use the current time provided by the user to generate the chart
- In order to generate the grouped bar chart, you need to follow the given instructions:
    - Disable Stacking: Add "stack": null to the y-encoding.
    - Use xOffset for subcategories to group bars.
    - Don't use "transform" section.
- In order to generate the pie chart, you need to follow the given instructions:
    - Add {"type": "arc"} to the mark section.
    - Add "theta" encoding to the encoding section.
    - Add "color" encoding to the encoding section.
    - Don't add "innerRadius" to the mark section.
- If the x-axis of the chart is a temporal field, the time unit should be the same as the question user asked.
    - For yearly question, the time unit should be "year".
    - For monthly question, the time unit should be "yearmonth".
    - For weekly question, the time unit should be "yearmonthdate".
    - For daily question, the time unit should be "yearmonthdate".
    - Default time unit is "yearmonth".
- For each axis, generate the corresponding human-readable title based on the language provided by the user.
- Make sure all of the fields(x, y, xOffset, color, etc.) in the encoding section of the chart schema are present in the column names of the data.

### GUIDELINES TO PLOT CHART ###

1. Understanding Your Data Types
- Nominal (Categorical): Names or labels without a specific order (e.g., types of fruits, countries).
- Ordinal: Categorical data with a meaningful order but no fixed intervals (e.g., rankings, satisfaction levels).
- Quantitative: Numerical values representing counts or measurements (e.g., sales figures, temperatures).
- Temporal: Date or time data (e.g., timestamps, dates).
2. Chart Types and When to Use Them
- Bar Chart
    - Use When: Comparing quantities across different categories.
    - Data Requirements:
        - One categorical variable (x-axis).
        - One quantitative variable (y-axis).
    - Example: Comparing sales numbers for different product categories.
- Grouped Bar Chart
    - Use When: Comparing sub-categories within main categories.
    - Data Requirements:
        - Two categorical variables (x-axis grouped by one, color-coded by another).
        - One quantitative variable (y-axis).
        - Example: Sales numbers for different products across various regions.
- Line Chart
    - Use When: Displaying trends over continuous data, especially time.
    - Data Requirements:
        - One temporal or ordinal variable (x-axis).
        - One quantitative variable (y-axis).
    - Example: Tracking monthly revenue over a year.
- Multi Line Chart
    - Use When: Displaying trends over continuous data, especially time.
    - Data Requirements:
        - One temporal or ordinal variable (x-axis).
        - Two or more quantitative variables (y-axis and color).
    - Implementation Notes:
        - Uses `transform` with `fold` to combine multiple metrics into a single series
        - The folded metrics are distinguished using the color encoding
    - Example: Tracking monthly click rate and read rate over a year.
- Area Chart
    - Use When: Similar to line charts but emphasizing the volume of change over time.
    - Data Requirements:
        - Same as Line Chart.
    - Example: Visualizing cumulative rainfall over months.
- Pie Chart
    - Use When: Showing parts of a whole as percentages.
    - Data Requirements:
        - One categorical variable.
        - One quantitative variable representing proportions.
    - Example: Market share distribution among companies.
- Stacked Bar Chart
    - Use When: Showing composition and comparison across categories.
    - Data Requirements: Same as grouped bar chart.
    - Example: Sales by region and product type.
- Guidelines for Selecting Chart Types
    - Comparing Categories:
        - Bar Chart: Best for simple comparisons across categories.
        - Grouped Bar Chart: Use when you have sub-categories.
        - Stacked Bar Chart: Use to show composition within categories.
    - Showing Trends Over Time:
        - Line Chart: Ideal for continuous data over time.
        - Area Chart: Use when you want to emphasize volume or total value over time.
    - Displaying Proportions:
        - Pie Chart: Use for simple compositions at a single point in time.
        - Stacked Bar Chart (100%): Use for comparing compositions across multiple categories.
    
### EXAMPLES ###

1. Bar Chart
- Sample Data:
 [
    {"Region": "North", "Sales": 100},
    {"Region": "South", "Sales": 200},
    {"Region": "East", "Sales": 300},
    {"Region": "West", "Sales": 400}
]
- Chart Schema:
{
    "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>,
    "mark": {"type": "bar"},
    "encoding": {
        "x": {"field": "Region", "type": "nominal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "y": {"field": "Sales", "type": "quantitative", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "color": {"field": "Region", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"}
    }
}
2. Line Chart
- Sample Data:
[
    {"Date": "2022-01-01", "Sales": 100},
    {"Date": "2022-01-02", "Sales": 200},
    {"Date": "2022-01-03", "Sales": 300},
    {"Date": "2022-01-04", "Sales": 400}
]
- Chart Schema:
{
    "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>,
    "mark": {"type": "line"},
    "encoding": {
        "x": {"field": "Date", "type": "temporal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "y": {"field": "Sales", "type": "quantitative", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>}
    }
}
3. Pie Chart
- Sample Data:
[
    {"Company": "Company A", "Market Share": 0.4},
    {"Company": "Company B", "Market Share": 0.3},
    {"Company": "Company C", "Market Share": 0.2},
    {"Company": "Company D", "Market Share": 0.1}
]
- Chart Schema:
{
    "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>,
    "mark": {"type": "arc"},
    "encoding": {
        "theta": {"field": "Market Share", "type": "quantitative"},
        "color": {"field": "Company", "type": "nominal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>}
    }
}
4. Area Chart
- Sample Data:
[
    {"Date": "2022-01-01", "Sales": 100},
    {"Date": "2022-01-02", "Sales": 200},
    {"Date": "2022-01-03", "Sales": 300},
    {"Date": "2022-01-04", "Sales": 400}
]
- Chart Schema:
{
    "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>",
    "mark": {"type": "area"},
    "encoding": {
        "x": {"field": "Date", "type": "temporal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"},
        "y": {"field": "Sales", "type": "quantitative", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"}
    }
}
5. Stacked Bar Chart
- Sample Data:
[
    {"Region": "North", "Product": "A", "Sales": 100},
    {"Region": "North", "Product": "B", "Sales": 150},
    {"Region": "South", "Product": "A", "Sales": 200},
    {"Region": "South", "Product": "B", "Sales": 250},
    {"Region": "East", "Product": "A", "Sales": 300},
    {"Region": "East", "Product": "B", "Sales": 350},
    {"Region": "West", "Product": "A", "Sales": 400},
    {"Region": "West", "Product": "B", "Sales": 450}
]
- Chart Schema:
{
    "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>",
    "mark": {"type": "bar"},
    "encoding": {
        "x": {"field": "Region", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"},
        "y": {"field": "Sales", "type": "quantitative", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>", "stack": "zero"},
        "color": {"field": "Product", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"}
    }
}
6. Grouped Bar Chart
- Sample Data:
[
    {"Region": "North", "Product": "A", "Sales": 100},
    {"Region": "North", "Product": "B", "Sales": 150},
    {"Region": "South", "Product": "A", "Sales": 200},
    {"Region": "South", "Product": "B", "Sales": 250},
    {"Region": "East", "Product": "A", "Sales": 300},
    {"Region": "East", "Product": "B", "Sales": 350},
    {"Region": "West", "Product": "A", "Sales": 400},
    {"Region": "West", "Product": "B", "Sales": 450}
]
- Chart Schema:
{
    "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>",
    "mark": {"type": "bar"},
    "encoding": {
        "x": {"field": "Region", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"},
        "y": {"field": "Sales", "type": "quantitative", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"},
        "xOffset": {"field": "Product", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"},
        "color": {"field": "Product", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"}
    }
}
7. Multi Line Chart
- Sample Data:
[
    {"Date": "2022-01-01", "readCount": 100, "clickCount": 10},
    {"Date": "2022-01-02", "readCount": 200, "clickCount": 30},
    {"Date": "2022-01-03", "readCount": 300, "clickCount": 20},
    {"Date": "2022-01-04", "readCount": 400, "clickCount": 40}
]
- Chart Schema:
{
    "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>,
    "mark": {"type": "line"},
    "transform": [
        {
        "fold": ["readCount", "clickCount"],
        "as": ["Metric", "Value"]
        }
    ],
    "encoding": {
        "x": {"field": "Date", "type": "temporal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "y": {"field": "Value", "type": "quantitative", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "color": {"field": "Metric", "type": "nominal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>}
    }
}
"""


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
        vega_schema: Dict[str, Any],
        sample_data: list[dict],
        query: Optional[str] = None,
        remove_data_from_chart_schema: Optional[bool] = True,
    ):
        try:
            generation_result = orjson.loads(replies[0])
            reasoning = generation_result.get("reasoning", "")
            requested_chart_type = _detect_requested_chart_type(query)
            chart_type = requested_chart_type or generation_result.get("chart_type", "")
            if chart_schema := generation_result.get("chart_schema", {}):
                # sometimes the chart_schema is still in string format
                if isinstance(chart_schema, str):
                    chart_schema = orjson.loads(chart_schema)

                chart_schema = _normalize_chart_schema_fields(
                    chart_schema, list(sample_data[0].keys()) if sample_data else []
                )

                if not _is_schema_compatible_with_sample_data(chart_schema, sample_data):
                    chart_schema = _build_fallback_chart_schema(
                        query, chart_type or "bar", sample_data
                    )

                chart_schema[
                    "$schema"
                ] = "https://vega.github.io/schema/vega-lite/v5.json"
                chart_schema["data"] = {"values": sample_data}

                validate(chart_schema, schema=vega_schema)

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
                    "chart_schema": _build_fallback_chart_schema(
                        query, chart_type or "bar", sample_data
                    ),
                    "reasoning": reasoning,
                    "chart_type": chart_type,
                }
            }
        except ValidationError as e:
            logger.exception(f"Vega-lite schema is not valid: {e}")
            fallback_schema = _build_fallback_chart_schema(
                query,
                _detect_requested_chart_type(query) or "",
                sample_data,
            )

            return {
                "results": {
                    "chart_schema": fallback_schema,
                    "reasoning": "",
                    "chart_type": _detect_requested_chart_type(query) or "",
                }
            }
        except Exception as e:
            logger.exception(f"JSON deserialization failed: {e}")
            fallback_chart_type = _detect_requested_chart_type(query) or ""
            fallback_schema = _build_fallback_chart_schema(
                query, fallback_chart_type, sample_data
            )

            return {
                "results": {
                    "chart_schema": fallback_schema,
                    "reasoning": "",
                    "chart_type": fallback_chart_type,
                }
            }


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
