import asyncio
import json
import os
from datetime import datetime
from typing import List, Optional

from dotenv import load_dotenv
from langfuse.api.client import AsyncFernLangfuse
from langfuse.client import FetchTracesResponse, TraceWithDetails

load_dotenv("eval/llm_trace_analysis/.env", override=True)


def init_langfuse_api_client(
    public_key: str,
    secret_key: str,
    host: str,
) -> AsyncFernLangfuse:
    return AsyncFernLangfuse(
        base_url=host,
        username=public_key,
        password=secret_key,
        x_langfuse_sdk_name="python",
        x_langfuse_public_key=public_key,
    )


def get_langfuse_client() -> AsyncFernLangfuse:
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    host = os.getenv("LANGFUSE_HOST")

    if not public_key or not secret_key or not host:
        raise ValueError(
            "Missing required Langfuse environment variables: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST"
        )

    return init_langfuse_api_client(
        public_key=public_key,
        secret_key=secret_key,
        host=host,
    )


async def get_all_traces(
    client: AsyncFernLangfuse,
    name: Optional[str] = None,
    from_timestamp: Optional[datetime] = None,
    to_timestamp: Optional[datetime] = None,
    release: Optional[str] = None,
) -> List[TraceWithDetails]:
    # Get first page to determine total pages
    first_page = await client.trace.list(
        name=name,
        page=1,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
        release=release,
    )

    # Create tasks for all remaining pages
    tasks = [
        client.trace.list(
            name=name,
            page=page,
            from_timestamp=from_timestamp,
            to_timestamp=to_timestamp,
            release=release,
        )
        for page in range(2, first_page.meta.total_pages + 1)
    ]

    # Gather all pages concurrently
    all_responses = [first_page]
    if tasks:  # Only gather if there are additional pages
        all_responses.extend(await asyncio.gather(*tasks))

    # Combine all traces
    traces = []
    for response in all_responses:
        traces.extend(FetchTracesResponse(data=response.data, meta=response.meta).data)

    return traces


def filter_traces(
    traces: List[TraceWithDetails], trace_names: List[str]
) -> List[TraceWithDetails]:
    return [trace for trace in traces if trace.name in trace_names]


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
    with open(
        f"outputs/report_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.json", "w"
    ) as f:
        json.dump(report_by_release, f)


async def main():
    RELEASES = ["0.15.3", "0.14.2"]
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
