import asyncio
import base64
import os
import sys
import uuid
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

import aiohttp
import orjson
import sqlparse
import streamlit as st
import tomlkit
from dotenv import load_dotenv
from openai import AsyncClient

# add wren-ai-service to sys.path
sys.path.append(f"{Path().parent.parent.resolve()}")
from eval.utils import add_quotes, get_contexts_from_sql, get_data_from_wren_engine
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


async def is_sql_valid(
    sql: str,
    data_source: str,
    mdl_json: dict,
    connection_info: dict,
    api_endpoint: str = WREN_IBIS_ENDPOINT,
    timeout: float = TIMEOUT_SECONDS,
) -> Tuple[bool, str]:
    sql = sql.rstrip(";") if sql.endswith(";") else sql
    quoted_sql, no_error = add_quotes(sql)
    assert no_error, f"Error in quoting SQL: {sql}"

    async with aiohttp.request(
        "POST",
        f"{api_endpoint}/v2/connector/{data_source}/query?dryRun=true",
        json={
            "sql": quoted_sql,
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


def get_ddl_commands(mdl: Dict[str, Any]) -> List[str]:
    def _convert_models_and_relationships(
        models: List[Dict[str, Any]], relationships: List[Dict[str, Any]]
    ) -> List[str]:
        ddl_commands = []

        # A map to store model primary keys for foreign key relationships
        primary_keys_map = {model["name"]: model["primaryKey"] for model in models}

        for model in models:
            table_name = model["name"]
            columns_ddl = []
            for column in model["columns"]:
                if "relationship" not in column:
                    if "properties" in column:
                        column["properties"]["alias"] = column["properties"].pop(
                            "displayName", ""
                        )
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
                comment = f'-- {{"condition": {relationship["condition"]}, "joinType": {relationship["joinType"]}}}\n  '
                if (
                    table_name == relationship["models"][0]
                    and relationship["joinType"].upper() == "MANY_TO_ONE"
                ):
                    related_table = relationship["models"][1]
                    fk_column = relationship["condition"].split(" = ")[0].split(".")[1]
                    fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                    columns_ddl.append(f"{comment}{fk_constraint}")
                elif (
                    table_name == relationship["models"][1]
                    and relationship["joinType"].upper() == "ONE_TO_MANY"
                ):
                    related_table = relationship["models"][0]
                    fk_column = relationship["condition"].split(" = ")[1].split(".")[1]
                    fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                    columns_ddl.append(f"{comment}{fk_constraint}")
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
                    columns_ddl.append(f"{comment}{fk_constraint}")

            if "properties" in model:
                model["properties"]["alias"] = model["properties"].pop(
                    "displayName", ""
                )
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

    def _convert_views(views: List[Dict[str, Any]]) -> List[str]:
        def _format(view: Dict[str, Any]) -> str:
            properties = view["properties"] if "properties" in view else ""
            return f"/* {properties} */\nCREATE VIEW {view['name']}\nAS ({view['statement']})"

        return [_format(view) for view in views]

    def _convert_metrics(metrics: List[Dict[str, Any]]) -> List[str]:
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

    semantics = {
        "models": [],
        "relationships": mdl["relationships"],
        "views": mdl["views"],
        "metrics": mdl["metrics"],
    }

    for model in mdl["models"]:
        columns = []
        for column in model["columns"]:
            ddl_column = {
                "name": column["name"],
                "type": column["type"],
            }
            if "properties" in column:
                ddl_column["properties"] = column["properties"]
            if "relationship" in column:
                ddl_column["relationship"] = column["relationship"]
            if "expression" in column:
                ddl_column["expression"] = column["expression"]
            if "isCalculated" in column:
                ddl_column["isCalculated"] = column["isCalculated"]

            columns.append(ddl_column)

        semantics["models"].append(
            {
                "type": "model",
                "name": model["name"],
                "properties": model["properties"] if "properties" in model else {},
                "columns": columns,
                "primaryKey": model["primaryKey"],
            }
        )

    return (
        _convert_models_and_relationships(
            semantics["models"], semantics["relationships"]
        )
        + _convert_metrics(semantics["metrics"])
        + _convert_views(semantics["views"])
    )


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


def get_documents_given_contexts(
    contexts_list: list[list[str]], mdl_json: dict
) -> list[list[dict]]:
    mdl_json_cloned = deepcopy(mdl_json)

    def _build_partial_mdl_json(
        contexts_list: list[list[str]], mdl_json: dict
    ) -> list[dict]:
        mdj_json_model_lookup_table = {
            model["name"]: {
                **model,
                "column_lookup": {
                    column["name"]: column
                    for column in model["columns"]
                    if "relationship" not in column
                },
                "relationship_lookup": {
                    column["relationship"]: column
                    for column in model["columns"]
                    if "relationship" in column
                },
            }
            for model in mdl_json["models"]
        }

        new_mdl_jsons = []
        for contexts in contexts_list:
            model_candidates = {}
            relationship_candidates = []
            for context in contexts:
                table_name, column_name = context.split(".")
                model = mdj_json_model_lookup_table.get(table_name)
                if model:
                    if table_name not in model_candidates:
                        model_candidates[table_name] = {
                            "name": model["name"],
                            "properties": model["properties"],
                            "tableReference": model["tableReference"],
                            "primaryKey": model["primaryKey"],
                            "columns": [],
                        }

                    # add column info
                    column = mdj_json_model_lookup_table[table_name]["column_lookup"][
                        column_name
                    ]
                    model_candidates[table_name]["columns"].append(column)

            contexts_in_set = set(contexts)
            for relationship in mdl_json["relationships"]:
                relationship_name = relationship["name"]
                condition_str = "".join(
                    relationship["condition"].split()
                )  # remove all whitespaces
                conditions = condition_str.split("=")
                if (
                    conditions[0] in contexts_in_set
                    and conditions[1] in contexts_in_set
                ):
                    table_name_first_condition = conditions[0].split(".")[0]
                    table_name_second_condition = conditions[1].split(".")[0]
                    # add relationship column info
                    if (
                        relationship_column := mdj_json_model_lookup_table.get(
                            table_name_first_condition, {}
                        )
                        .get("relationship_lookup", {})
                        .get(relationship_name, {})
                    ):
                        model_candidates[table_name_first_condition]["columns"].append(
                            relationship_column
                        )
                    elif (
                        relationship_column := mdj_json_model_lookup_table.get(
                            table_name_second_condition, {}
                        )
                        .get("relationship_lookup", {})
                        .get(relationship_name, {})
                    ):
                        model_candidates[table_name_second_condition]["columns"].append(
                            relationship_column
                        )

                    # add relationship info
                    relationship_candidates.append(relationship)

            new_mdl_jsons.append(
                {
                    "models": list(model_candidates.values()),
                    "relationships": relationship_candidates,
                    "views": [],
                    "metrics": [],
                }
            )

        return new_mdl_jsons

    new_mdl_jsons = _build_partial_mdl_json(contexts_list, mdl_json_cloned)

    return [
        {
            "id": str(i),
            "meta": {"id": str(i)},
            "content": ddl_command,
        }
        for new_mdl_json in new_mdl_jsons
        for i, ddl_command in enumerate(get_ddl_commands(new_mdl_json))
    ]


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
            sqls, data_source, mdl_json, connection_info
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

    doc.add("dataset_id", str(uuid.uuid4()))
    doc.add("date", datetime.today().strftime("%Y_%m_%d"))
    doc.add("mdl", mdl)
    doc.add("eval_dataset", dataset)

    return tomlkit.dumps(doc, sort_keys=True)
