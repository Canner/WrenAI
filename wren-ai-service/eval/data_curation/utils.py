import asyncio
import os
import re
from typing import Any, List, Optional, Tuple

import aiohttp
import orjson
import streamlit as st
from dotenv import load_dotenv
from openai import AsyncClient
from pydantic import BaseModel, ValidationError
from streamlit.runtime.uploaded_file_manager import UploadedFile

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


def is_valid_mdl_file(file: UploadedFile) -> Tuple[bool, Any]:
    try:
        file_data = file.getvalue().decode("utf-8")
        MDLModel.model_validate_json(file_data)

        return True, orjson.loads(file_data)
    except orjson.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        return False, None
    except ValidationError as e:
        print(f"Error validating JSON: {e}")
        return False, None


def get_llm_client() -> AsyncClient:
    return AsyncClient(
        api_key=os.getenv("OPENAI_API_KEY"),
    )


async def is_sql_valid(sql: str) -> bool:
    sql = sql[:-1] if sql.endswith(";") else sql
    async with aiohttp.request(
        "GET",
        f'{os.getenv("WREN_ENGINE_ENDPOINT", "http://localhost:8080")}/v1/mdl/dry-run',
        json={"sql": sql, "limit": 1},
    ) as response:
        return response.status == 200


async def get_sql_analysis(sql: str) -> list[dict]:
    async with aiohttp.request(
        "GET",
        f'{os.getenv("WREN_ENGINE_ENDPOINT", "http://localhost:8080")}/v1/analysis/sql',
        json={"sql": sql},
    ) as response:
        result = await response.json()
        if response.status == 200:
            return result
        else:
            return []


async def get_valid_question_sql_pairs(question_sql_pairs: list[dict]) -> list[dict]:
    is_sql_valid_tasks = []
    get_sql_analysis_tasks = []

    async with aiohttp.ClientSession():
        for question_sql_pair in question_sql_pairs:
            task = asyncio.ensure_future(is_sql_valid(question_sql_pair["sql"]))
            is_sql_valid_tasks.append(task)

        is_sql_valid_tasks_results = await asyncio.gather(*is_sql_valid_tasks)
        temp_results = [
            {**question_sql_pairs[i], "context": [], "is_valid": valid}
            for i, valid in enumerate(is_sql_valid_tasks_results)
            if valid
        ]

        for temp_result in temp_results:
            task = asyncio.ensure_future(get_sql_analysis(temp_result["sql"]))
            get_sql_analysis_tasks.append(task)

        get_sql_analysis_tasks_results = await asyncio.gather(*get_sql_analysis_tasks)
        results = [
            {**temp_results[i], "context": result}
            for i, result in enumerate(get_sql_analysis_tasks_results)
        ]

        return results


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
Given the MDL file, which is kind of a database data model, 
generate {num_pairs} of the questions and corresponding SQL queries following the spec of the MDL file.

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
MDL File: {mdl_json}

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
            seed=123,
            temperature=0,
        )

        results = orjson.loads(response.choices[0].message.content)["results"]
        return await get_valid_question_sql_pairs(results)
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
