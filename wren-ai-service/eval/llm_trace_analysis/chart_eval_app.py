import asyncio
import os
import time
from typing import Any, Dict, List, Tuple

import orjson
import pytz
import requests
import streamlit as st
from utils import (
    ObservationsView,
    TraceWithDetails,
    get_all_observations,
    get_all_traces,
    get_langfuse_client,
)


def match_traces_spans_observations(
    traces: List[TraceWithDetails],
    observations: List[ObservationsView],
    spans: List[TraceWithDetails],
) -> Tuple[List[TraceWithDetails], List[TraceWithDetails], List[ObservationsView]]:
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
    chart_observations: List[ObservationsView],
    query: str = "",
    release: str = "",
    project_id: str = "",
    chart_types: set[str] = set(),
    llms: set[str] = set(),
    skip_empty_chart: bool = False,
    only_empty_chart: bool = False,
) -> List[Dict[str, Any]]:
    chart_data = []
    tz = pytz.timezone("Asia/Taipei")

    for chart_trace, chart_span, chart_observation in zip(
        *match_traces_spans_observations(chart_traces, chart_observations, chart_spans)
    ):
        try:
            chart_output = orjson.loads(chart_observation.output["replies"][0])
            chart_trace_input = orjson.loads(chart_trace.input)

            if query and query != chart_span.input["kwargs"]["query"]:
                continue
            if project_id and project_id != str(chart_trace.metadata["project_id"]):
                continue
            if chart_types and chart_output.get("chart_type", "") not in chart_types:
                continue
            if llms and chart_observation.output["meta"][0]["model"] not in llms:
                continue
            if skip_empty_chart and not chart_output.get("chart_schema", ""):
                continue
            if only_empty_chart and chart_output.get("chart_schema", {}):
                continue
            if release and release != str(
                chart_trace_input["kwargs"]["service_metadata"]["service_version"]
            ):
                continue

            chart_data.append(
                {
                    "project_id": chart_trace.metadata["project_id"],
                    "timestamp": chart_trace.timestamp.astimezone(tz),
                    "latency": chart_trace.latency,
                    "url": f'{os.getenv("LANGFUSE_HOST")}/project/{chart_span.projectId}/traces/{chart_span.trace_id}?observation={chart_span.id}',
                    "query": chart_span.input["kwargs"]["query"],
                    "sql": chart_span.input["kwargs"]["sql"],
                    "data": chart_span.input["kwargs"]["data"]["results"],
                    "reasoning": chart_output.get("reasoning", ""),
                    "chart_type": chart_output.get("chart_type", ""),
                    "chart_schema": chart_output.get("chart_schema", ""),
                    "llm": chart_observation.output["meta"][0]["model"],
                    "version": chart_trace_input["kwargs"]["service_metadata"][
                        "service_version"
                    ],
                }
            )
        except Exception:
            continue

    return chart_data


def on_change_query():
    st.session_state["query"] = st.session_state["query_input"]
    st.session_state["load_num_start_idx"] = 0


def on_change_release():
    st.session_state["release"] = st.session_state["release_input"]
    st.session_state["load_num_start_idx"] = 0


def on_change_project_id():
    st.session_state["project_id"] = st.session_state["project_id_input"]
    st.session_state["load_num_start_idx"] = 0


def on_change_chart_types():
    st.session_state["chart_types"] = set(st.session_state["chart_types_input"])
    st.session_state["load_num_start_idx"] = 0


def on_change_llms():
    st.session_state["llms"] = set(st.session_state["llms_input"])
    st.session_state["load_num_start_idx"] = 0


def on_change_language():
    st.session_state["language"] = st.session_state["language_input"]
    st.session_state["load_num_start_idx"] = 0


def on_change_skip_empty_chart():
    st.session_state["skip_empty_chart"] = st.session_state["skip_empty_chart_input"]
    st.session_state["load_num_start_idx"] = 0


def on_change_only_empty_chart():
    st.session_state["only_empty_chart"] = st.session_state["only_empty_chart_input"]
    st.session_state["load_num_start_idx"] = 0


def rerun_chart_generation(chart_data: Dict[str, Any], language: str):
    POLLING_INTERVAL = 0.5

    chart_response = requests.post(
        f"{os.getenv('WREN_AI_SERVICE_BASE_URL', 'http://localhost:5556')}/v1/charts",
        json={
            "query": chart_data["query"],
            "sql": chart_data["sql"],
            "data": chart_data["data"],
            "remove_data_from_chart_schema": False,
            "configurations": {
                "language": language,
            },
        },
    )

    assert chart_response.status_code == 200
    query_id = chart_response.json()["query_id"]
    charts_status = None

    while not charts_status or (
        charts_status != "finished"
        and charts_status != "failed"
        and charts_status != "stopped"
    ):
        charts_status_response = requests.get(
            f"{os.getenv('WREN_AI_SERVICE_BASE_URL', 'http://localhost:5556')}/v1/charts/{query_id}"
        )
        assert charts_status_response.status_code == 200
        charts_status = charts_status_response.json()["status"]
        time.sleep(POLLING_INTERVAL)

    chart_generation_result = charts_status_response.json()
    st.session_state["rerun_chart_data_results"][chart_data["url"]] = {
        "reasoning": chart_generation_result["response"]["reasoning"],
        "chart_type": chart_generation_result["response"]["chart_type"],
        "chart_schema": chart_generation_result["response"]["chart_schema"],
    }


def load_last_chart_data(num: int):
    st.session_state["load_num_start_idx"] -= num


def load_next_chart_data(num: int):
    st.session_state["load_num_start_idx"] += num


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
    if "load_num_start_idx" not in st.session_state:
        st.session_state["load_num_start_idx"] = 0
    if "query" not in st.session_state:
        st.session_state["query"] = ""
    if "project_id" not in st.session_state:
        st.session_state["project_id"] = ""
    if "chart_types" not in st.session_state:
        st.session_state["chart_types"] = set()
    if "llms" not in st.session_state:
        st.session_state["llms"] = set()
    if "language" not in st.session_state:
        st.session_state["language"] = "English"
    if "skip_empty_chart" not in st.session_state:
        st.session_state["skip_empty_chart"] = False
    if "only_empty_chart" not in st.session_state:
        st.session_state["only_empty_chart"] = False
    if "release" not in st.session_state:
        st.session_state["release"] = ""
    if "rerun_chart_data_results" not in st.session_state:
        st.session_state["rerun_chart_data_results"] = {}

    LOAD_NUM = 10

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
        "Enter query",
        key="query_input",
        value=st.session_state["query"],
        on_change=on_change_query,
    )

    st.text_input(
        "Enter release",
        key="release_input",
        value=st.session_state["release"],
        on_change=on_change_release,
    )

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

    available_languages = [
        "English",
        "Traditional Chinese",
        "Simplified Chinese",
        "Spanish",
        "French",
        "German",
        "Portuguese",
        "Russian",
        "Japanese",
        "Korean",
    ]
    st.selectbox(
        "Select chart-rerun output language",
        index=available_languages.index(st.session_state["language"]),
        options=available_languages,
        key="language_input",
        on_change=on_change_language,
    )

    st.checkbox(
        "Skip empty chart",
        key="skip_empty_chart_input",
        value=st.session_state["skip_empty_chart"],
        on_change=on_change_skip_empty_chart,
        disabled=st.session_state["only_empty_chart"],
    )

    st.checkbox(
        "Only empty chart",
        key="only_empty_chart_input",
        value=st.session_state["only_empty_chart"],
        on_change=on_change_only_empty_chart,
        disabled=st.session_state["skip_empty_chart"],
    )

    chart_data = get_chart_data(
        st.session_state["chart_traces"],
        st.session_state["chart_spans"],
        st.session_state["chart_observations"],
        query=st.session_state["query"],
        release=st.session_state["release"],
        project_id=st.session_state["project_id"],
        chart_types=st.session_state["chart_types"],
        llms=st.session_state["llms"],
        skip_empty_chart=st.session_state["skip_empty_chart"],
        only_empty_chart=st.session_state["only_empty_chart"],
    )

    st.markdown(f"Total number of chart data: {len(chart_data)}")

    if st.session_state["load_num_start_idx"]:
        st.button(
            f"Load last {LOAD_NUM} chart data",
            on_click=load_last_chart_data,
            use_container_width=True,
            kwargs={"num": LOAD_NUM},
        )

    for i, row in enumerate(
        chart_data[
            st.session_state["load_num_start_idx"] : st.session_state[
                "load_num_start_idx"
            ]
            + LOAD_NUM
        ]
    ):
        st.markdown(f"## {st.session_state['load_num_start_idx'] + i + 1}")
        col1, col2 = st.columns(2)
        copied_row = row.copy()
        chart_schema = row["chart_schema"]
        del row["chart_schema"]
        del row["data"]

        with col1:
            st.table(row)
            st.button(
                "Rerun Chart Generation",
                key=f"rerun_chart_generation_{i}",
                on_click=rerun_chart_generation,
                kwargs={
                    "chart_data": copied_row,
                    "language": st.session_state["language"],
                },
            )
        with col2:
            if chart_schema:
                st.markdown("### Vega-Lite Chart")
                st.markdown("Chart Schema")
                st.json(chart_schema, expanded=False)
                st.markdown("Chart")
                st.vega_lite_chart(chart_schema, use_container_width=True)

        if rerun_chart_data_results := st.session_state["rerun_chart_data_results"].get(
            row["url"]
        ):
            _col1, _col2 = st.columns(2)

            _rerun_chart_data_results = rerun_chart_data_results.copy()
            if "chart_schema" in _rerun_chart_data_results:
                del _rerun_chart_data_results["chart_schema"]

            with _col1:
                st.table(_rerun_chart_data_results)
            with _col2:
                if rerun_chart_schema := rerun_chart_data_results.get("chart_schema"):
                    st.markdown("Chart Schema")
                    st.json(rerun_chart_schema, expanded=False)
                    st.markdown("Chart")
                    st.vega_lite_chart(rerun_chart_schema, use_container_width=True)

        st.divider()

    if st.session_state["load_num_start_idx"] + LOAD_NUM < len(chart_data):
        st.button(
            f"Load next {LOAD_NUM} chart data",
            on_click=load_next_chart_data,
            use_container_width=True,
            kwargs={"num": LOAD_NUM},
        )


if __name__ == "__main__":
    asyncio.run(main())
