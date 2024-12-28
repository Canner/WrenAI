import asyncio
import os
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from langfuse.api.client import AsyncFernLangfuse
from langfuse.client import FetchTracesResponse

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
):
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


async def main():
    client = get_langfuse_client()
    releases = ["0.15.3", "0.14.2"]

    # Use asyncio.gather to fetch traces for all releases concurrently
    traces_by_release = await asyncio.gather(
        *[get_all_traces(client, release=release) for release in releases]
    )

    # Print results for each release
    for release, traces in zip(releases, traces_by_release):
        print(f"Release {release}: {len(traces)} traces")


if __name__ == "__main__":
    asyncio.run(main())
