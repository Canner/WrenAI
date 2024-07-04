import base64
import json
import os
import re
import time
from pathlib import Path
from typing import Dict, List, Optional

import orjson
import pandas as pd
import requests
import sqlparse
import streamlit as st
from dotenv import load_dotenv

WREN_AI_SERVICE_BASE_URL = "http://localhost:5556"
WREN_ENGINE_API_URL = "http://localhost:8080"
WREN_IBIS_API_URL = "http://localhost:8000"
POLLING_INTERVAL = 0.5
DATA_SOURCES = ["duckdb", "bigquery", "postgres"]

load_dotenv()


def _update_wren_engine_configs(configs: list[dict]):
    response = requests.patch(
        f"{WREN_ENGINE_API_URL}/v1/config",
        json=configs,
    )

    assert response.status_code == 200


def rerun_wren_engine(mdl_json: Dict, dataset_type: str):
    assert dataset_type in DATA_SOURCES

    if dataset_type == "duckdb":
        # replace the values of ENGINE to wren-ui in ../.env.dev
        with open(".env.dev", "r") as f:
            lines = f.readlines()
            for i, line in enumerate(lines):
                if line.startswith("ENGINE"):
                    lines[i] = "ENGINE=wren_engine\n"
                    break
        with open(".env.dev", "w") as f:
            f.writelines(lines)

        _update_wren_engine_configs(
            [{"name": "wren.datasource.type", "value": "duckdb"}]
        )
        st.toast("Wren Engine is being re-run", icon="⏳")

        response = requests.post(
            f"{WREN_ENGINE_API_URL}/v1/mdl/deploy",
            json={
                "manifest": mdl_json,
                "version": "latest",
            },
        )

        assert response.status_code == 202, response.json()

        st.toast("Wren Engine is ready", icon="🎉")
    else:
        WREN_IBIS_SOURCE = dataset_type
        WREN_IBIS_MANIFEST = base64.b64encode(orjson.dumps(mdl_json)).decode()
        if dataset_type == "bigquery":
            WREN_IBIS_CONNECTION_INFO = base64.b64encode(
                orjson.dumps(
                    {
                        "project_id": os.getenv("bigquery.project-id"),
                        "dataset_id": os.getenv("bigquery.dataset-id"),
                        "credentials": os.getenv("bigquery.credentials-key"),
                    }
                )
            ).decode()
        elif dataset_type == "postgres":
            WREN_IBIS_CONNECTION_INFO = base64.b64encode(
                orjson.dumps(
                    {
                        "host": os.getenv("postgres.host"),
                        "port": int(os.getenv("postgres.port")),
                        "database": os.getenv("postgres.database"),
                        "user": os.getenv("postgres.user"),
                        "password": os.getenv("postgres.password"),
                    }
                )
            ).decode()

        # replace the values of WREN_IBIS_xxx to ../.env.dev
        with open(".env.dev", "r") as f:
            lines = f.readlines()
            for i, line in enumerate(lines):
                if line.startswith("ENGINE"):
                    lines[i] = "ENGINE=wren-ibis\n"
                elif line.startswith("WREN_IBIS_SOURCE"):
                    lines[i] = f"WREN_IBIS_SOURCE={WREN_IBIS_SOURCE}\n"
                elif line.startswith("WREN_IBIS_MANIFEST"):
                    lines[i] = f"WREN_IBIS_MANIFEST={WREN_IBIS_MANIFEST}\n"
                elif line.startswith("WREN_IBIS_CONNECTION_INFO"):
                    lines[
                        i
                    ] = f"WREN_IBIS_CONNECTION_INFO={WREN_IBIS_CONNECTION_INFO}\n"
        with open(".env.dev", "w") as f:
            f.writelines(lines)

    # wait for wren-ai-service to restart
    time.sleep(5)


def save_mdl_json_file(file_name: str, mdl_json: Dict):
    if not Path("custom_dataset").exists():
        Path("custom_dataset").mkdir()

    with open(f"custom_dataset/{file_name}", "w", encoding="utf-8") as file:
        json.dump(mdl_json, file, indent=2)


def get_mdl_json(database_name: str):
    assert database_name in ["music", "nba", "ecommerce"]

    with open(f"demo/sample_dataset/{database_name}_duckdb_mdl.json", "r") as f:
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
def get_data_from_wren_engine(sql: str, dataset_type: str):
    assert dataset_type in DATA_SOURCES

    if dataset_type == "duckdb":
        response = requests.get(
            f"{WREN_ENGINE_API_URL}/v1/mdl/preview",
            json={
                "sql": sql,
            },
        )

        if response.status_code != 200:
            st.error(response.json())
            st.stop()

        data = response.json()
        column_names = [f'{i}_{col["name"]}' for i, col in enumerate(data["columns"])]

        return pd.DataFrame(data["data"], columns=column_names)
    else:
        connection_info = {
            "bigquery": {
                "project_id": os.getenv("bigquery.project-id"),
                "dataset_id": os.getenv("bigquery.dataset-id"),
                "credentials": os.getenv("bigquery.credentials-key"),
            },
            "postgres": {
                "host": os.getenv("postgres.host"),
                "port": int(os.getenv("postgres.port"))
                if os.getenv("postgres.port")
                else 5432,
                "database": os.getenv("postgres.database"),
                "user": os.getenv("postgres.user"),
                "password": os.getenv("postgres.password"),
            },
        }

        response = requests.post(
            f"{WREN_IBIS_API_URL}/v2/ibis/{dataset_type}/query",
            json={
                "sql": sql,
                "manifestStr": base64.b64encode(
                    orjson.dumps(st.session_state["mdl_json"])
                ).decode(),
                "connectionInfo": connection_info[dataset_type],
            },
        )

        if response.status_code != 200:
            st.error(response.json())
            st.stop()

        data = response.json()
        column_names = [f"{i}_{col}" for i, col in enumerate(data["columns"])]

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


def show_asks_details_results(query: str):
    st.markdown(
        f'### Details of Result {st.session_state['chosen_query_result']['index'] + 1}'
    )
    st.markdown(
        f'Description: {st.session_state['asks_details_result']["description"]}'
    )

    sqls_with_cte = []
    sqls = []
    summaries = []
    for i, step in enumerate(st.session_state["asks_details_result"]["steps"]):
        st.markdown(f"#### Step {i + 1}")
        st.markdown(f'Summary: {step["summary"]}')

        sql = ""
        if sqls_with_cte:
            sql += "WITH " + ",\n".join(sqls_with_cte) + "\n\n"
        sql += step["sql"]
        sqls.append(sql)
        summaries.append(step["summary"])

        st.code(
            body=sqlparse.format(sql, reindent=True, keyword_case="upper"),
            language="sql",
        )
        sqls_with_cte.append(f"{step['cte_name']} AS ( {step['sql']} )")

        if (
            st.session_state["sql_analysis_results"]
            and st.session_state["sql_explanation_results"]
        ):
            _col1, _col2 = st.columns(2)
            with _col1:
                st.markdown("**SQL Analysis Results With Cte Removed**")
                st.json(
                    list(
                        filter(
                            lambda analysis_result: not analysis_result[
                                "isSubqueryOrCte"
                            ],
                            st.session_state["sql_analysis_results"][i],
                        )
                    )
                )
            with _col2:
                st.markdown("**SQL Explanation Results**")
                st.json(st.session_state["sql_explanation_results"][i])

        st.button(
            label="Preview Data",
            key=f"preview_data_btn_{i}",
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
                    st.session_state["dataset_type"],
                )
            )

    st.markdown("---")
    st.button(
        label="SQL Explanation",
        key="sql_explanation_btn",
        on_click=on_click_sql_explanation_button,
        args=[query, sqls, summaries],
        use_container_width=True,
    )


def on_click_preview_data_button(index: int, full_sqls: List[str]):
    st.session_state["preview_data_button_index"] = index
    st.session_state["preview_sql"] = full_sqls[index]


def get_sql_analysis_results(sqls: List[str]):
    results = []
    for sql in sqls:
        print(f"SQL: {sql}")
        response = requests.get(
            f"{WREN_ENGINE_API_URL}/v1/analysis/sql",
            json={
                "sql": sql,
            },
        )

        assert response.status_code == 200

        results.append(response.json())

    return results


def on_click_sql_explanation_button(
    question: str,
    sqls: List[str],
    summaries: List[str],
):
    sql_analysis_results = get_sql_analysis_results(sqls)

    st.session_state["sql_explanation_question"] = question
    st.session_state["sql_analysis_results"] = sql_analysis_results
    st.session_state["sql_explanation_steps_with_analysis"] = [
        {"sql": sql, "summary": summary, "sql_analysis_results": sql_analysis_results}
        for sql, summary, sql_analysis_results in zip(
            sqls, summaries, sql_analysis_results
        )
    ]

    st.session_state["sql_explanation_results"] = sql_explanation()


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

    DATASET_VERSION = "v0.3.0"

    init_sqls = {
        "music": f"""
CREATE TABLE album AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/Music/Album.csv',header=true);
CREATE TABLE artist AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/Music/Artist.csv',header=true);
CREATE TABLE customer AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/Music/Customer.csv',header=true);
CREATE TABLE genre AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/Music/Genre.csv',header=true);
CREATE TABLE invoice AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/Music/Invoice.csv',header=true);
CREATE TABLE invoiceLine AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/Music/InvoiceLine.csv',header=true);
CREATE TABLE track AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/Music/Track.csv',header=true);
""",
        "nba": f"""
CREATE TABLE game AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/NBA/game.csv',header=true);
CREATE TABLE line_score AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/NBA/line_score.csv',header=true);
CREATE TABLE player_games AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/NBA/player_game.csv',header=true);
CREATE TABLE player AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/NBA/player.csv',header=true);
CREATE TABLE team AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/NBA/team.csv',header=true);
""",
        "ecommerce": f"""
CREATE TABLE customers AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/E-Commerce/customers.csv',header=true);
CREATE TABLE order_items AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/E-Commerce/order_items.csv',header=true);
CREATE TABLE orders AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/E-Commerce/orders.csv',header=true);
CREATE TABLE payments AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/E-Commerce/payments.csv',header=true);
CREATE TABLE products AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/E-Commerce/products.csv',header=true);
CREATE TABLE reviews AS FROM read_csv('https://wrenai-public.s3.amazonaws.com/demo/{DATASET_VERSION}/E-Commerce/reviews.csv',header=true);
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
            "mdl": orjson.dumps(mdl_json).decode("utf-8"),
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
        st.session_state["sql_explanation_question"] = None
        st.session_state["sql_explanation_steps_with_analysis"] = None
        st.session_state["sql_analysis_results"] = None
        st.session_state["sql_explanation_results"] = None
    elif asks_details_status == "failed":
        st.error(
            f'An error occurred while processing the query: {asks_details_status_response.json()['error']}',
            icon="🚨",
        )


def sql_explanation():
    sql_explanation_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/sql-explanations",
        json={
            "question": st.session_state["sql_explanation_question"],
            "steps_with_analysis_results": st.session_state[
                "sql_explanation_steps_with_analysis"
            ],
        },
    )

    assert sql_explanation_response.status_code == 200
    query_id = sql_explanation_response.json()["query_id"]
    sql_explanation_status = None

    while (
        sql_explanation_status != "finished" and sql_explanation_status != "failed"
    ) or not sql_explanation_status:
        sql_explanation_status_response = requests.get(
            f"{WREN_AI_SERVICE_BASE_URL}/v1/sql-explanations/{query_id}/result"
        )
        assert sql_explanation_status_response.status_code == 200
        sql_explanation_status = sql_explanation_status_response.json()["status"]
        st.toast(f"The query processing status: {sql_explanation_status}")
        time.sleep(POLLING_INTERVAL)

    if sql_explanation_status == "finished":
        return sql_explanation_status_response.json()["response"]
    elif sql_explanation_status == "failed":
        st.error(
            f'An error occurred while processing the query: {sql_explanation_status_response.json()['error']}',
            icon="🚨",
        )
        return None
