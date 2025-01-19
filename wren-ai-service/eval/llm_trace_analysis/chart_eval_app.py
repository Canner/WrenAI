import asyncio
import os
from typing import Any, Dict, List

import orjson
import pytz
import streamlit as st
from utils import (
    ObservationsView,
    TraceWithDetails,
    get_all_observations,
    get_all_traces,
    get_langfuse_client,
)


def match(
    traces: List[TraceWithDetails],
    observations: List[ObservationsView],
    spans: List[TraceWithDetails],
) -> List[ObservationsView]:
    filtered_traces = []
    filtered_spans = []
    _id = 0
    for observation in observations:
        while observation.parent_observation_id != spans[_id].id:
            _id += 1
        filtered_spans.append(spans[_id])
        filtered_traces.append(traces[_id])
        _id += 1

    return filtered_traces, filtered_spans, observations


def get_chart_data(
    chart_traces: List[TraceWithDetails],
    chart_spans: List[ObservationsView],
    char_observations: List[ObservationsView],
    project_id: str = "",
    chart_types: set[str] = set(),
    llms: set[str] = set(),
    skip_empty_chart: bool = False,
) -> List[Dict[str, Any]]:
    chart_data = []
    tz = pytz.timezone("Asia/Taipei")

    for chart_trace, chart_span, chart_observation in zip(
        *match(chart_traces, char_observations, chart_spans)
    ):
        try:
            chart_output = orjson.loads(chart_observation.output["replies"][0])

            if project_id and project_id != str(chart_trace.metadata["project_id"]):
                continue
            if chart_types and chart_output.get("chart_type", "") not in chart_types:
                continue
            if llms and chart_observation.output["meta"][0]["model"] not in llms:
                continue
            if skip_empty_chart and not chart_output.get("chart_schema", ""):
                continue

            chart_data.append(
                {
                    "project_id": chart_trace.metadata["project_id"],
                    "start_time": chart_span.start_time.astimezone(tz),
                    "latency": (
                        chart_span.end_time - chart_span.start_time
                    ).total_seconds(),
                    "url": f'{os.getenv("LANGFUSE_HOST")}/project/{chart_span.projectId}/traces/{chart_span.trace_id}?observation={chart_span.id}',
                    "query": chart_span.input["kwargs"]["query"],
                    "sql": chart_span.input["kwargs"]["sql"],
                    "reasoning": chart_output.get("reasoning", ""),
                    "chart_type": chart_output.get("chart_type", ""),
                    "chart_schema": chart_output.get("chart_schema", ""),
                    "llm": chart_observation.output["meta"][0]["model"],
                }
            )
        except Exception:
            continue

    return chart_data


def on_change_project_id():
    st.session_state["project_id"] = st.session_state["project_id_input"]


def on_change_chart_types():
    st.session_state["chart_types"] = set(st.session_state["chart_types_input"])


def on_change_llms():
    st.session_state["llms"] = set(st.session_state["llms_input"])


def on_change_skip_empty_chart():
    st.session_state["skip_empty_chart"] = st.session_state["skip_empty_chart_input"]


def load_more():
    st.session_state["load_num"] += 10


async def get_chart_traces_spans_and_observations():
    client = get_langfuse_client()
    chart_traces, chart_spans, chart_observations = await asyncio.gather(
        get_all_traces(
            client,
            name="Generate Chart",
        ),
        get_all_observations(
            client,
            name="Chart Generation",
            type="SPAN",
        ),
        get_all_observations(
            client,
            name="generate_chart",
            type="GENERATION",
        ),
    )

    return chart_traces, chart_spans, chart_observations


async def main():
    st.set_page_config(layout="wide")
    st.title("Chart Evaluation")

    if "chart_traces" not in st.session_state:
        st.session_state["chart_traces"] = []
    if "chart_spans" not in st.session_state:
        st.session_state["chart_spans"] = []
    if "chart_observations" not in st.session_state:
        st.session_state["chart_observations"] = []
    if "load_num" not in st.session_state:
        st.session_state["load_num"] = 10
    if "project_id" not in st.session_state:
        st.session_state["project_id"] = ""
    if "chart_types" not in st.session_state:
        st.session_state["chart_types"] = set()
    if "llms" not in st.session_state:
        st.session_state["llms"] = set()
    if "skip_empty_chart" not in st.session_state:
        st.session_state["skip_empty_chart"] = False

    if (
        not st.session_state["chart_traces"]
        or not st.session_state["chart_spans"]
        or not st.session_state["chart_observations"]
    ):
        (
            chart_traces,
            chart_spans,
            chart_observations,
        ) = await get_chart_traces_spans_and_observations()
        st.session_state["chart_traces"] = chart_traces
        st.session_state["chart_spans"] = chart_spans
        st.session_state["chart_observations"] = chart_observations

    st.text_input(
        "Enter project_id",
        key="project_id_input",
        value=st.session_state["project_id"],
        on_change=on_change_project_id,
    )

    st.multiselect(
        "Select chart types",
        options=[
            "line",
            "multi_line",
            "bar",
            "stacked_bar",
            "grouped_bar",
            "pie",
            "area",
        ],
        key="chart_types_input",
        default=st.session_state["chart_types"],
        on_change=on_change_chart_types,
    )

    st.multiselect(
        "Select LLMs",
        options=[
            "gpt-4o",
            "gpt-4o-2024-08-06",
            "gpt-4o-mini",
            "gpt-4o-mini-2024-07-18",
        ],
        key="llms_input",
        default=st.session_state["llms"],
        on_change=on_change_llms,
    )

    st.checkbox(
        "Skip empty chart",
        key="skip_empty_chart_input",
        value=st.session_state["skip_empty_chart"],
        on_change=on_change_skip_empty_chart,
    )

    chart_data = get_chart_data(
        st.session_state["chart_traces"],
        st.session_state["chart_spans"],
        st.session_state["chart_observations"],
        project_id=st.session_state["project_id"],
        chart_types=st.session_state["chart_types"],
        llms=st.session_state["llms"],
        skip_empty_chart=st.session_state["skip_empty_chart"],
    )

    for i, row in enumerate(chart_data[: st.session_state["load_num"]]):
        st.markdown(f"## {i + 1}")
        col1, col2 = st.columns(2)
        chart_schema = row["chart_schema"]
        del row["chart_schema"]
        with col1:
            st.table(row)
        with col2:
            if chart_schema:
                st.markdown("### Vega-Lite Chart")
                st.markdown("Chart Schema")
                st.json(chart_schema, expanded=False)
                st.markdown("Chart")
                st.vega_lite_chart(chart_schema, use_container_width=True)
        st.divider()

    st.button("Load More", on_click=load_more, use_container_width=True)


if __name__ == "__main__":
    asyncio.run(main())
