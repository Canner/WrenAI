#!/usr/bin/env python3
"""Load Xquik public X search results into DuckDB for Wren analysis."""

from __future__ import annotations

import argparse
import importlib
import os
from typing import Any

_BASE_URL = "https://xquik.com/api/v1/"
_CONTRACT_VERSION = "2026-04-29"
_MAX_LIMIT = 10_000


def build_xquik_config(
    query: str,
    api_key: str,
    limit: int,
) -> dict[str, Any]:
    """Build a bounded dlt REST API source configuration for Xquik."""
    query = query.strip()
    api_key = api_key.strip()
    if not query:
        raise ValueError("query must not be empty")
    if not api_key:
        raise ValueError("api_key must not be empty")
    if not 1 <= limit <= _MAX_LIMIT:
        raise ValueError(f"limit must be between 1 and {_MAX_LIMIT}")

    return {
        "client": {
            "base_url": _BASE_URL,
            "headers": {"xquik-api-contract": _CONTRACT_VERSION},
            "auth": {
                "type": "api_key",
                "name": "x-api-key",
                "api_key": api_key,
                "location": "header",
            },
        },
        "resources": [
            {
                "name": "tweets",
                "primary_key": "id",
                "write_disposition": "merge",
                "endpoint": {
                    "path": "x/tweets/search",
                    "params": {"q": query, "limit": limit},
                    "data_selector": "tweets",
                    "paginator": {
                        "type": "cursor",
                        "cursor_path": "next_cursor",
                        "cursor_param": "cursor",
                        "has_more_path": "has_more",
                    },
                },
            }
        ],
    }


def main() -> None:
    """Run the Xquik search pipeline."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", required=True, help="X search query")
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="maximum posts to request (default: 100)",
    )
    parser.add_argument(
        "--pipeline-name",
        default="xquik",
        help="dlt pipeline and DuckDB file name (default: xquik)",
    )
    args = parser.parse_args()

    api_key = os.environ.get("XQUIK_API_KEY", "")
    if not api_key.strip():
        parser.error("XQUIK_API_KEY is required")

    dlt = importlib.import_module("dlt")
    rest_api_source = importlib.import_module("dlt.sources.rest_api").rest_api_source

    source = rest_api_source(
        build_xquik_config(args.query, api_key, args.limit)
    ).add_limit(args.limit, count_rows=True)
    pipeline = dlt.pipeline(
        pipeline_name=args.pipeline_name,
        destination="duckdb",
        dataset_name="xquik_data",
    )
    print(pipeline.run(source))


if __name__ == "__main__":
    main()
