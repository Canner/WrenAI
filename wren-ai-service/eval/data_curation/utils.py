import asyncio
import base64
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

import aiohttp
import orjson
import sqlglot
import sqlparse
import streamlit as st
import tomlkit
from dotenv import load_dotenv
from openai import AsyncClient

# in order to import the DDLConverter class from the indexing module
sys.path.append(f"{Path().parent.parent.resolve()}")
from src.pipelines.indexing.indexing import DDLConverter

load_dotenv()

WREN_IBIS_ENDPOINT = os.getenv("WREN_IBIS_ENDPOINT", "http://localhost:8000")
WREN_ENGINE_ENDPOINT = os.getenv("WREN_ENGINE_ENDPOINT", "http://localhost:8080")
DATA_SOURCES = ["bigquery"]
TIMEOUT_SECONDS = 60
ddl_converter = DDLConverter()


def get_openai_client(
    api_key: str = os.getenv("OPENAI_API_KEY"), timeout: float = TIMEOUT_SECONDS
) -> AsyncClient:
    return AsyncClient(
        api_key=api_key,
        timeout=timeout,
    )


def add_quotes(sql: str) -> str:
    return sqlglot.transpile(sql, read="trino", identify=True)[0]


async def is_sql_valid(
    sql: str,
    data_source: str,
    mdl_json: dict,
    connection_info: dict,
    api_endpoint: str = WREN_IBIS_ENDPOINT,
    timeout: float = TIMEOUT_SECONDS,
) -> Tuple[bool, str]:
    sql = sql[:-1] if sql.endswith(";") else sql
    async with aiohttp.request(
        "POST",
        f"{api_endpoint}/v2/connector/{data_source}/query?dryRun=true",
        json={
            "sql": add_quotes(sql),
            "manifestStr": base64.b64encode(orjson.dumps(mdl_json)).decode(),
            "connectionInfo": connection_info,
        },
        timeout=aiohttp.ClientTimeout(total=timeout),
    ) as response:
        if response.status == 204:
            return True, None
        res = await response.text()

        return False, res


async def get_validated_question_sql_pairs(
    question_sql_pairs: list[dict],
    data_source: str,
    mdl_json: dict,
    connection_info: dict,
) -> list[dict]:
    tasks = []

    async with aiohttp.ClientSession():
        for question_sql_pair in question_sql_pairs:
            task = asyncio.ensure_future(
                is_sql_valid(
                    question_sql_pair["sql"],
                    data_source,
                    mdl_json,
                    connection_info,
                )
            )
            tasks.append(task)

        results = await asyncio.gather(*tasks)
        return [
            {
                **question_sql_pairs[i],
                "context": [],
                "is_valid": valid,
                "error": error,
            }
            for i, (valid, error) in enumerate(results)
        ]


async def get_sql_analysis(
    sql: str,
    mdl_json: dict,
    api_endpoint: str = WREN_ENGINE_ENDPOINT,
    timeout: float = TIMEOUT_SECONDS,
) -> List[dict]:
    sql = sql[:-1] if sql.endswith(";") else sql
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


async def get_contexts_from_sqls(
    sqls: list[str],
    mdl_json: dict,
) -> list[list[str]]:
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

    def _get_contexts_from_sql_analysis_results(sql_analysis_results: list[dict]):
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

        # print(
        #     f'SQL ANALYSIS RESULTS: {orjson.dumps(sql_analysis_results, option=orjson.OPT_INDENT_2).decode("utf-8")}'
        # )
        # print(f"CONTEXTS: {sorted(set(contexts))}")
        # print("\n\n")

        return sorted(set(contexts))

    async with aiohttp.ClientSession():
        tasks = []
        for sql in sqls:
            task = asyncio.ensure_future(get_sql_analysis(sql, mdl_json))
            tasks.append(task)

        results = await asyncio.gather(*tasks)

        return [_get_contexts_from_sql_analysis_results(result) for result in results]


async def get_question_sql_pairs(
    llm_client: AsyncClient,
    llm_model: str,
    mdl_json: dict,
    custom_instructions: str,
    data_source: str,
    connection_info: dict,
    num_pairs: int = 10,
) -> list[dict]:
    messages = [
        {
            "role": "system",
            "content": "",
        },
        {
            "role": "user",
            "content": f"""
### TASK ###
Given the database DDL, generate {num_pairs} of the questions and corresponding SQL queries.

### Output Format ###
{{
    "results": [
        {{
            "question": <question_string>,
            "sql": <sql_query_string>
        }},
        {{
            "question": <question_string>,
            "sql": <sql_query_string>
        }},
        ...
    ]
}}

### Custom Instructions ###

{custom_instructions}

### Input ###
Data Model: {"\n\n".join(ddl_converter.get_ddl_commands(mdl_json))}

Generate {num_pairs} of the questions and corresponding SQL queries according to the Output Format in JSON
Think step by step
""",
        },
    ]

    try:
        response = await llm_client.chat.completions.create(
            model=llm_model,
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=4096,
            temperature=0,
        )

        results = orjson.loads(response.choices[0].message.content)["results"]
        question_sql_pairs = await get_validated_question_sql_pairs(
            results,
            data_source=data_source,
            mdl_json=mdl_json,
            connection_info=connection_info,
        )
        sqls = [question_sql_pair["sql"] for question_sql_pair in question_sql_pairs]
        contexts = await get_contexts_from_sqls(sqls, mdl_json)
        sqls_data = await get_data_from_wren_engine_with_sqls(
            sqls, data_source, mdl_json, connection_info
        )
        return [
            {**quesiton_sql_pair, "context": context, "data": sql_data}
            for quesiton_sql_pair, context, sql_data in zip(
                question_sql_pairs, contexts, sqls_data
            )
        ]
    except Exception as e:
        st.error(f"Error generating question-sql-pairs: {e}")
        return []


def prettify_sql(sql: str) -> str:
    return sqlparse.format(
        sql,
        reindent=True,
        keyword_case="upper",
    )


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


async def get_data_from_wren_engine_with_sqls(
    sqls: List[str],
    data_source: str,
    mdl_json: dict,
    connection_info: dict,
    api_endpoint: str = WREN_IBIS_ENDPOINT,
    timeout: float = TIMEOUT_SECONDS,
) -> List[dict]:
    assert data_source in DATA_SOURCES, f"Invalid data source: {data_source}"

    async with aiohttp.ClientSession():
        tasks = []
        for sql in sqls:
            task = asyncio.ensure_future(
                get_data_from_wren_engine(
                    sql,
                    data_source,
                    mdl_json,
                    connection_info,
                    api_endpoint,
                    timeout,
                    limit=50,
                )
            )
            tasks.append(task)

        return await asyncio.gather(*tasks)


@st.cache_data
def get_eval_dataset_in_toml_string(mdl: dict, dataset: list) -> str:
    doc = tomlkit.document()

    doc.add("date", datetime.today().strftime("%Y_%m_%d"))
    doc.add("mdl", mdl)
    doc.add("eval_dataset", dataset)

    return tomlkit.dumps(doc)
