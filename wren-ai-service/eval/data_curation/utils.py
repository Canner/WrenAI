import asyncio
import base64
import os
import re
import sys
from pathlib import Path
from typing import List, Tuple

import aiohttp
import orjson
import sqlparse
import streamlit as st
from dotenv import load_dotenv
from openai import AsyncClient

# add wren-ai-service to sys.path
sys.path.append(f"{Path().parent.parent.resolve()}")
from eval.utils import (
    add_quotes,
    get_contexts_from_sql,
    get_data_from_wren_engine,
    get_ddl_commands,
    get_documents_given_contexts,
)
from src.pipelines.indexing.db_schema import DDLChunker

load_dotenv()

WREN_IBIS_ENDPOINT = os.getenv("WREN_IBIS_ENDPOINT", "http://localhost:8000")
WREN_ENGINE_ENDPOINT = os.getenv("WREN_ENGINE_ENDPOINT", "http://localhost:8080")
DATA_SOURCES = ["bigquery", "duckdb"]
TIMEOUT_SECONDS = 60
ddl_converter = DDLChunker()


async def is_sql_valid(
    sql: str,
    data_source: str,
    mdl_json: dict,
    connection_info: dict,
    api_endpoint: str,
    timeout: float = TIMEOUT_SECONDS,
) -> Tuple[bool, str]:
    sql = sql.rstrip(";") if sql.endswith(";") else sql
    quoted_sql, no_error = add_quotes(sql)
    assert no_error, f"Error in quoting SQL: {sql}"

    if data_source == "duckdb":
        async with aiohttp.request(
            "GET",
            f"{api_endpoint}/v1/mdl/dry-run",
            json={
                "sql": remove_limit_statement(quoted_sql),
                "manifest": mdl_json,
                "limit": 1,
            },
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as response:
            if response.status == 200:
                return True, None

            res = await response.json()
            return False, res
    else:
        async with aiohttp.request(
            "POST",
            f"{api_endpoint}/v2/connector/{data_source}/query?dryRun=true",
            json={
                "sql": remove_limit_statement(quoted_sql),
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
                    WREN_ENGINE_ENDPOINT
                    if data_source == "duckdb"
                    else WREN_IBIS_ENDPOINT,
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


async def get_contexts_from_sqls(
    sqls: list[str],
    mdl_json: dict,
    api_endpoint: str = WREN_ENGINE_ENDPOINT,
    timeout: float = TIMEOUT_SECONDS,
) -> list[list[str]]:
    async with aiohttp.ClientSession():
        tasks = []
        for sql in sqls:
            task = asyncio.ensure_future(
                get_contexts_from_sql(
                    sql,
                    mdl_json,
                    api_endpoint,
                    timeout,
                )
            )
            tasks.append(task)

        results = await asyncio.gather(*tasks)

        return results


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
Data Model: {"\n\n".join(get_ddl_commands(mdl_json))}

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
        documents = get_documents_given_contexts(contexts, mdl_json)
        sqls_data = await get_data_from_wren_engine_with_sqls(
            sqls,
            data_source,
            mdl_json,
            connection_info,
            WREN_ENGINE_ENDPOINT
            if st.session_state["data_source"] == "duckdb"
            else WREN_IBIS_ENDPOINT,
        )
        return [
            {
                **quesiton_sql_pair,
                "context": context,
                "data": sql_data,
                "document": document,
            }
            for quesiton_sql_pair, context, sql_data, document in zip(
                question_sql_pairs, contexts, sqls_data, documents
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


async def get_data_from_wren_engine_with_sqls(
    sqls: List[str],
    data_source: str,
    mdl_json: dict,
    connection_info: dict,
    api_endpoint: str,
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


def remove_limit_statement(sql: str) -> str:
    pattern = r"\s*LIMIT\s+\d+(\s*;?\s*--.*|\s*;?\s*)$"
    modified_sql = re.sub(pattern, "", sql, flags=re.IGNORECASE)

    return modified_sql
