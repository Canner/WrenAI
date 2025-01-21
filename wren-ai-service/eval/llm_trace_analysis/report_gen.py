import asyncio
import json
import os
from datetime import datetime
from typing import List

from langfuse.client import TraceWithDetails

from .utils import filter_traces, get_all_traces, get_langfuse_client


def gen_report(
    traces: List[TraceWithDetails], trace_name: str, only_errors: bool = False
):
    def _get_output(trace: TraceWithDetails, trace_name: str):
        trace_url = os.getenv("LANGFUSE_HOST") + trace.html_path

        match trace_name:
            case "Prepare Semantics":
                return trace_url
            case "Ask Question":
                return trace_url
            case "Ask Details(Breakdown SQL)":
                return trace_url
            case "SQL Expansion":
                return trace_url
            case "SQL Answer":
                return trace_url
            case "Generate Semantics Description":
                return trace_url
            case "Generate Relationship Recommendation":
                return trace_url
            case "Generate Chart":
                return trace_url
            case "Adjust Chart":
                return trace_url
            case "Generate Question Recommendation":
                return trace_url
            case _:
                return None

    if only_errors:
        valid_traces = []
        for trace in traces:
            try:
                output_data = json.loads(trace.output)
            except (json.JSONDecodeError, TypeError):
                continue

            if output_data.get("metadata", {}).get("error_type", ""):
                valid_traces.append(_get_output(trace, trace_name))
        return valid_traces
    else:
        return [_get_output(trace, trace_name) for trace in traces]


def save_report(report_by_release: dict):
    if not report_by_release:
        raise ValueError("Empty report data")

    output_dir = "outputs"
    os.makedirs(output_dir, exist_ok=True)

    output_file = os.path.join(
        output_dir, f"report_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.json"
    )

    try:
        with open(output_file, "w") as f:
            json.dump(report_by_release, f)
    except IOError as e:
        raise RuntimeError(f"Failed to save report: {e}")


async def main():
    RELEASES = ["0.15.4", "0.15.3", "0.14.2"]
    TRACE_NAMES = [
        # indexing
        "Prepare Semantics",
        # text2sql
        "Ask Question",
        "Ask Details(Breakdown SQL)",
        "SQL Expansion",
        "SQL Answer",
        # context enrichment
        "Generate Semantics Description",
        "Generate Relationship Recommendation",
        # chart
        "Generate Chart",
        "Adjust Chart",
        # others
        "Generate Question Recommendation",
    ]
    ONLY_ERRORS = True
    traces_by_release = {}
    report_by_release = {}

    client = get_langfuse_client()

    # Use asyncio.gather to fetch traces for all releases concurrently
    _traces_by_release = await asyncio.gather(
        *[get_all_traces(client, release=release) for release in RELEASES]
    )

    # Print results for each release
    for release, traces in zip(RELEASES, _traces_by_release):
        traces_by_release[release] = {
            trace_name: filter_traces(traces, [trace_name])
            for trace_name in TRACE_NAMES
        }

    for release, traces in traces_by_release.items():
        for trace_name, trace_group in traces.items():
            print(f"Release: {release}, Trace Name: {trace_name}")
            if release not in report_by_release:
                report_by_release[release] = {}

            report_by_release[release][trace_name] = gen_report(
                trace_group,
                trace_name,
                only_errors=ONLY_ERRORS,
            )

    save_report(report_by_release)


if __name__ == "__main__":
    asyncio.run(main())
