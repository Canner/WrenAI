import json
import os
import re
import sqlite3
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional

import gdown
import pandas as pd
import requests
import sqlglot
import sqlparse
import streamlit as st

WREN_AI_SERVICE_BASE_URL = "http://localhost:5556"
WREN_ENGINE_API_URL = "http://localhost:8080"
POLLING_INTERVAL = 0.5


def download_spider_data():
    if Path("spider").exists():
        return

    if Path("spider.zip").exists():
        os.remove("spider.zip")

    # 1. uploaded to Jimmy's google drive from the official Spider dataset website(data based at 2024/01/28)
    # 2. added `table_counts_in_database.json`
    # 3. changed column `salary` to `player_salary` in `baseball_1.player` table,
    #     since in bigquery, column name should not be the same as table name
    url = "https://drive.google.com/u/0/uc?id=1StzD_Yha1W-BJOLimuvdzH-cF6sEc_ak&export=download"

    output = "spider.zip"
    gdown.download(url, output, quiet=False)

    with zipfile.ZipFile(output, "r") as zip_ref:
        zip_ref.extractall(".")

    os.remove("spider.zip")


def get_current_manifest_schema():
    response = requests.get(
        f"{WREN_ENGINE_API_URL}/v1/mdl",
    )

    assert response.status_code == 200

    return response.json()["schema"]


def get_current_manifest():
    response = requests.get(
        f"{WREN_ENGINE_API_URL}/v1/mdl",
    )

    assert response.status_code == 200

    manifest = response.json()

    if manifest["schema"] == "test_schema" and manifest["catalog"] == "test_catalog":
        return "None", [], []

    return (
        f"{manifest['catalog']}.{manifest['schema']}",
        manifest["models"],
        manifest["relationships"],
    )


def is_current_manifest_available():
    response = requests.get(
        f"{WREN_ENGINE_API_URL}/v1/mdl",
    )

    assert response.status_code == 200

    manifest = response.json()

    return manifest["catalog"] != "text_catalog" and manifest["schema"] != "test_schema"


def rerun_wren_engine(mdl_json: Dict):
    st.toast("Wren Engine is being re-run", icon="⏳")

    response = requests.post(
        f"{WREN_ENGINE_API_URL}/v1/mdl/deploy",
        json={
            "manifest": mdl_json,
            "version": "latest",
        },
    )

    assert response.status_code == 202

    wren_engine_is_ready = False

    while not wren_engine_is_ready:
        response = requests.get(
            f"{WREN_ENGINE_API_URL}/v1/mdl/status",
        )

        assert response.status_code == 200

        if response.json()["systemStatus"] == "READY":
            wren_engine_is_ready = True

    st.toast("Wren Engine is ready", icon="🎉")


def get_datasets():
    if not Path("spider").exists():
        st.toast("Downloading Spider dataset...", icon="⏳")
        download_spider_data()

    with open("spider/table_counts_in_database.json", "r") as f:
        table_counts_in_database = json.load(f)
        datasets = sorted(table_counts_in_database.keys())

    return datasets


def save_mdl_json_file(file_name: str, mdl_json: Dict):
    if not Path("custom_dataset").exists():
        Path("custom_dataset").mkdir()

    with open(f"custom_dataset/{file_name}", "w", encoding="utf-8") as file:
        json.dump(mdl_json, file, indent=2)


@st.cache_data
def get_database_schema(
    db_path: str, table_names: list[str], should_save_file: bool = False
) -> list[dict]:
    # Connect to the SQLite database
    conn = sqlite3.connect(db_path)

    # Create a cursor object
    cur = conn.cursor()

    # Get the table schemas
    table_schemas = []
    for table_name in table_names:
        cur.execute(
            f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table_name}'"
        )
        row = cur.fetchone()
        if row is not None:
            table_schema = row[0]
            table_schemas.append(
                {
                    "table_name": table_name,
                    "table_schema": re.sub(r"\s+", " ", table_schema).strip(),
                }
            )
        else:
            print(f"No table named {table_name} found.")

    cur.close()

    if should_save_file:
        file_name = db_path.split("/")[-1].split(".")[0]
        with open(f"{file_name}_schema.txt", "w") as file:
            for table_schema in table_schemas:
                file.write(f"Table name: {table_schema['table_name']}\n")
                file.write(f"Table schema: {table_schema['table_schema']}\n\n")

    return table_schemas


@st.cache_data
def get_table_names(db_path: str) -> list[str]:
    # Connect to the SQLite database
    conn = sqlite3.connect(db_path)

    # Create a cursor object
    cur = conn.cursor()

    # Get the table names
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")

    # Fetch the results
    results = cur.fetchall()

    cur.close()

    conn.close()

    return [result[0] for result in results]


@st.cache_data
def get_table_relationships(db_path: str):
    # Connect to the SQLite database
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Get a list of tables in the database
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [row[0] for row in cursor.fetchall()]

    # Function to check if a column is part of a unique or primary key
    def _is_unique_or_pk(table, column):
        cursor.execute(f"PRAGMA table_info('{table}')")
        for col in cursor.fetchall():
            # Check if the column is a primary key or part of a unique constraint
            if col[1] == column and (col[5] > 0 or col[3]):
                return True
        return False

    # Analyze relationships
    relationships = {}
    for table in tables:
        cursor.execute(f"PRAGMA foreign_key_list('{table}')")
        fk_list = cursor.fetchall()

        if not fk_list:
            continue

        for fk in fk_list:
            ref_table = fk[2]
            from_column = fk[3]
            to_column = fk[4]

            # Determine relationship type
            if _is_unique_or_pk(table, from_column):
                if _is_unique_or_pk(ref_table, to_column):
                    relation_type = "ONE_TO_ONE"
                else:
                    relation_type = "ONE_TO_MANY"
            else:
                if _is_unique_or_pk(ref_table, to_column):
                    relation_type = "MANY_TO_ONE"
                else:
                    relation_type = "MANY_TO_MANY"

            relationships[(table, ref_table)] = relation_type

    conn.close()
    return relationships


def generate_text_to_sql_dataset(
    paths: list[str],
    database_name: str,
):
    def _transpile_sql_from_sqlite_to_trino(sql_query: str):
        return sqlglot.transpile(
            sql_query, read=sqlglot.Dialects.SQLITE, write=sqlglot.Dialects.TRINO
        )[0]

    target_data = []
    for path in paths:
        with open(path, "r") as f:
            data = json.load(f)

        if database_name == "":
            target_data += data
        else:
            for entry in data:
                if entry["db_id"] == database_name:
                    target_data.append(
                        {
                            "question": entry["question"],
                            "answer": _transpile_sql_from_sqlite_to_trino(
                                re.sub(r"\s+", " ", entry["query"]).strip()
                            ),
                        }
                    )

    data_root = "../src/eval/data"
    if not Path(data_root).exists():
        Path(data_root).mkdir(parents=True, exist_ok=True)

    file_path = f"{data_root}/{database_name}_data.json"
    if not Path(file_path).exists():
        with open(file_path, "w") as f:
            for entry in target_data:
                json.dump(entry, f)
                f.write("\n")

        st.toast(
            f"Dataset for {database_name} is generated successfully. Check the {data_root} folder."
        )

    return target_data


def generate_mdl_json(
    database_schema: list[dict],
    catalog_name: str,
    schema_name: str,
    database_name: str,
    relationships_info: dict,
):
    def _split_table_definition(table_definition: str):
        return table_definition.split(", ")

    def _get_appropriat_column_type(column_type: str):
        if column_type.lower() == "text" or "varchar" in column_type.lower():
            return "VARCHAR"
        elif column_type.lower() == "numeric":
            return "REAL"
        elif column_type.lower() == "int":
            return "INTEGER"

        return column_type.upper()

    def _parse_column_definition(column_definition: str):
        column_def = column_definition.split(" ")

        return {
            "name": column_def[0],
            "type": column_def[1] if len(column_def) > 1 else "TEXT",
            "not_null": True
            if len(column_def) == 3 and column_def[2].lower() == "not null"
            else False,
        }

    def _parse_table_definition(
        table_name: str, table_definition: str, relationships_info: dict
    ):
        match = re.search(r"\((.*)\)", table_definition)
        assert match
        inside_parentheses = match.group(1)
        parts = _split_table_definition(inside_parentheses)

        # Lists to store columns and foreign keys
        columns = []
        relationships = []
        primary_key = ""

        for part in parts:
            if part.startswith("foreign key") or part.startswith("FOREIGN KEY"):
                part = part.replace("`", "").replace('"', "")
                regex1 = r"FOREIGN KEY\(([^)]+)\) REFERENCES ([^(]+)\(([^)]+)\)"
                regex2 = r"foreign key\(([^)]+)\) references ([^(]+)\(([^)]+)\)"
                match = re.search(regex1, part)
                match2 = re.search(regex2, part)
                match_result = False

                if match:
                    match_result = match
                elif match2:
                    match_result = match2

                if match_result:
                    relationships.append(
                        {
                            "table_name": table_name,
                            "foreign_key": match_result.group(1),
                            "ref_table_name": match_result.group(2),
                            "ref_column": match_result.group(3),
                            "join_type": relationships_info[
                                (table_name, match_result.group(2))
                            ],
                            "properties": {},
                        }
                    )
            else:
                if "PRIMARY KEY" in part or "primary key" in part:
                    primary_key = part.strip().split(" ")[0]
                    part = (
                        part.replace("PRIMARY KEY", "")
                        .replace("primary key", "")
                        .strip()
                    )

                # Splitting the column name and type
                column_def = _parse_column_definition(part.strip())

                columns.append(
                    {
                        "name": column_def["name"].replace('"', ""),
                        "type": _get_appropriat_column_type(column_def["type"]),
                        "notNull": column_def[
                            "not_null"
                        ],  # Assuming notNull is False by default as not specified in the string
                        "isCalculated": False,  # Assuming isCalculated is False by default
                        "expression": column_def["name"].replace(
                            '"', ""
                        ),  # Assuming expression is the column name itself
                        "properties": {},
                    }
                )

        if relationships:
            for relationship in relationships:
                columns.append(
                    {
                        "name": relationship["ref_table_name"],
                        "type": relationship["ref_table_name"],
                        "notNull": True,
                        "isCalculated": False,
                        "relationship": f"{relationship['table_name']}_{relationship['ref_table_name']}",
                        "properties": {},
                    }
                )

        return {
            "columns": columns,
            "primary_key": primary_key,
            "relationships": relationships,
        }

    mdl_json = {
        "catalog": catalog_name,
        "schema": schema_name,
        "models": [],
        "relationships": [],
        # these will be empty for now
        "metrics": [],
        "cumulativeMetrics": [],
        "enumDefinitions": [],
        "views": [],
        "macros": [],
    }

    for table in database_schema:
        # remove comments
        clean_table_schema = table["table_schema"].replace(
            "-- this should be removed", ""
        )
        parsed = sqlparse.parse(clean_table_schema)[0]
        table_definition = _parse_table_definition(
            table["table_name"], str(parsed.tokens[-1]), relationships_info
        )

        mdl_json["models"].append(
            {
                "name": table["table_name"],
                "properties": {},
                "refSql": f"select * from wrenai.{schema_name}.\"{database_name}-{table['table_name']}\"",
                "columns": table_definition["columns"],
                "primaryKey": table_definition["primary_key"],
            }
        )

        if table_definition["relationships"]:
            for relationship in table_definition["relationships"]:
                mdl_json["relationships"].append(
                    {
                        "name": f"{relationship['table_name']}_{relationship['ref_table_name']}",
                        "models": [
                            relationship["table_name"],
                            relationship["ref_table_name"],
                        ],
                        "joinType": relationship["join_type"],
                        "condition": f"{relationship['table_name']}.{relationship['foreign_key']} = {relationship['ref_table_name']}.{relationship['ref_column']}",
                    }
                )

    data_root = "../src/eval/data"
    if not Path(data_root).exists():
        Path(data_root).mkdir(parents=True, exist_ok=True)

    if not Path(f"{data_root}/{database_name}_mdl.json").exists():
        # save the file
        with open(f"{data_root}/{database_name}_mdl.json", "w") as file:
            json.dump(mdl_json, file, indent=2)

        st.toast(
            f"MDL JSON for {database_name} generated successfully. Check the {data_root} folder."
        )

    return mdl_json


def get_mdl_json(database_name: str, type: str = "spider"):
    assert type in ["spider", "demo"]

    if type == "spider":
        database_schema = get_database_schema(
            f"spider/database/{database_name}/{database_name}.sqlite",
            get_table_names(f"spider/database/{database_name}/{database_name}.sqlite"),
        )

        relationships = get_table_relationships(
            f"spider/database/{database_name}/{database_name}.sqlite"
        )

        generate_text_to_sql_dataset(
            ["spider/train_spider.json", "spider/train_others.json"],
            database_name=database_name,
        )

        return generate_mdl_json(
            database_schema,
            "canner-cml",
            "spider",
            database_name,
            relationships,
        )
    elif type == "demo":
        assert database_name in ["music", "nba", "ecommerce"]

        with open(f"sample_dataset/{database_name}_duckdb_mdl.json", "r") as f:
            mdl_json = json.load(f)

        return mdl_json


@st.cache_data
def get_new_mdl_json(chosen_models: List[str]):
    new_mdl_json = st.session_state["mdl_json"]

    for chosen_model in chosen_models:
        mdl_model_json = list(
            filter(
                lambda model: model["name"] == chosen_model,
                st.session_state["mdl_json"]["models"],
            )
        )[0]
        new_mdl_model_json = generate_mdl_metadata(mdl_model_json)
        new_mdl_json["models"][
            new_mdl_json["models"].index(mdl_model_json)
        ] = new_mdl_model_json

    return new_mdl_json


@st.cache_data
def get_data_from_wren_engine(sql: str):
    response = requests.get(
        f"{WREN_ENGINE_API_URL}/v1/mdl/preview",
        json={
            "sql": sql,
        },
    )

    assert response.status_code == 200

    data = response.json()
    column_names = [f'{i}_{col["name"]}' for i, col in enumerate(data["columns"])]

    return pd.DataFrame(data["data"], columns=column_names)


# ui related
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

    st.markdown("ER Diagram")
    st.graphviz_chart(graphviz)


def show_query_history():
    if st.session_state["query_history"]:
        with st.expander("Query History", expanded=False):
            st.markdown(st.session_state["query_history"]["summary"])
            st.code(
                body=sqlparse.format(
                    st.session_state["query_history"]["sql"],
                    reindent=True,
                    keyword_case="upper",
                ),
                language="sql",
            )
            for i, step in enumerate(st.session_state["query_history"]["steps"]):
                st.markdown(f"#### Step {i + 1}")
                st.markdown(step["summary"])
                st.code(
                    body=sqlparse.format(
                        step["sql"], reindent=True, keyword_case="upper"
                    ),
                    language="sql",
                )


def show_asks_results():
    st.markdown(f'## Query: {st.session_state['query']}')

    show_query_history()

    st.markdown("### Query Results")
    asks_result_count = len(st.session_state["asks_results"])
    ask_result_cols = st.columns(asks_result_count)
    choose_result_n = [False] * asks_result_count
    for i, ask_result_col in enumerate(ask_result_cols):
        with ask_result_col:
            st.markdown(f"Result {i+1}")
            st.code(
                body=sqlparse.format(
                    st.session_state["asks_results"][i]["sql"],
                    reindent=True,
                    keyword_case="upper",
                ),
                language="sql",
            )
            st.markdown(st.session_state["asks_results"][i]["summary"])
            choose_result_n[i] = st.button(f"Choose Result {i+1}")

    for i, choose_result in enumerate(choose_result_n):
        if choose_result:
            sql = st.session_state["asks_results"][i]["sql"]
            summary = st.session_state["asks_results"][i]["summary"]

            st.session_state["chosen_query_result"] = {
                "index": i,
                "query": st.session_state["query"],
                "sql": sql,
                "summary": summary,
            }

            # reset relevant session_states
            st.session_state["asks_details_result"] = None
            st.session_state["preview_data_button_index"] = None
            st.session_state["preview_sql"] = None

            break


def show_asks_details_results():
    st.markdown(
        f'### Details of Result {st.session_state['chosen_query_result']['index'] + 1}'
    )
    st.markdown(
        f'Description: {st.session_state['asks_details_result']["description"]}'
    )
    sqls_with_cte = []
    sqls = []
    for i, step in enumerate(st.session_state["asks_details_result"]["steps"]):
        st.markdown(f"#### Step {i + 1}")
        st.markdown(step["summary"])

        sql = ""
        if sqls_with_cte:
            sql += "WITH " + ",\n".join(sqls_with_cte) + "\n\n"
        sql += step["sql"]
        sqls.append(sql)

        st.code(
            body=sqlparse.format(sql, reindent=True, keyword_case="upper"),
            language="sql",
        )
        sqls_with_cte.append(f"{step['cte_name']} AS ( {step['sql']} )")

        st.button(
            label="Preview Data",
            key=i,
            on_click=on_click_preview_data_button,
            args=[i, sqls],
        )

        if (
            st.session_state["preview_data_button_index"] is not None
            and st.session_state["preview_sql"] is not None
            and i == st.session_state["preview_data_button_index"]
        ):
            st.markdown(
                f'##### Preview Data of Step {st.session_state['preview_data_button_index'] + 1}'
            )

            st.dataframe(
                get_data_from_wren_engine(
                    st.session_state["preview_sql"],
                )
            )


def on_click_preview_data_button(index: int, full_sqls: List[str]):
    st.session_state["preview_data_button_index"] = index
    st.session_state["preview_sql"] = full_sqls[index]


# ai service api related
def generate_mdl_metadata(mdl_model_json: dict):
    identifiers = [mdl_model_json["name"]]
    for column in mdl_model_json["columns"]:
        identifiers.append(f'column_name@{column['name']}')

    st.toast(f'Generating MDL metadata for model {mdl_model_json['name']}', icon="⏳")
    generate_mdl_metadata_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/semantics-descriptions",
        json={
            "mdl": mdl_model_json,
            "model": mdl_model_json["name"],
            "identifiers": identifiers,
        },
    )

    assert generate_mdl_metadata_response.status_code == 200

    for response in generate_mdl_metadata_response.json():
        if response["identifier"] == mdl_model_json["name"]:
            mdl_model_json["properties"]["description"] = response["description"]
            mdl_model_json["properties"]["display_name"] = response["display_name"]
        else:
            for i, column in enumerate(mdl_model_json["columns"]):
                if response["identifier"] == f'column_name@{column['name']}':
                    mdl_model_json["columns"][i]["description"] = response[
                        "description"
                    ]
                    mdl_model_json["columns"][i]["display_name"] = response[
                        "display_name"
                    ]

    return mdl_model_json


def prepare_duckdb(dataset_name: str):
    assert dataset_name in ["music", "nba", "ecommerce"]

    init_sqls = {
        "music": """
CREATE TABLE album AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/Music/Album.csv',header=true);
CREATE TABLE artist AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/Music/Artist.csv',header=true);
CREATE TABLE customer AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/Music/Customer.csv',header=true);
CREATE TABLE genre AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/Music/Genre.csv',header=true);
CREATE TABLE invoice AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/Music/Invoice.csv',header=true);
CREATE TABLE invoiceLine AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/Music/InvoiceLine.csv',header=true);
CREATE TABLE track AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/Music/Track.csv',header=true);
""",
        "nba": """
CREATE TABLE game AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/NBA/game.csv',header=true);
CREATE TABLE line_score AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/NBA/line_score.csv',header=true);
CREATE TABLE player_games AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/NBA/player_game.csv',header=true);
CREATE TABLE player AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/NBA/player.csv',header=true);
CREATE TABLE team AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/NBA/team.csv',header=true);
""",
        "ecommerce": """
CREATE TABLE customers AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/customers.csv',header=true);
CREATE TABLE order_items AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/order_items.csv',header=true);
CREATE TABLE orders AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/orders.csv',header=true);
CREATE TABLE payments AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/payments.csv',header=true);
CREATE TABLE products AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/products.csv',header=true);
CREATE TABLE reviews AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/E-Commerce/reviews.csv',header=true);
""",
    }

    api_url = "http://localhost:3000/api/graphql"

    user_data = {
        "properties": {
            "displayName": "my-duckdb",
            "initSql": init_sqls[dataset_name],
            "configurations": {"threads": 8},
            "extensions": ["httpfs", "aws"],
        },
        "type": "DUCKDB",
    }

    payload = {
        "query": """
        mutation SaveDataSource($data: DataSourceInput!) {
            saveDataSource(data: $data) {
                type
                properties
            }
        }
        """,
        "variables": {"data": user_data},
    }

    response = requests.post(api_url, json=payload)
    assert response.status_code == 200


def prepare_semantics(mdl_json: dict):
    semantics_preparation_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/semantics-preparations",
        json={
            "mdl": json.dumps(mdl_json),
            "id": st.session_state["deployment_id"],
        },
    )

    assert semantics_preparation_response.status_code == 200
    assert (
        semantics_preparation_response.json()["id"] == st.session_state["deployment_id"]
    )

    while (
        not st.session_state["semantics_preparation_status"]
        or st.session_state["semantics_preparation_status"] == "indexing"
    ):
        semantics_preparation_status_response = requests.get(
            f'{WREN_AI_SERVICE_BASE_URL}/v1/semantics-preparations/{st.session_state['deployment_id']}/status'
        )
        st.session_state[
            "semantics_preparation_status"
        ] = semantics_preparation_status_response.json()["status"]
        time.sleep(POLLING_INTERVAL)

    # reset relevant session_states
    st.session_state["query"] = None
    st.session_state["asks_results"] = None
    st.session_state["chosen_query_result"] = None
    st.session_state["asks_details_result"] = None
    st.session_state["preview_data_button_index"] = None
    st.session_state["preview_sql"] = None
    st.session_state["query_history"] = None

    if st.session_state["semantics_preparation_status"] == "failed":
        st.toast("An error occurred while preparing the semantics", icon="🚨")
    else:
        st.toast("Semantics is prepared successfully", icon="🎉")


def ask(query: str, query_history: Optional[dict] = None):
    st.session_state["query"] = query
    asks_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/asks",
        json={
            "query": query,
            "id": st.session_state["deployment_id"],
            "history": query_history,
        },
    )

    assert asks_response.status_code == 200
    query_id = asks_response.json()["query_id"]
    asks_status = None

    while not asks_status or (
        asks_status != "finished"
        and asks_status != "failed"
        and asks_status != "stopped"
    ):
        asks_status_response = requests.get(
            f"{WREN_AI_SERVICE_BASE_URL}/v1/asks/{query_id}/result"
        )
        assert asks_status_response.status_code == 200
        asks_status = asks_status_response.json()["status"]
        st.toast(f"The query processing status: {asks_status}")
        time.sleep(POLLING_INTERVAL)

    if asks_status == "finished":
        st.session_state["asks_results"] = asks_status_response.json()["response"]
    elif asks_status == "failed":
        st.error(
            f'An error occurred while processing the query: {asks_status_response.json()['error']}',
            icon="🚨",
        )


def ask_details():
    asks_details_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/ask-details",
        json={
            "query": st.session_state["chosen_query_result"]["query"],
            "sql": st.session_state["chosen_query_result"]["sql"],
            "summary": st.session_state["chosen_query_result"]["summary"],
        },
    )

    assert asks_details_response.status_code == 200
    query_id = asks_details_response.json()["query_id"]
    asks_details_status = None

    while (
        asks_details_status != "finished" and asks_details_status != "failed"
    ) or not asks_details_status:
        asks_details_status_response = requests.get(
            f"{WREN_AI_SERVICE_BASE_URL}/v1/ask-details/{query_id}/result"
        )
        assert asks_details_status_response.status_code == 200
        asks_details_status = asks_details_status_response.json()["status"]
        st.toast(f"The query processing status: {asks_details_status}")
        time.sleep(POLLING_INTERVAL)

    if asks_details_status == "finished":
        st.session_state["asks_details_result"] = asks_details_status_response.json()[
            "response"
        ]
    elif asks_details_status == "failed":
        st.error(
            f'An error occurred while processing the query: {asks_details_status_response.json()['error']}',
            icon="🚨",
        )
