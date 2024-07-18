import base64
from typing import Any, Dict, List, Optional

import aiohttp
import orjson
import sqlglot
from tomlkit import parse


def add_quotes(sql: str) -> str:
    return sqlglot.transpile(sql, read="trino", identify=True)[0]


async def get_data_from_wren_engine(
    sql: str,
    data_source: str,
    mdl_json: dict,
    connection_info: dict,
    api_endpoint: str,
    timeout: float,
    limit: Optional[int] = None,
):
    url = f"{api_endpoint}/v2/connector/{data_source}/query"
    if limit is not None:
        url += f"?limit={limit}"

    async with aiohttp.request(
        "POST",
        url,
        json={
            "sql": add_quotes(sql),
            "manifestStr": base64.b64encode(orjson.dumps(mdl_json)).decode(),
            "connectionInfo": connection_info,
        },
        timeout=aiohttp.ClientTimeout(total=timeout),
    ) as response:
        if response.status != 200:
            return {"data": [], "columns": []}

        data = await response.json()
        column_names = [f"{i}_{col}" for i, col in enumerate(data["columns"])]

        return {"data": data["data"], "columns": column_names}


async def get_contexts_from_sql(
    sql: str,
    mdl_json: dict,
    api_endpoint: str,
    timeout: float,
) -> list[str]:
    def _get_contexts_from_sql_analysis_results(sql_analysis_results: list[dict]):
        def _compose_contexts_of_select_type(select_items: list[dict]):
            return [
                f'{expr_source['sourceDataset']}.{expr_source['expression']}'
                for select_item in select_items
                for expr_source in select_item["exprSources"]
            ]

        def _compose_contexts_of_filter_type(filter: dict):
            contexts = []
            if filter["type"] == "EXPR":
                contexts += [
                    f'{expr_source["sourceDataset"]}.{expr_source["expression"]}'
                    for expr_source in filter["exprSources"]
                ]
            elif filter["type"] in ("AND", "OR"):
                contexts += _compose_contexts_of_filter_type(filter["left"])
                contexts += _compose_contexts_of_filter_type(filter["right"])

            return contexts

        def _compose_contexts_of_groupby_type(groupby_keys: list[list[dict]]):
            contexts = []
            for groupby_key_list in groupby_keys:
                contexts += [
                    f'{expr_source["sourceDataset"]}.{expr_source["expression"]}'
                    for groupby_key in groupby_key_list
                    for expr_source in groupby_key["exprSources"]
                ]
            return contexts

        def _compose_contexts_of_sorting_type(sortings: list[dict]):
            return [
                f'{expr_source["sourceDataset"]}.{expr_source["expression"]}'
                for sorting in sortings
                for expr_source in sorting["exprSources"]
            ]

        contexts = []
        for result in sql_analysis_results:
            if "selectItems" in result:
                contexts += _compose_contexts_of_select_type(result["selectItems"])
            if "filter" in result:
                contexts += _compose_contexts_of_filter_type(result["filter"])
            if "groupByKeys" in result:
                contexts += _compose_contexts_of_groupby_type(result["groupByKeys"])
            if "sortings" in result:
                contexts += _compose_contexts_of_sorting_type(result["sortings"])

        return sorted(set(contexts))

    async def _get_sql_analysis(
        sql: str,
        mdl_json: dict,
        api_endpoint: str,
        timeout: float,
    ) -> List[dict]:
        sql = sql.rstrip(";") if sql.endswith(";") else sql
        async with aiohttp.request(
            "GET",
            f"{api_endpoint}/v1/analysis/sql",
            json={
                "sql": add_quotes(sql),
                "manifest": mdl_json,
            },
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as response:
            return await response.json()

    contexts = await _get_sql_analysis(sql, mdl_json, api_endpoint, timeout)
    return _get_contexts_from_sql_analysis_results(contexts)


def parse_toml(path: str) -> Dict[str, Any]:
    with open(path) as file:
        return parse(file.read())
