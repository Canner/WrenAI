import asyncio
import base64
import os
import re
from datetime import datetime
from typing import Any, List, Tuple

import aiohttp
import orjson
import sqlglot
import sqlparse
import streamlit as st
import tomlkit
from dotenv import load_dotenv
from openai import AsyncClient

load_dotenv()

WREN_IBIS_ENDPOINT = os.getenv("WREN_IBIS_ENDPOINT", "http://localhost:8000")
WREN_ENGINE_ENDPOINT = os.getenv("WREN_ENGINE_ENDPOINT", "http://localhost:8080")
DATA_SOURCES = ["bigquery"]


def get_openai_client() -> AsyncClient:
    return AsyncClient(
        api_key=os.getenv("OPENAI_API_KEY"),
    )


def remove_limit_statement(sql: str) -> str:
    pattern = r"\s*LIMIT\s+\d+(\s*;?\s*--.*|\s*;?\s*)$"
    modified_sql = re.sub(pattern, "", sql, flags=re.IGNORECASE)

    return modified_sql


def add_quotes(sql: str) -> str:
    return sqlglot.transpile(sql, read="trino", identify=True)[0]


async def is_sql_valid(sql: str) -> Tuple[bool, str]:
    sql = sql[:-1] if sql.endswith(";") else sql
    async with aiohttp.request(
        "POST",
        f'{WREN_IBIS_ENDPOINT}/v2/connector/{st.session_state['data_source']}/query?dryRun=true',
        json={
            "sql": add_quotes(sql),
            "manifestStr": base64.b64encode(
                orjson.dumps(st.session_state["mdl_json"])
            ).decode(),
            "connectionInfo": st.session_state["connection_info"],
        },
        timeout=aiohttp.ClientTimeout(total=60),
    ) as response:
        if response.status == 204:
            return True, None
        res = await response.text()

        return False, res


async def get_validated_question_sql_pairs(
    question_sql_pairs: list[dict],
) -> list[dict]:
    tasks = []

    async with aiohttp.ClientSession():
        for question_sql_pair in question_sql_pairs:
            task = asyncio.ensure_future(is_sql_valid(question_sql_pair["sql"]))
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


def get_ddl_commands(mdl_json: dict) -> str:
    def _convert_models_and_relationships(
        models: List[dict], relationships: List[dict]
    ):
        ddl_commands = []

        # A map to store model primary keys for foreign key relationships
        primary_keys_map = {model["name"]: model["primaryKey"] for model in models}

        for model in models:
            table_name = model["name"]
            columns_ddl = []
            for column in model["columns"]:
                if "relationship" not in column:
                    if "properties" in column:
                        comment = f"-- {orjson.dumps(column['properties']).decode("utf-8")}\n  "
                    else:
                        comment = ""
                    if "isCalculated" in column and column["isCalculated"]:
                        comment = (
                            comment
                            + f"-- This column is a Calculated Field\n  -- column expression: {column["expression"]}\n  "
                        )
                    column_name = column["name"]
                    column_type = column["type"]
                    column_ddl = f"{comment}{column_name} {column_type}"

                    # If column is a primary key
                    if column_name == model.get("primaryKey", ""):
                        column_ddl += " PRIMARY KEY"

                    columns_ddl.append(column_ddl)

            # Add foreign key constraints based on relationships
            for relationship in relationships:
                if (
                    table_name == relationship["models"][0]
                    and relationship["joinType"].upper() == "MANY_TO_ONE"
                ):
                    related_table = relationship["models"][1]
                    fk_column = relationship["condition"].split(" = ")[0].split(".")[1]
                    fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                    columns_ddl.append(fk_constraint)
                elif (
                    table_name == relationship["models"][1]
                    and relationship["joinType"].upper() == "ONE_TO_MANY"
                ):
                    related_table = relationship["models"][0]
                    fk_column = relationship["condition"].split(" = ")[1].split(".")[1]
                    fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                    columns_ddl.append(fk_constraint)
                elif (
                    table_name in relationship["models"]
                    and relationship["joinType"].upper() == "ONE_TO_ONE"
                ):
                    index = relationship["models"].index(table_name)
                    related_table = [
                        m for m in relationship["models"] if m != table_name
                    ][0]
                    fk_column = (
                        relationship["condition"].split(" = ")[index].split(".")[1]
                    )
                    fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                    columns_ddl.append(fk_constraint)

            if "properties" in model:
                comment = (
                    f"\n/* {orjson.dumps(model['properties']).decode("utf-8")} */\n"
                )
            else:
                comment = ""

            create_table_ddl = (
                f"{comment}CREATE TABLE {table_name} (\n  "
                + ",\n  ".join(columns_ddl)
                + "\n);"
            )
            ddl_commands.append(create_table_ddl)

        return ddl_commands

    def _convert_metrics(metrics: List[dict]):
        ddl_commands = []

        for metric in metrics:
            table_name = metric["name"]
            columns_ddl = []
            for dimension in metric["dimension"]:
                column_name = dimension["name"]
                column_type = dimension["type"]
                comment = "-- This column is a dimension\n  "
                column_ddl = f"{comment}{column_name} {column_type}"
                columns_ddl.append(column_ddl)

            for measure in metric["measure"]:
                column_name = measure["name"]
                column_type = measure["type"]
                comment = f"-- This column is a measure\n  -- expression: {measure["expression"]}\n  "
                column_ddl = f"{comment}{column_name} {column_type}"
                columns_ddl.append(column_ddl)

            comment = f"\n/* This table is a metric */\n/* Metric Base Object: {metric["baseObject"]} */\n"
            create_table_ddl = (
                f"{comment}CREATE TABLE {table_name} (\n  "
                + ",\n  ".join(columns_ddl)
                + "\n);"
            )

            ddl_commands.append(create_table_ddl)

        return ddl_commands

    def _convert_views(views: List[dict]):
        def _format(view: dict[str, Any]) -> str:
            properties = view["properties"] if "properties" in view else ""
            return f"/* {properties} */\nCREATE VIEW {view['name']}\nAS ({view['statement']})"

        return [_format(view) for view in views]

    models = mdl_json.get("models", [])
    relationships = mdl_json.get("relationships", [])
    metrics = mdl_json.get("metrics", [])
    views = mdl_json.get("views", [])

    ddl_commands = (
        _convert_models_and_relationships(models, relationships)
        + _convert_metrics(metrics)
        + _convert_views(views)
    )
    return "\n\n".join(ddl_commands)


async def get_sql_analysis(
    sql: str,
) -> List[dict]:
    sql = sql[:-1] if sql.endswith(";") else sql
    async with aiohttp.request(
        "GET",
        f"{WREN_ENGINE_ENDPOINT}/v1/analysis/sql",
        json={
            "sql": add_quotes(sql),
            "manifest": st.session_state["mdl_json"],
        },
        timeout=aiohttp.ClientTimeout(total=60),
    ) as response:
        return await response.json()


async def get_contexts_from_sqls(
    sqls: list[str],
) -> list[str]:
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
            task = asyncio.ensure_future(get_sql_analysis(sql))
            tasks.append(task)

        results = await asyncio.gather(*tasks)

        return [_get_contexts_from_sql_analysis_results(result) for result in results]


async def get_question_sql_pairs(
    llm_client: AsyncClient,
    llm_model: str,
    mdl_json: dict,
    custom_instructions: str,
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
Data Model: {get_ddl_commands(mdl_json)}

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
        question_sql_pairs = await get_validated_question_sql_pairs(results)
        sqls = [question_sql_pair["sql"] for question_sql_pair in question_sql_pairs]
        contexts = await get_contexts_from_sqls(sqls)
        return [
            {**quesiton_sql_pair, "context": context}
            for quesiton_sql_pair, context in zip(question_sql_pairs, contexts)
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


@st.cache_data
def get_eval_dataset_in_toml_string(mdl: dict, dataset: list) -> str:
    doc = tomlkit.document()

    doc.add("date", datetime.today().strftime("%Y_%m_%d"))
    doc.add("mdl", mdl)
    doc.add("eval_dataset", dataset)

    return tomlkit.dumps(doc)
