import logging
import re
from typing import Any, Dict, Literal, Optional

import orjson
import pandas as pd
from haystack import component
from jsonschema import validate
from jsonschema.exceptions import ValidationError
from pydantic import BaseModel, Field

logger = logging.getLogger("wren-ai-service")

_TEMPORAL_NAME_PATTERN = re.compile(
    r"(date|time|timestamp|month|year|week|day|period)", re.I
)
_COUNT_QUERY_PATTERN = re.compile(r"\b(count|counts|number|volume|how many)\b", re.I)
_TREND_QUERY_PATTERN = re.compile(
    r"\b(trend|over time|monthly|weekly|daily|yearly|by month|by week|by year)\b",
    re.I,
)
_GROUPED_QUERY_PATTERN = re.compile(r"\b(each|across|within|by .+ by|per .+ per)\b", re.I)
_TOP_QUERY_PATTERN = re.compile(r"\b(top|highest|lowest|most|least|rank)\b", re.I)
_MEASURE_TERMS = {
    "amount",
    "cost",
    "count",
    "price",
    "qty",
    "quantity",
    "revenue",
    "sale",
    "sales",
    "sum",
    "total",
    "value",
}


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

        sample_data = df.head(sample_data_count).to_dict(orient="records")

        return {
            "sample_data": sample_data,
            "sample_column_values": sample_column_values,
        }


def build_fallback_chart_result(query: str, data: Dict[str, Any]) -> Dict[str, Any]:
    columns = _column_names(data)
    rows = data.get("data", []) or []
    records = _row_records(columns, rows)
    if not columns or not records:
        return _empty_chart_result("No chart was generated because the result is empty.")

    numeric_columns = [
        column for column in columns if _is_numeric_column(column, records)
    ]
    temporal_columns = [
        column for column in columns if _is_temporal_column(column, records)
    ]
    categorical_columns = [
        column
        for column in columns
        if column not in numeric_columns and column not in temporal_columns
    ]

    if temporal_columns and not numeric_columns and _TREND_QUERY_PATTERN.search(
        query or ""
    ):
        x_field = _best_named_column(query, temporal_columns) or temporal_columns[0]
        return _chart_result(
            chart_type="line",
            chart_schema={
                "title": _title(query),
                "mark": {"type": "line"},
                "encoding": {
                    "x": _encoding(
                        x_field,
                        "temporal",
                        title=x_field,
                        timeUnit=_time_unit(query),
                    ),
                    "y": _count_encoding(query),
                },
            },
        )

    if not numeric_columns:
        count_chart_columns = categorical_columns or temporal_columns
        if not count_chart_columns:
            return _empty_chart_result(
                "No chart was generated because the result is not suitable for visualization."
            )

        x_field = _best_named_column(query, count_chart_columns) or count_chart_columns[0]
        secondary_categories = [
            column for column in categorical_columns if column != x_field
        ]
        if len(secondary_categories) >= 1 and (
            _GROUPED_QUERY_PATTERN.search(query or "") or len(categorical_columns) >= 2
        ):
            group_field = (
                _group_field_from_each_clause(query, secondary_categories)
                or secondary_categories[0]
            )
            return _chart_result(
                chart_type="grouped_bar",
                chart_schema={
                    "title": _title(query),
                    "mark": {"type": "bar"},
                    "encoding": {
                        "x": _encoding(x_field, "nominal", title=x_field),
                        "y": _count_encoding(query),
                        "xOffset": _encoding(group_field, "nominal", title=group_field),
                        "color": _encoding(group_field, "nominal", title=group_field),
                    },
                },
            )

        return _chart_result(
            chart_type="bar",
            chart_schema={
                "title": _title(query),
                "mark": {"type": "bar"},
                "encoding": {
                    "x": _encoding(x_field, "nominal", title=x_field),
                    "y": _count_encoding(query),
                    "color": _encoding(x_field, "nominal", title=x_field),
                },
            },
        )

    y_field = _best_numeric_column(query, numeric_columns)

    if temporal_columns and (_TREND_QUERY_PATTERN.search(query or "") or len(columns) <= 3):
        x_field = _best_named_column(query, temporal_columns) or temporal_columns[0]
        chart_type = "line"
        return _chart_result(
            chart_type=chart_type,
            chart_schema={
                "title": _title(query),
                "mark": {"type": "line"},
                "encoding": {
                    "x": _encoding(
                        x_field,
                        "temporal",
                        title=x_field,
                        timeUnit=_time_unit(query),
                    ),
                    "y": _encoding(y_field, "quantitative", title=y_field),
                },
            },
        )

    category_candidates = categorical_columns or [
        column for column in columns if column != y_field
    ]
    x_field = _best_named_column(query, category_candidates) or category_candidates[0]

    secondary_categories = [
        column for column in categorical_columns if column != x_field
    ]
    should_group = (
        len(secondary_categories) >= 1
        and (_GROUPED_QUERY_PATTERN.search(query or "") or len(categorical_columns) >= 2)
    )
    if should_group:
        group_field = (
            _group_field_from_each_clause(query, secondary_categories)
            or secondary_categories[0]
        )
        return _chart_result(
            chart_type="grouped_bar",
            chart_schema={
                "title": _title(query),
                "mark": {"type": "bar"},
                "encoding": {
                    "x": _encoding(x_field, "nominal", title=x_field),
                    "y": _encoding(y_field, "quantitative", title=y_field),
                    "xOffset": _encoding(group_field, "nominal", title=group_field),
                    "color": _encoding(group_field, "nominal", title=group_field),
                },
            },
        )

    return _chart_result(
        chart_type="bar",
        chart_schema={
            "title": _title(query),
            "mark": {"type": "bar"},
            "encoding": {
                "x": _encoding(x_field, "nominal", title=x_field),
                "y": _encoding(y_field, "quantitative", title=y_field),
                "color": _encoding(x_field, "nominal", title=x_field),
            },
        },
    )


def _is_schema_compatible_with_sample_data(
    chart_schema: Dict[str, Any], sample_data: list[dict]
) -> bool:
    if not chart_schema or not sample_data:
        return False

    fields = _schema_fields(chart_schema)
    if not fields:
        return False

    sample_fields = set(sample_data[0].keys())
    if not fields.issubset(sample_fields):
        return False

    for encoding in (chart_schema.get("encoding") or {}).values():
        if not isinstance(encoding, dict):
            continue
        if encoding.get("aggregate") == "count" and not encoding.get("field"):
            return False

    return True


def _column_names(data: Dict[str, Any]) -> list[str]:
    return [
        column.get("name", "") if isinstance(column, dict) else str(column)
        for column in data.get("columns", []) or []
        if column
    ]


def _row_records(columns: list[str], rows: list[Any]) -> list[dict]:
    records = []
    for row in rows:
        if isinstance(row, dict):
            records.append({column: row.get(column) for column in columns})
            continue
        if not isinstance(row, (list, tuple)):
            row = [row]
        records.append(
            {column: row[index] if index < len(row) else None for index, column in enumerate(columns)}
        )
    return records


def _is_numeric_column(column: str, records: list[dict]) -> bool:
    values = [record.get(column) for record in records if record.get(column) is not None]
    return bool(values) and all(isinstance(value, (int, float)) for value in values)


def _is_temporal_column(column: str, records: list[dict]) -> bool:
    if _TEMPORAL_NAME_PATTERN.search(column):
        return True
    values = [str(record.get(column)) for record in records[:5] if record.get(column)]
    return bool(values) and all(
        re.match(r"^\d{4}(-\d{2}){0,2}(?:[ T]\d{2}:\d{2}:\d{2})?", value)
        for value in values
    )


def _best_named_column(query: str, columns: list[str]) -> str | None:
    query_terms = _terms(query)
    scored = []
    for index, column in enumerate(columns):
        score = len(query_terms & _terms(column))
        mention_position = _column_mention_position(query, column)
        scored.append((score, -mention_position, -index, column))
    scored.sort(reverse=True)
    return scored[0][3] if scored else None


def _best_numeric_column(query: str, columns: list[str]) -> str:
    for column in columns:
        if _terms(column) & _MEASURE_TERMS:
            return column

    named = _best_named_column(query, columns)
    if named and len(_terms(named) & _terms(query)) > 0:
        return named
    return columns[0]


def _terms(value: str) -> set[str]:
    return {
        term.lower().rstrip("s")
        for term in re.findall(r"[A-Za-z][A-Za-z0-9]*", value or "")
        if len(term) >= 3
    }


def _encoding(field: str, field_type: str, title: str, **extra) -> dict:
    return {"field": field, "type": field_type, "title": title, **extra}


def _time_unit(query: str) -> str:
    normalized = (query or "").lower()
    if "year" in normalized:
        return "year"
    if "week" in normalized or "day" in normalized or "daily" in normalized:
        return "yearmonthdate"
    return "yearmonth"


def _count_title(query: str) -> str:
    volume_match = re.search(r"\b([A-Za-z][A-Za-z0-9]*)\s+volume\b", query or "", re.I)
    if volume_match:
        return f"{volume_match.group(1).title()} Count"
    return "Count"


def _count_encoding(query: str) -> dict:
    return {
        "aggregate": "count",
        "type": "quantitative",
        "title": _count_title(query),
    }


def _title(query: str) -> str:
    normalized = " ".join((query or "Chart").strip().split())
    return normalized[:120].rstrip(".")


def _chart_result(chart_type: str, chart_schema: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "reasoning": "Generated from the SQL result columns and requested chart type.",
        "chart_type": chart_type,
        "chart_schema": chart_schema,
    }


def _empty_chart_result(reasoning: str) -> Dict[str, Any]:
    return {"reasoning": reasoning, "chart_type": "", "chart_schema": {}}


def _schema_fields(chart_schema: Dict[str, Any]) -> set[str]:
    fields = set()
    for encoding in (chart_schema.get("encoding") or {}).values():
        if isinstance(encoding, dict) and encoding.get("field"):
            fields.add(encoding["field"])
    for transform in chart_schema.get("transform") or []:
        if isinstance(transform, dict):
            fields.update(transform.get("fold") or [])
    return fields


def _column_mention_position(query: str, column: str) -> int:
    query_terms = list(re.findall(r"[A-Za-z][A-Za-z0-9]*", query or ""))
    column_terms = _terms(column)
    for index, term in enumerate(query_terms):
        if term.lower().rstrip("s") in column_terms:
            return index
    return 10_000


def _group_field_from_each_clause(query: str, columns: list[str]) -> str | None:
    match = re.search(r"\beach\s+([A-Za-z][A-Za-z0-9]*)", query or "", re.I)
    if not match:
        return None

    each_term = match.group(1).lower().rstrip("s")
    for column in columns:
        if each_term in _terms(column):
            return column
    return None


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
