import asyncio
import os
import re
from typing import Any, List, Optional, Tuple

import aiohttp
import orjson
import requests
import sqlparse
import streamlit as st
from dotenv import load_dotenv
from openai import AsyncClient
from pydantic import BaseModel

load_dotenv()


# only brief validation is provided
class MDLModel(BaseModel):
    catalog: str
    schema: str
    models: Optional[list[dict]] = []
    relationships: Optional[list[dict]] = []
    enumDefinitions: Optional[list[dict]] = []
    metrics: Optional[list[dict]] = []
    cumulativeMetrics: Optional[list[dict]] = []
    views: Optional[list[dict]] = []
    macros: Optional[list[dict]] = []
    dateSpine: Optional[dict] = {}


def get_current_manifest() -> Tuple[str, dict]:
    response = requests.get(
        f"{os.getenv("WREN_ENGINE_ENDPOINT", "http://localhost:8080")}/v1/mdl",
    )

    assert response.status_code == 200
    return response.json()


def get_llm_client() -> AsyncClient:
    return AsyncClient(
        api_key=os.getenv("OPENAI_API_KEY"),
    )


def remove_limit_statement(sql: str) -> str:
    pattern = r"\s*LIMIT\s+\d+(\s*;?\s*--.*|\s*;?\s*)$"
    modified_sql = re.sub(pattern, "", sql, flags=re.IGNORECASE)

    return modified_sql


async def is_sql_valid(sql: str) -> Tuple[bool, str]:
    sql = sql[:-1] if sql.endswith(";") else sql
    async with aiohttp.request(
        "GET",
        f'{os.getenv("WREN_ENGINE_ENDPOINT", "http://localhost:8080")}/v1/mdl/dry-run',
        json={"sql": remove_limit_statement(sql), "limit": 1},
    ) as response:
        result = await response.json()
        if response.status == 200:
            return True, ""

        return False, result["message"]


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
            {**question_sql_pairs[i], "context": [], "is_valid": valid, "error": error}
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

    ddl_commands = (
        _convert_models_and_relationships(mdl_json["models"], mdl_json["relationships"])
        + _convert_metrics(mdl_json["metrics"])
        + _convert_views(mdl_json["views"])
    )
    return "\n\n".join(ddl_commands)


async def get_contexts_from_sqls(
    llm_client: AsyncClient,
    sqls: list[str],
) -> list[str]:
    messages = [
        {
            "role": "system",
            "content": "",
        },
        {
            "role": "user",
            "content": f"""
### TASK ###
Given the sqls, provide the context for each sql.

### EXAMPLES ###

EAMPLE1:

INPUT
"SELECT SUM(p.Value) FROM payments p JOIN orders o ON p.OrderId = o.OrderId WHERE o.Status = 'Delivered';"

OUTPUT
["payments.Value", "orders.OrderId", "payments.OrderId", "orders.Status"]

EXAMPLE2:

INPUT
"SELECT AVG(Score) FROM reviews;"

OUTPUT
["reviews.Score"

EXAMPLE3:

INPUT
"SELECT * FROM customers;"

OUTPUT
["customers.*"]

### Output Format ###
{{
    "results": [
        <context_string1>,
        <context_string2>,
        ...
    ]
}}

### Input ###
List of SQLs: {sqls}

Generate the context for the corresponding SQL query according to the Output Format in JSON
Think step by step
""",
        },
    ]

    try:
        response = await llm_client.chat.completions.create(
            model=os.getenv("OPENAI_GENERATION_MODEL", "gpt-3.5-turbo"),
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=4096,
            temperature=0,
        )

        return orjson.loads(response.choices[0].message.content)["results"]
    except Exception as e:
        st.error(f"Error generating question-sql-pairs with context: {e}")
        return []


async def get_question_sql_pairs(
    llm_client: AsyncClient, mdl_json: dict, num_pairs: int = 10
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

### Input ###
Data Model: {get_ddl_commands(mdl_json)}

Generate {num_pairs} of the questions and corresponding SQL queries according to the Output Format in JSON
Think step by step
""",
        },
    ]

    try:
        response = await llm_client.chat.completions.create(
            model=os.getenv("OPENAI_GENERATION_MODEL", "gpt-3.5-turbo"),
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=4096,
            temperature=0,
        )

        results = orjson.loads(response.choices[0].message.content)["results"]
        question_sql_pairs = await get_validated_question_sql_pairs(results)
        sqls = [question_sql_pair["sql"] for question_sql_pair in question_sql_pairs]
        contexts = await get_contexts_from_sqls(llm_client, sqls)
        return [
            {**quesiton_sql_pair, "context": context}
            for quesiton_sql_pair, context in zip(question_sql_pairs, contexts)
        ]
    except Exception as e:
        st.error(f"Error generating question-sql-pairs: {e}")
        return []


def show_er_diagram(models: List[dict], relationships: List[dict]):
    # Start of the Graphviz syntax
    graphviz = "digraph ERD {\n"
    graphviz += '    graph [pad="0.5", nodesep="0.5", ranksep="2"];\n'
    graphviz += "    node [shape=plain]\n"
    graphviz += "    rankdir=LR;\n\n"

    # Function to format the label for Graphviz
    def format_label(name, columns):
        label = f'<<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0"><TR><TD><B>{name}</B></TD></TR>'
        for column in columns:
            label += f'<TR><TD>{column["name"]} : {column["type"]}</TD></TR>'
        label += "</TABLE>>"
        return label

    # Add models (entities) to the Graphviz syntax
    for model in models:
        graphviz += f'    {model["name"]} [label={format_label(model["name"], model["columns"])}];\n'

    graphviz += "\n"

    # Extract columns involved in each relationship
    def extract_columns(condition):
        # This regular expression should match the condition format and extract column names
        matches = re.findall(r"(\w+)\.(\w+) = (\w+)\.(\w+)", condition)
        if matches:
            return matches[0][1], matches[0][3]  # Returns (from_column, to_column)
        return "", ""

    # Add relationships to the Graphviz syntax
    for relationship in relationships:
        from_model, to_model = relationship["models"]
        from_column, to_column = extract_columns(relationship["condition"])
        label = (
            f'{relationship["name"]}\\n({from_column} to {to_column}) ({relationship['joinType']})'
            if from_column and to_column
            else relationship["name"]
        )
        graphviz += f'    {from_model} -> {to_model} [label="{label}"];\n'

    graphviz += "}"

    st.graphviz_chart(graphviz)


def prettify_sql(sql: str) -> str:
    return sqlparse.format(
        sql,
        reindent=True,
        keyword_case="upper",
    )
