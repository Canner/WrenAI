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


def _humanize_title(name: str | None) -> str:
    text = str(name or "")
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", text)
    text = re.sub(r"[_\s]+", " ", text)
    return text.strip().title()


def _detect_requested_chart_type(query: str | None) -> str:
    normalized = (query or "").lower()
    checks = [
        ("grouped_bar", ["grouped bar"]),
        ("stacked_bar", ["stacked bar"]),
        ("multi_line", ["multi line", "multi-line"]),
        ("line", ["line chart", "line graph", "line plot"]),
        ("bar", ["bar chart", "bar graph", "column chart"]),
        ("bar", ["waterfall", "waterfall chart"]),
        ("pie", ["pie chart", "donut chart", "doughnut chart"]),
        ("area", ["area chart", "area graph"]),
    ]
    for chart_type, patterns in checks:
        if any(pattern in normalized for pattern in patterns):
            return chart_type
    if re.search(r"\b(chart|graph|plot|visuali[sz](?:e|ation)?)\b", normalized):
        return "bar"
    return ""


def _safe_column_names(columns: list[Any]) -> list[str]:
    return [str(column) for column in columns if column is not None and str(column)]


def _normalize_identifier(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _identifier_tokens(value: str | None) -> set[str]:
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", str(value or ""))
    return {
        token
        for token in re.split(r"[^a-zA-Z0-9]+", text.lower())
        if len(token) > 1
    }


def _query_relevant_columns(query: str | None, columns: list[str]) -> list[str]:
    normalized_query = str(query or "").lower()
    compact_query = _normalize_identifier(normalized_query)
    query_tokens = _identifier_tokens(normalized_query)

    scored_columns: list[tuple[int, int, str]] = []
    for index, column in enumerate(columns):
        tokens = _identifier_tokens(column)
        compact_column = _normalize_identifier(column)
        score = 0

        if compact_column and compact_column in compact_query:
            score += 100

        matched_tokens = tokens.intersection(query_tokens)
        score += len(matched_tokens) * 20

        # Prefer multi-word business dimensions that the user explicitly asks
        # for, e.g. "Business Unit" matching BusinessUnit.
        if tokens and tokens.issubset(query_tokens):
            score += 40

        if score:
            scored_columns.append((-score, index, column))

    return [column for _, _, column in sorted(scored_columns)]


def _select_measure_column(query: str | None, quantitative: list[str]) -> str | None:
    if not quantitative:
        return None

    relevant = _query_relevant_columns(query, quantitative)
    if relevant:
        return relevant[0]

    metric_keywords = (
        "count",
        "total",
        "sum",
        "amount",
        "value",
        "volume",
        "order",
        "sales",
        "revenue",
        "quantity",
        "workload",
        "throughput",
        "failure",
        "repair",
    )
    for column in quantitative:
        normalized = str(column).lower()
        if any(keyword in normalized for keyword in metric_keywords):
            return column

    return quantitative[0]


def _count_axis_title(query: str | None) -> str:
    normalized = str(query or "").lower()
    if "new order" in normalized:
        return "New Orders Count"
    if "order" in normalized:
        return "Order Count"
    if "repair" in normalized:
        return "Repair Count"
    if "failure" in normalized:
        return "Failure Count"
    if "ticket" in normalized:
        return "Ticket Count"
    return "Count"


def _wants_time_axis(query: str | None, chart_type: str) -> bool:
    normalized = str(query or "").lower()
    time_pattern = (
        r"\b(trend|over time|timeline|monthly|weekly|daily|yearly|"
        r"by month|by week|by day|by year)\b"
    )
    return chart_type in {"line", "area", "multi_line"} or bool(
        re.search(time_pattern, normalized)
    )


def _select_dimension_columns(
    query: str | None,
    chart_type: str,
    nominal: list[str],
    temporal: list[str],
    columns: list[str],
) -> list[str]:
    relevant = _query_relevant_columns(query, columns)
    relevant_nominal = [column for column in relevant if column in nominal]
    relevant_temporal = [column for column in relevant if column in temporal]

    if _wants_time_axis(query, chart_type):
        ordered = relevant_temporal + [
            column for column in temporal if column not in relevant_temporal
        ]
        ordered += relevant_nominal + [
            column for column in nominal if column not in relevant_nominal
        ]
        return ordered

    ordered = relevant_nominal + [
        column for column in nominal if column not in relevant_nominal
    ]
    ordered += relevant_temporal + [
        column for column in temporal if column not in relevant_temporal
    ]
    return ordered


def _refine_chart_type_for_columns(
    query: str | None,
    chart_type: str,
    sample_data: list[dict],
) -> str:
    if chart_type != "bar" or not sample_data:
        return chart_type

    columns = _safe_column_names(list(sample_data[0].keys()))
    inferred = _infer_column_types(sample_data)
    dimensions = _select_dimension_columns(
        query, chart_type, inferred["nominal"], inferred["temporal"], columns
    )
    if len([column for column in dimensions if column in inferred["nominal"]]) > 1:
        return "grouped_bar"

    return chart_type


def _match_column_name(field: str | None, columns: list[str]) -> str:
    if field is None:
        return ""
    field = str(field)
    columns = _safe_column_names(columns)
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

    for key in ("x", "y", "x2", "y2", "color", "xOffset", "theta"):
        axis = encoding.get(key)
        if isinstance(axis, dict) and axis.get("field"):
            axis["field"] = _match_column_name(axis["field"], columns)

    for transform in normalized.get("transform", []) or []:
        if isinstance(transform, dict) and isinstance(transform.get("fold"), list):
            transform["fold"] = [
                _match_column_name(field, columns)
                for field in transform["fold"]
                if field is not None
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
        if column is None or not str(column):
            continue

        values = df[column].dropna()
        if values.empty:
            continue

        column_name = str(column).lower()
        numeric_values = pd.to_numeric(
            values.astype(str).str.replace(",", "", regex=False),
            errors="coerce",
        )
        is_temporal_name = bool(
            re.search(r"(date|time|month|year|day|created|updated)", column_name)
        )
        string_values = values.astype(str)
        looks_temporal = string_values.str.match(
            r"^\d{4}[-/]\d{1,2}([-/]\d{1,2})?"
        ).all()
        temporal_values = (
            pd.to_datetime(values, errors="coerce")
            if is_temporal_name or looks_temporal
            else None
        )

        if numeric_values.notna().all() and not is_temporal_name:
            quantitative.append(str(column))
        elif is_temporal_name or (
            temporal_values is not None and temporal_values.notna().all()
        ):
            temporal.append(str(column))
        else:
            nominal.append(str(column))

    return {
        "quantitative": quantitative,
        "temporal": temporal,
        "nominal": nominal,
    }


def _chart_mark_type(chart_schema: dict) -> str:
    mark = chart_schema.get("mark", {})
    if isinstance(mark, str):
        return mark
    if isinstance(mark, dict):
        return str(mark.get("type") or "")
    return ""


def _chart_type_from_schema(chart_schema: dict, default: str = "") -> str:
    mark_type = _chart_mark_type(chart_schema)
    encoding = chart_schema.get("encoding", {})

    if mark_type == "arc":
        return "pie"
    if mark_type == "area":
        return "area"
    if mark_type == "line":
        return "multi_line" if chart_schema.get("transform") else "line"
    if mark_type == "bar":
        if encoding.get("xOffset"):
            return "grouped_bar"
        if isinstance(encoding.get("y"), dict) and encoding["y"].get("stack"):
            return "stacked_bar"
        return "bar"

    return default


def _is_quantitative_encoding(axis: Any) -> bool:
    return isinstance(axis, dict) and axis.get("type") == "quantitative"


def _is_categorical_encoding(axis: Any) -> bool:
    return isinstance(axis, dict) and axis.get("type") in {
        "nominal",
        "ordinal",
        "temporal",
    }


def _fallback_chart_type(
    requested_chart_type: str,
    quantitative: list[str],
    temporal: list[str],
    nominal: list[str],
) -> str:
    if not quantitative:
        return ""

    chart_type = requested_chart_type or "bar"

    if chart_type == "pie":
        return "pie" if nominal else ""

    if chart_type in {"line", "area", "multi_line"}:
        return chart_type if temporal or nominal else ""

    if chart_type in {"grouped_bar", "stacked_bar"}:
        return chart_type if len(nominal) > 1 else ""

    return "bar" if nominal or temporal else ""


def _build_fallback_chart_schema(
    query: str | None,
    chart_type: str,
    sample_data: list[dict],
) -> dict:
    if not sample_data:
        return {}

    columns = _safe_column_names(list(sample_data[0].keys()))
    if not columns:
        return {}
    inferred = _infer_column_types(sample_data)
    quantitative = inferred["quantitative"]
    temporal = inferred["temporal"]
    nominal = inferred["nominal"]
    chart_type = _fallback_chart_type(chart_type, quantitative, temporal, nominal)
    if not chart_type:
        return {}

    dimensions = _select_dimension_columns(
        query, chart_type, nominal, temporal, columns
    )
    measure = _select_measure_column(query, quantitative)
    if not measure:
        return {}

    title = _humanize_title(query or "Chart")

    def axis(field: str, field_type: str) -> dict:
        base = {"field": field, "type": field_type, "title": _humanize_title(field)}
        if field_type == "temporal":
            base["timeUnit"] = "yearmonth"
        return base

    if chart_type == "pie":
        color_field = dimensions[0] if dimensions else columns[0]
        return {
            "title": title,
            "mark": {"type": "arc"},
            "encoding": {
                "theta": axis(measure, "quantitative"),
                "color": axis(color_field, "nominal"),
            },
        }

    if chart_type in {"line", "area", "multi_line"}:
        y_encoding = axis(measure, "quantitative")
        if {"year", "month"}.issubset({str(c).lower() for c in columns}):
            month_field = next(c for c in columns if str(c).lower() == "month")
            encoding = {
                "x": axis(month_field, "ordinal"),
                "y": y_encoding,
            }
            years = [c for c in columns if str(c).lower() == "year"]
            if years:
                encoding["color"] = axis(years[0], "nominal")
            return {
                "title": title,
                "mark": {"type": "area" if chart_type == "area" else "line"},
                "encoding": encoding,
            }

        x_field = dimensions[0] if dimensions else columns[0]
        x_type = "temporal" if x_field in temporal else "ordinal"
        encoding = {
            "x": axis(x_field, x_type),
            "y": y_encoding,
        }
        series_field = next(
            (column for column in dimensions[1:] if column in nominal),
            None,
        )
        if series_field:
            encoding["color"] = axis(series_field, "nominal")
        return {
            "title": title,
            "mark": {"type": "area" if chart_type == "area" else "line"},
            "encoding": encoding,
        }

    x_field = dimensions[0] if dimensions else columns[0]
    x_type = (
        "nominal"
        if x_field in nominal
        else ("temporal" if x_field in temporal else "ordinal")
    )
    y_encoding = axis(measure, "quantitative")
    encoding = {
        "x": axis(x_field, x_type),
        "y": y_encoding,
    }
    comparison_field = next(
        (column for column in dimensions[1:] if column in nominal),
        None,
    )
    if comparison_field:
        encoding["color"] = axis(comparison_field, "nominal")
        nominal_dimension_count = len([c for c in dimensions if c in nominal])
        if chart_type == "grouped_bar" or nominal_dimension_count > 1:
            encoding["xOffset"] = axis(comparison_field, "nominal")
    elif x_field in nominal:
        encoding["color"] = axis(x_field, "nominal")

    mark = {"type": "bar"}
    if chart_type == "stacked_bar":
        encoding["y"]["stack"] = "zero"

    return {
        "title": title,
        "mark": mark,
        "encoding": encoding,
    }


def build_fallback_chart_result(
    query: str | None,
    data: Dict[str, Any],
    remove_data_from_chart_schema: bool = True,
) -> dict:
    processed = ChartDataPreprocessor().run(data)
    sample_data = processed.get("sample_data", [])
    chart_type = _detect_requested_chart_type(query) or "bar"
    chart_type = _refine_chart_type_for_columns(query, chart_type, sample_data)
    chart_schema = _build_fallback_chart_schema(query, chart_type, sample_data)
    if not chart_schema:
        return {
            "chart_schema": {},
            "reasoning": "",
            "chart_type": "",
        }
    chart_type = _chart_type_from_schema(chart_schema, chart_type)

    chart_schema["$schema"] = "https://vega.github.io/schema/vega-lite/v5.json"
    chart_schema["data"] = {"values": sample_data}
    if remove_data_from_chart_schema:
        chart_schema["data"]["values"] = []

    return {
        "chart_schema": chart_schema,
        "reasoning": "Generated from the SQL result columns and requested chart type.",
        "chart_type": chart_type,
    }


def _is_schema_compatible_with_sample_data(
    chart_schema: dict,
    sample_data: list[dict],
) -> bool:
    if not chart_schema or not sample_data:
        return False

    columns = set(_safe_column_names(list(sample_data[0].keys())))
    inferred = _infer_column_types(sample_data)
    quantitative = set(inferred["quantitative"])
    temporal = set(inferred["temporal"])
    nominal = set(inferred["nominal"])
    categorical = nominal | temporal
    encoding = chart_schema.get("encoding", {})
    for key in ("x", "y", "x2", "y2", "color", "xOffset", "theta"):
        axis = encoding.get(key)
        if isinstance(axis, dict) and axis.get("aggregate"):
            return False
        field = axis.get("field") if isinstance(axis, dict) else None
        if field and str(field) not in columns:
            return False

        if (
            field
            and _is_quantitative_encoding(axis)
            and str(field) not in quantitative
        ):
            return False

        if field and key in {"color", "xOffset"} and str(field) not in categorical:
            return False

    for transform in chart_schema.get("transform", []) or []:
        if isinstance(transform, dict):
            for field in transform.get("fold", []) or []:
                if field is not None and str(field) not in columns:
                    return False

    mark_type = _chart_mark_type(chart_schema)
    x_axis = encoding.get("x")
    y_axis = encoding.get("y")
    theta_axis = encoding.get("theta")
    has_quantitative_measure = any(
        _is_quantitative_encoding(axis)
        for axis in (x_axis, y_axis, theta_axis)
    )

    if mark_type == "arc":
        return _is_quantitative_encoding(theta_axis) and _is_categorical_encoding(
            encoding.get("color")
        )

    if mark_type in {"bar", "line", "area"}:
        return has_quantitative_measure and (
            _is_categorical_encoding(x_axis) or _is_categorical_encoding(y_axis)
        )

    return True


def _needs_deterministic_bar_fallback(
    chart_schema: dict,
    chart_type: str,
    sample_data: list[dict],
) -> bool:
    if chart_type not in {"bar", "grouped_bar", "stacked_bar"}:
        return False
    if not sample_data:
        return False

    encoding = chart_schema.get("encoding", {}) if chart_schema else {}

    # Reject range-style bar encodings for simple grouped-count datasets.
    for key in ("x2", "y2"):
        axis = encoding.get(key)
        if isinstance(axis, dict) and axis.get("field"):
            return True

    for axis_name in ("x", "y", "color", "xOffset", "theta"):
        axis = encoding.get(axis_name)
        if not isinstance(axis, dict):
            continue
        field = axis.get("field", "")
        if isinstance(field, str) and (
            field.endswith("_start") or field.endswith("_end")
        ):
            return True

    inferred = _infer_column_types(sample_data)
    quantitative = inferred["quantitative"]
    nominal = inferred["nominal"]

    # For the common case "category + count", prefer a deterministic bar spec
    # if the model did not produce a usable quantitative y axis.
    if len(quantitative) == 1 and len(nominal) >= 1:
        y_axis = encoding.get("y")
        x_axis = encoding.get("x")
        if not isinstance(y_axis, dict) or y_axis.get("field") not in quantitative:
            return True
        if not isinstance(x_axis, dict) or x_axis.get("field") not in nominal:
            return True

    if len(quantitative) == 0 and len(nominal) >= 1:
        return True

    return False


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
- Do not use Vega-Lite aggregate count or calculate new measures in the chart schema. The SQL must return the metric column, and the chart must encode that returned metric field.

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
        columns = []
        for index, column in enumerate(data.get("columns", [])):
            if isinstance(column, dict):
                column_name = str(column.get("name") or "").strip()
            else:
                column_name = str(column or "").strip()
            columns.append(column_name or f"column_{index + 1}")
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

                if (
                    not _is_schema_compatible_with_sample_data(chart_schema, sample_data)
                    or _needs_deterministic_bar_fallback(
                        chart_schema, chart_type or "", sample_data
                    )
                ):
                    chart_schema = _build_fallback_chart_schema(
                        query, chart_type or "bar", sample_data
                    )
                    chart_type = _chart_type_from_schema(chart_schema, chart_type)

                if not chart_schema:
                    return {
                        "results": {
                            "chart_schema": {},
                            "reasoning": reasoning,
                            "chart_type": "",
                        }
                    }

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

            fallback_schema = _build_fallback_chart_schema(
                query, chart_type or "bar", sample_data
            )
            fallback_chart_type = _chart_type_from_schema(fallback_schema, chart_type)
            if not fallback_schema:
                fallback_chart_type = ""

            return {
                "results": {
                    "chart_schema": fallback_schema,
                    "reasoning": reasoning,
                    "chart_type": fallback_chart_type,
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
                    "chart_type": _chart_type_from_schema(
                        fallback_schema, _detect_requested_chart_type(query) or ""
                    )
                    if fallback_schema
                    else "",
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
                    "chart_type": _chart_type_from_schema(
                        fallback_schema, fallback_chart_type
                    )
                    if fallback_schema
                    else "",
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
