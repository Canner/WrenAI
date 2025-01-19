import asyncio
import os
from typing import Any, Dict, List

import orjson
import streamlit as st
from utils import (
    ObservationsView,
    TraceWithDetails,
    get_all_observations,
    get_langfuse_client,
)


def get_parent_chart_observations(
    observations: List[ObservationsView],
    chart_spans: List[TraceWithDetails],
) -> List[ObservationsView]:
    filtered_chart_spans = []
    chart_span_id = 0
    for observation in observations:
        while observation.parent_observation_id != chart_spans[chart_span_id].id:
            chart_span_id += 1
        filtered_chart_spans.append(chart_spans[chart_span_id])
        chart_span_id += 1

    return filtered_chart_spans


def get_chart_data(
    chart_spans: List[TraceWithDetails],
    observations: List[ObservationsView],
) -> List[Dict[str, Any]]:
    filtered_chart_spans = get_parent_chart_observations(
        observations,
        chart_spans,
    )

    chart_data = []
    for chart_span, chart_observation in zip(filtered_chart_spans, observations):
        try:
            chart_output = orjson.loads(chart_observation.output["replies"][0])
            chart_data.append(
                {
                    "start_time": chart_span.start_time,
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


def load_more():
    st.session_state["load_num"] += 10


async def main():
    st.set_page_config(layout="wide")
    st.title("Chart Evaluation")

    if "load_num" not in st.session_state:
        st.session_state["load_num"] = 10

    client = get_langfuse_client()
    generate_chart_spans, generate_chart_observations = await asyncio.gather(
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

    chart_data = get_chart_data(
        generate_chart_spans,
        generate_chart_observations,
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
