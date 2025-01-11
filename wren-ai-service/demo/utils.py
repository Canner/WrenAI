import base64
import copy
import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import orjson
import pandas as pd
import requests
import sqlglot
import sqlparse
import sseclient
import streamlit as st
import yaml
from dotenv import load_dotenv

WREN_AI_SERVICE_BASE_URL = "http://localhost:5556"
WREN_ENGINE_API_URL = "http://localhost:8080"
WREN_IBIS_API_URL = "http://localhost:8000"
POLLING_INTERVAL = 0.5
DATA_SOURCES = ["duckdb", "bigquery", "postgres"]

load_dotenv()


def with_requests(url, headers):
    """Get a streaming response for the given event feed using requests."""
    return requests.get(url, stream=True, headers=headers)


def add_quotes(sql: str) -> Tuple[str, bool]:
    try:
        quoted_sql = sqlglot.transpile(sql, read="trino", identify=True)[0]
        return quoted_sql, True
    except Exception:
        return sql, False


def _get_connection_info(data_source: str):
    if data_source == "bigquery":
        return {
            "project_id": os.getenv("bigquery.project-id"),
            "dataset_id": os.getenv("bigquery.dataset-id"),
            "credentials": os.getenv("bigquery.credentials-key"),
        }
    elif data_source == "postgres":
        return {
            "host": os.getenv("postgres.host"),
            "port": int(os.getenv("postgres.port")),
            "database": os.getenv("postgres.database"),
            "user": os.getenv("postgres.user"),
            "password": os.getenv("postgres.password"),
        }


def _update_wren_engine_configs(configs: list[dict]):
    response = requests.patch(
        f"{WREN_ENGINE_API_URL}/v1/config",
        json=configs,
    )

    assert response.status_code == 200


def rerun_wren_engine(mdl_json: Dict, dataset_type: str, dataset: Optional[str] = None):
    assert dataset_type in DATA_SOURCES

    SOURCE = dataset_type
    MANIFEST = base64.b64encode(orjson.dumps(mdl_json)).decode()
    if dataset_type == "duckdb":
        _update_wren_engine_configs(
            [
                {
                    "name": "duckdb.connector.init-sql-path",
                    "value": "/usr/src/app/etc/duckdb-init.sql",
                },
            ]
        )

        _prepare_duckdb(dataset)
        _replace_wren_engine_env_variables("wren_engine", {"manifest": MANIFEST})
    else:
        WREN_IBIS_CONNECTION_INFO = base64.b64encode(
            orjson.dumps(_get_connection_info(dataset_type))
        ).decode()

        _replace_wren_engine_env_variables(
            "wren_ibis",
            {
                "manifest": MANIFEST,
                "source": SOURCE,
                "connection_info": WREN_IBIS_CONNECTION_INFO
                if dataset_type != "duckdb"
                else "",
            },
        )

    # wait for wren-ai-service to restart
    time.sleep(5)


def save_mdl_json_file(file_name: str, mdl_json: Dict):
    if not Path("demo/custom_dataset").exists():
        Path("demo/custom_dataset").mkdir()

    with open(f"demo/custom_dataset/{file_name}", "w", encoding="utf-8") as file:
        json.dump(mdl_json, file, indent=2)


def get_mdl_json(database_name: str):
    assert database_name in ["ecommerce", "hr"]

    with open(f"demo/sample_dataset/{database_name}_duckdb_mdl.json", "r") as f:
        mdl_json = json.load(f)

    return mdl_json


def get_data_from_wren_engine(
    sql: str,
    dataset_type: str,
    manifest: dict,
    limit: int = 100,
    return_df: bool = True,
):
    if dataset_type == "duckdb":
        quoted_sql, no_error = add_quotes(sql)
        assert no_error, f"Error in adding quotes to SQL: {sql}"

        response = requests.get(
            f"{WREN_ENGINE_API_URL}/v1/mdl/preview",
            json={
                "sql": quoted_sql,
                "manifest": manifest,
                "limit": limit,
            },
        )

        assert response.status_code == 200, response.text

        data = response.json()

        if return_df:
            column_names = [col["name"] for col in data["columns"]]

            return pd.DataFrame(data["data"], columns=column_names)
        else:
            return data
    else:
        quoted_sql, no_error = add_quotes(sql)
        assert no_error, f"Error in adding quotes to SQL: {sql}"
        response = requests.post(
            f"{WREN_IBIS_API_URL}/v2/connector/{dataset_type}/query?limit={limit}",
            json={
                "sql": quoted_sql,
                "manifestStr": base64.b64encode(orjson.dumps(manifest)).decode(),
                "connectionInfo": _get_connection_info(dataset_type),
                "limit": limit,
            },
        )

        assert response.status_code == 200, response.text

        data = response.json()

        if return_df:
            column_names = [col for col in data["columns"]]

            return pd.DataFrame(data["data"], columns=column_names)
        else:
            return data


# ui related
def show_query_history():
    if st.session_state["query_history"]:
        with st.expander("Query History", expanded=False):
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
    show_query_history()

    st.markdown("### Query")
    st.markdown(f"{st.session_state['query']}")

    st.markdown("### Query Result")
    if st.session_state["asks_results_type"] == "TEXT_TO_SQL":
        asks_result_count = len(st.session_state["asks_results"])
        ask_result_cols = st.columns(asks_result_count)
        for i, ask_result_col in enumerate(ask_result_cols):
            with ask_result_col:
                st.code(
                    body=sqlparse.format(
                        st.session_state["asks_results"][i]["sql"],
                        reindent=True,
                        keyword_case="upper",
                    ),
                    language="sql",
                )

        sql = st.session_state["asks_results"][0]["sql"]

        st.session_state["chosen_query_result"] = {
            "index": 0,
            "query": st.session_state["query"],
            "sql": sql,
        }

        # reset relevant session_states
        st.session_state["asks_details_result"] = None
        st.session_state["preview_data_button_index"] = None
        st.session_state["preview_sql"] = None
    elif st.session_state["asks_results_type"] == "MISLEADING_QUERY":
        st.markdown(
            "Misleading query detected. Please try again with a different query."
        )


def show_asks_details_results():
    st.markdown("### SQL Details of Result")
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

        # st.button(
        #     label="Preview Data",
        #     key=f"preview_data_btn_{i}",
        #     on_click=on_click_preview_data_button,
        #     args=[i, sqls],
        # )

        # if (
        #     st.session_state["preview_data_button_index"] is not None
        #     and st.session_state["preview_sql"] is not None
        #     and i == st.session_state["preview_data_button_index"]
        # ):
        #     st.markdown(
        #         f'##### Preview Data of Step {st.session_state['preview_data_button_index'] + 1}'
        #     )

        #     st.dataframe(
        #         get_data_from_wren_engine(
        #             st.session_state["preview_sql"],
        #             st.session_state["dataset_type"],
        #             st.session_state["mdl_json"],
        #         )
        #     )


def on_click_preview_data_button(index: int, full_sqls: List[str]):
    st.session_state["preview_data_button_index"] = index
    st.session_state["preview_sql"] = full_sqls[index]


def get_sql_analysis_results(sqls: List[str], manifest: Dict):
    results = []
    for sql in sqls:
        response = requests.get(
            f"{WREN_ENGINE_API_URL}/v1/analysis/sql",
            json={
                "sql": sql,
                "manifest": manifest,
            },
        )

        assert response.status_code == 200, response.json()

        results.append(response.json())

    return results


def on_click_sql_explanation_button(
    question: str,
    sqls: List[str],
    summaries: List[str],
    manifest: Dict,
):
    sql_analysis_results = get_sql_analysis_results(sqls, manifest)

    st.session_state["sql_explanation_question"] = question
    st.session_state["sql_analysis_results"] = sql_analysis_results
    st.session_state["sql_explanation_steps_with_analysis"] = [
        {"sql": sql, "summary": summary, "sql_analysis_results": sql_analysis_results}
        for sql, summary, sql_analysis_results in zip(
            sqls, summaries, sql_analysis_results
        )
    ]

    sql_explanation_results = sql_explanation()
    st.session_state["sql_explanation_results"] = sql_explanation_results
    if sql_explanation_results:
        st.session_state["sql_user_corrections_by_step"] = [
            [] for _ in range(len(sql_explanation_results))
        ]


def on_change_user_correction(
    step_idx: int, explanation_index: int, explanation_result: dict
):
    def _get_decision_point(explanation_result: dict):
        if explanation_result["type"] == "relation":
            if explanation_result["payload"]["type"] == "TABLE":
                return {
                    "type": explanation_result["type"],
                    "value": explanation_result["payload"]["tableName"],
                }
            elif explanation_result["payload"]["type"].endswith("_JOIN"):
                return {
                    "type": explanation_result["type"],
                    "value": explanation_result["payload"]["criteria"],
                }
        elif explanation_result["type"] == "filter":
            return {
                "type": explanation_result["type"],
                "value": explanation_result["payload"]["expression"],
            }
        elif explanation_result["type"] == "groupByKeys":
            return {
                "type": explanation_result["type"],
                "value": explanation_result["payload"]["keys"],
            }
        elif explanation_result["type"] == "sortings":
            return {
                "type": explanation_result["type"],
                "value": explanation_result["payload"]["expression"],
            }
        elif explanation_result["type"] == "selectItems":
            return {
                "type": explanation_result["type"],
                "value": explanation_result["payload"]["expression"],
            }

    decision_point = _get_decision_point(explanation_result)

    should_add_new_correction = True
    for i, sql_user_correction in enumerate(
        st.session_state["sql_user_corrections_by_step"][step_idx]
    ):
        if sql_user_correction["before"] == decision_point:
            if st.session_state[f"user_correction_{step_idx}_{explanation_index}"]:
                st.session_state["sql_user_corrections_by_step"][step_idx][i][
                    "after"
                ] = {
                    "type": "nl_expression",
                    "value": st.session_state[
                        f"user_correction_{step_idx}_{explanation_index}"
                    ],
                }
                should_add_new_correction = False
                break
            else:
                st.session_state["sql_user_corrections_by_step"][step_idx].pop(i)
                should_add_new_correction = False
                break

    if should_add_new_correction:
        st.session_state["sql_user_corrections_by_step"][step_idx].append(
            {
                "before": decision_point,
                "after": {
                    "type": "nl_expression",
                    "value": st.session_state[
                        f"user_correction_{step_idx}_{explanation_index}"
                    ],
                },
            }
        )


def on_click_sql_regeneration_button(
    ask_details_results: dict,
    sql_user_corrections_by_step: List[List[dict]],
):
    sql_regeneration_data = copy.deepcopy(ask_details_results)
    for i, (_, sql_user_corrections) in enumerate(
        zip(sql_regeneration_data["steps"], sql_user_corrections_by_step)
    ):
        if sql_user_corrections:
            sql_regeneration_data["steps"][i]["corrections"] = sql_user_corrections
        else:
            sql_regeneration_data["steps"][i]["corrections"] = []

    st.session_state["sql_regeneration_results"] = sql_regeneration(
        sql_regeneration_data
    )
    show_sql_regeneration_results_dialog(sql_user_corrections_by_step)


def on_click_adjust_chart(
    query: str,
    sql: str,
    chart_schema: dict,
    chart_type: str,
    language: str,
    reasoning: str,
    dataset_type: str,
    manifest: dict,
    limit: int = 100,
):
    show_chart_adjustment_dialog(
        query,
        sql,
        chart_schema,
        chart_type,
        language,
        reasoning,
        dataset_type,
        manifest,
        limit,
    )


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


def _prepare_duckdb(dataset_name: str):
    assert dataset_name in ["ecommerce", "hr"]

    init_sqls = {
        "ecommerce": """
CREATE TABLE olist_customers_dataset AS FROM read_parquet('https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_customers_dataset.parquet');
CREATE TABLE olist_order_items_dataset AS FROM read_parquet('https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_order_items_dataset.parquet');
CREATE TABLE olist_orders_dataset AS FROM read_parquet('https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_orders_dataset.parquet');
CREATE TABLE olist_order_payments_dataset AS FROM read_parquet('https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_order_payments_dataset.parquet');
CREATE TABLE olist_products_dataset AS FROM read_parquet('https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_products_dataset.parquet');
CREATE TABLE olist_order_reviews_dataset AS FROM read_parquet('https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_order_reviews_dataset.parquet');
CREATE TABLE olist_geolocation_dataset AS FROM read_parquet('https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_geolocation_dataset.parquet');
CREATE TABLE olist_sellers_dataset AS FROM read_parquet('https://assets.getwren.ai/sample_data/brazilian-ecommerce/olist_sellers_dataset.parquet');
CREATE TABLE product_category_name_translation AS FROM read_parquet('https://assets.getwren.ai/sample_data/brazilian-ecommerce/product_category_name_translation.parquet');
""",
        "hr": """
CREATE TABLE salaries AS FROM read_parquet('https://assets.getwren.ai/sample_data/employees/salaries.parquet');
CREATE TABLE titles AS FROM read_parquet('https://assets.getwren.ai/sample_data/employees/titles.parquet');
CREATE TABLE dept_emp AS FROM read_parquet('https://assets.getwren.ai/sample_data/employees/dept_emp.parquet');
CREATE TABLE departments AS FROM read_parquet('https://assets.getwren.ai/sample_data/employees/departments.parquet');
CREATE TABLE employees AS FROM read_parquet('https://assets.getwren.ai/sample_data/employees/employees.parquet');
CREATE TABLE dept_manager AS FROM read_parquet('https://assets.getwren.ai/sample_data/employees/dept_manager.parquet');
""",
    }

    with open("./tools/dev/etc/duckdb-init.sql", "w") as f:
        f.write("")

    response = requests.put(
        f"{WREN_ENGINE_API_URL}/v1/data-source/duckdb/settings/init-sql",
        data=init_sqls[dataset_name],
    )

    assert response.status_code == 200, response.text


def _replace_wren_engine_env_variables(engine_type: str, data: dict):
    assert engine_type in ("wren_engine", "wren_ibis")

    with open("config.yaml", "r") as f:
        configs = list(yaml.safe_load_all(f))

        for config in configs:
            if config.get("type") == "engine" and config.get("provider") == engine_type:
                for key, value in data.items():
                    config[key] = value
            if "pipes" in config:
                for i, pipe in enumerate(config["pipes"]):
                    if "engine" in pipe:
                        config["pipes"][i]["engine"] = engine_type

    with open("config.yaml", "w") as f:
        yaml.safe_dump_all(configs, f, default_flow_style=False)


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


def ask(query: str, timezone: str, query_history: Optional[dict] = None):
    st.session_state["query"] = query
    asks_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/asks",
        json={
            "query": query,
            "id": st.session_state["deployment_id"],
            "history": query_history,
            "configurations": {
                "language": st.session_state["language"],
                "timezone": {
                    "name": timezone,
                    "utc_offset": "",
                },
            },
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
        asks_type = asks_status_response.json()["type"]
        st.toast(f"The query processing status: {asks_status}")
        time.sleep(POLLING_INTERVAL)

    if asks_status == "finished":
        st.session_state["asks_results_type"] = asks_type
        if asks_type == "GENERAL":
            display_general_response(query_id)
        elif asks_type == "TEXT_TO_SQL":
            st.session_state["asks_results"] = asks_status_response.json()["response"]
        else:
            st.session_state["asks_results"] = asks_type
    elif asks_status == "failed":
        st.error(
            f'An error occurred while processing the query: {asks_status_response.json()['error']}',
            icon="🚨",
        )


def display_general_response(query_id: str):
    url = f"{WREN_AI_SERVICE_BASE_URL}/v1/asks/{query_id}/streaming-result"
    headers = {"Accept": "text/event-stream"}
    response = with_requests(url, headers)
    client = sseclient.SSEClient(response)

    markdown_content = ""
    placeholder = st.empty()

    for event in client.events():
        markdown_content += orjson.loads(event.data)["message"]
        placeholder.markdown(markdown_content)


def display_sql_answer(query_id: str):
    url = f"{WREN_AI_SERVICE_BASE_URL}/v1/sql-answers/{query_id}/streaming"
    headers = {"Accept": "text/event-stream"}
    response = with_requests(url, headers)
    client = sseclient.SSEClient(response)

    markdown_content = ""
    placeholder = st.empty()

    for event in client.events():
        markdown_content += orjson.loads(event.data)["message"]
        placeholder.markdown(markdown_content)


def get_sql_answer(
    query: str,
    sql: str,
    dataset_type: str,
    mdl_json: dict,
):
    sql_data = get_data_from_wren_engine(
        sql,
        dataset_type,
        mdl_json,
        return_df=False,
    )

    sql_answer_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/sql-answers",
        json={
            "query": query,
            "sql": sql,
            "sql_data": sql_data,
            "configurations": {
                "language": st.session_state["language"],
            },
        },
    )

    assert sql_answer_response.status_code == 200
    query_id = sql_answer_response.json()["query_id"]
    sql_answer_status = None

    while not sql_answer_status or (
        sql_answer_status != "succeeded" and sql_answer_status != "failed"
    ):
        sql_answer_status_response = requests.get(
            f"{WREN_AI_SERVICE_BASE_URL}/v1/sql-answers/{query_id}"
        )
        assert sql_answer_status_response.status_code == 200
        sql_answer_status = sql_answer_status_response.json()["status"]
        time.sleep(POLLING_INTERVAL)

    if sql_answer_status == "succeeded":
        display_sql_answer(query_id)
    elif sql_answer_status == "failed":
        st.error(
            f'An error occurred while processing the query: {sql_answer_status_response.json()['error']}',
            icon="🚨",
        )


def ask_details():
    asks_details_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/ask-details",
        json={
            "query": st.session_state["chosen_query_result"]["query"],
            "sql": st.session_state["chosen_query_result"]["sql"],
            "configurations": {
                "language": st.session_state["language"],
            },
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
        time.sleep(POLLING_INTERVAL)

    return asks_details_status_response.json()


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


def sql_regeneration(sql_regeneration_data: dict):
    sql_regeneration_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/sql-regenerations",
        json=sql_regeneration_data,
    )

    assert sql_regeneration_response.status_code == 200
    query_id = sql_regeneration_response.json()["query_id"]
    sql_regeneration_status = None

    while (
        sql_regeneration_status != "finished" and sql_regeneration_status != "failed"
    ) or not sql_regeneration_status:
        sql_regeneration_status_response = requests.get(
            f"{WREN_AI_SERVICE_BASE_URL}/v1/sql-regenerations/{query_id}/result"
        )
        assert sql_regeneration_status_response.status_code == 200
        sql_regeneration_status = sql_regeneration_status_response.json()["status"]
        st.toast(f"The query processing status: {sql_regeneration_status}")
        time.sleep(POLLING_INTERVAL)

    if sql_regeneration_status == "finished":
        return sql_regeneration_status_response.json()["response"]
    elif sql_regeneration_status == "failed":
        st.error(
            f'An error occurred while processing the query: {sql_regeneration_status_response.json()['error']}',
            icon="🚨",
        )
        return None


def fill_vega_lite_values(vega_lite_schema: dict, df: pd.DataFrame) -> dict:
    """Fill Vega-Lite schema values from pandas DataFrame based on x/y encodings.

    Args:
        vega_lite_schema: Original Vega-Lite schema
        df: Pandas DataFrame containing the data

    Returns:
        Updated Vega-Lite schema with values from DataFrame
    """
    # Create a copy to avoid modifying original
    schema = copy.deepcopy(vega_lite_schema)

    # Get field names from encoding
    fields = []
    for key in schema["encoding"].keys():
        fields.append(schema["encoding"][key]["field"])

    fields = list(set(fields))
    if transforms := schema.get("transform"):
        for transform in transforms:
            for _fold, _as in zip(transform.get("fold", []), transform.get("as", [])):
                try:
                    fields[fields.index(_as)] = _fold
                except ValueError:
                    pass

    # Convert DataFrame to list of dicts with just the needed fields
    values = df[fields].to_dict(orient="records")

    # Update schema values
    schema["data"]["values"] = values

    return schema


def generate_chart(
    query: str,
    sql: str,
    language: str,
    dataset_type: str,
    manifest: dict,
    limit: int = 100,
):
    chart_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/charts",
        json={
            "query": query,
            "sql": sql,
            "configurations": {
                "language": language,
            },
        },
    )

    assert chart_response.status_code == 200
    query_id = chart_response.json()["query_id"]
    charts_status = None

    while not charts_status or (
        charts_status != "finished"
        and charts_status != "failed"
        and charts_status != "stopped"
    ):
        charts_status_response = requests.get(
            f"{WREN_AI_SERVICE_BASE_URL}/v1/charts/{query_id}"
        )
        assert charts_status_response.status_code == 200
        charts_status = charts_status_response.json()["status"]
        time.sleep(POLLING_INTERVAL)

    sql_data_df = get_data_from_wren_engine(
        sql,
        dataset_type,
        manifest,
        limit,
    )
    chart_response = charts_status_response.json()
    if chart_result := chart_response.get("response"):
        if schema := chart_result.get("chart_schema"):
            filled_vega_lite_schema = fill_vega_lite_values(schema, sql_data_df)
            chart_response["response"]["chart_schema"] = filled_vega_lite_schema

    return chart_response


def adjust_chart(
    query: str,
    sql: str,
    chart_schema: dict,
    adjustment_option: dict,
    language: str,
    dataset_type: str,
    manifest: dict,
    limit: int = 100,
):
    chart_schema["data"]["values"] = []
    adjust_chart_response = requests.post(
        f"{WREN_AI_SERVICE_BASE_URL}/v1/chart-adjustments",
        json={
            "query": query,
            "sql": sql,
            "adjustment_option": adjustment_option,
            "chart_schema": chart_schema,
            "configurations": {
                "language": language,
            },
        },
    )

    assert adjust_chart_response.status_code == 200
    query_id = adjust_chart_response.json()["query_id"]
    charts_status = None

    while not charts_status or (
        charts_status != "finished"
        and charts_status != "failed"
        and charts_status != "stopped"
    ):
        charts_status_response = requests.get(
            f"{WREN_AI_SERVICE_BASE_URL}/v1/chart-adjustments/{query_id}"
        )
        assert charts_status_response.status_code == 200
        charts_status = charts_status_response.json()["status"]
        time.sleep(POLLING_INTERVAL)

    sql_data_df = get_data_from_wren_engine(
        sql,
        dataset_type,
        manifest,
        limit,
    )
    chart_response = charts_status_response.json()
    if chart_result := chart_response.get("response"):
        if schema := chart_result.get("chart_schema"):
            filled_vega_lite_schema = fill_vega_lite_values(schema, sql_data_df)
            chart_response["response"]["chart_schema"] = filled_vega_lite_schema

    return chart_response


@st.dialog(
    "Comparing SQL step-by-step breakdown before and after SQL Generation Feedback",
    width="large",
)
def show_sql_regeneration_results_dialog(
    sql_user_corrections_by_step: List[List[dict]],
):
    st.markdown("### Adjustments")
    st.json(sql_user_corrections_by_step, expanded=True)

    col1, col2 = st.columns(2)
    original_sqls = []
    with col1:
        st.markdown("### Before SQL Generation Feedback")
        st.markdown(
            f'Description: {st.session_state['asks_details_result']["description"]}'
        )

        sqls_with_cte = []
        for i, step in enumerate(st.session_state["asks_details_result"]["steps"]):
            st.markdown(f"#### Step {i + 1}")
            st.markdown(f'Summary: {step["summary"]}')

            sql = ""
            if sqls_with_cte:
                sql += "WITH " + ",\n".join(sqls_with_cte) + "\n\n"
            sql += step["sql"]
            original_sqls.append(sql)

            st.markdown("SQL")
            st.code(
                body=sqlparse.format(sql, reindent=True, keyword_case="upper"),
                language="sql",
            )
            sqls_with_cte.append(f"{step['cte_name']} AS ( {step['sql']} )")
    with col2:
        st.markdown("### After SQL Generation Feedback")

        if (
            st.session_state["sql_regeneration_results"]["description"]
            == st.session_state["asks_details_result"]["description"]
        ):
            st.markdown(
                f'Description: {st.session_state['sql_regeneration_results']["description"]}'
            )
        else:
            st.markdown(
                f':red[Description:] {st.session_state['sql_regeneration_results']["description"]}'
            )

        sqls_with_cte = []
        for i, step in enumerate(st.session_state["sql_regeneration_results"]["steps"]):
            st.markdown(f"#### Step {i + 1}")
            if (
                step["summary"]
                == st.session_state["asks_details_result"]["steps"][i]["summary"]
            ):
                st.markdown(f'Summary: {step["summary"]}')
            else:
                st.markdown(f':red[Summary:] {step["summary"]}')

            sql = ""
            if sqls_with_cte:
                sql += "WITH " + ",\n".join(sqls_with_cte) + "\n\n"
            sql += step["sql"]

            if sql == original_sqls[i]:
                st.markdown("SQL")
            else:
                st.markdown(":red[SQL:]")
            st.code(
                body=sqlparse.format(sql, reindent=True, keyword_case="upper"),
                language="sql",
            )
            sqls_with_cte.append(f"{step['cte_name']} AS ( {step['sql']} )")


def show_original_chart(chart_schema: dict, reasoning: str, chart_type: str):
    st.markdown("### Original")
    st.markdown(f"#### Chart Type: {chart_type}")
    st.markdown("#### Reasoning for making this chart")
    st.markdown(f"{reasoning}")
    st.markdown("#### Vega-Lite Schema")
    st.json(chart_schema, expanded=False)
    st.markdown("#### Chart Description")
    st.vega_lite_chart(chart_schema, use_container_width=True)


@st.dialog("Adjust Chart", width="large")
def show_chart_adjustment_dialog(
    query: str,
    sql: str,
    chart_schema: dict,
    chart_type: str,
    language: str,
    reasoning: str,
    dataset_type: str,
    manifest: dict,
    limit: int = 100,
):
    adjustment_chart_type = st.selectbox(
        "Chart Type", ["bar", "grouped_bar", "line", "pie", "stacked_bar", "area"]
    )
    x_axis = y_axis = color = x_offset = theta = None
    if adjustment_chart_type == "bar":
        x_axis = st.text_input("X Axis Field")
        y_axis = st.text_input("Y Axis Field")
    elif adjustment_chart_type == "grouped_bar":
        x_axis = st.text_input("X Axis Field")
        y_axis = st.text_input("Y Axis Field")
        x_offset = st.text_input("X Offset Field")
    elif adjustment_chart_type == "stacked_bar":
        x_axis = st.text_input("X Axis Field")
        y_axis = st.text_input("Y Axis Field")
        color = st.text_input("Stack Groups")
    elif adjustment_chart_type == "line":
        x_axis = st.text_input("X Axis Field")
        y_axis = st.text_input("Y Axis Field")
        color = st.text_input("Line Groups")
    elif adjustment_chart_type == "pie":
        theta = st.text_input("Value")
        color = st.text_input("Category")
    elif adjustment_chart_type == "area":
        x_axis = st.text_input("X Axis Field")
        y_axis = st.text_input("Y Axis Field")

    adjust_submit_button = st.button("Adjust")

    st.markdown("### Question")
    st.markdown(query)
    st.markdown("### SQL")
    st.code(
        body=sqlparse.format(
            sql,
            reindent=True,
            keyword_case="upper",
        ),
        language="sql",
    )

    show_original_chart(chart_schema, reasoning, chart_type)

    if adjust_submit_button:
        adjustment_option = {
            "chart_type": adjustment_chart_type,
            "x_axis": x_axis,
            "y_axis": y_axis,
            "color": color,
            "x_offset": x_offset,
            "theta": theta,
        }
        adjust_chart_response = adjust_chart(
            query,
            sql,
            chart_schema,
            adjustment_option,
            language,
            dataset_type,
            manifest,
            limit,
        )
        if adjust_chart_result := adjust_chart_response.get("response"):
            st.markdown("### Adjusted")
            if chart_type := adjust_chart_result["chart_type"]:
                st.markdown(f"#### Chart Type: {chart_type}")
            if reasoning := adjust_chart_result["reasoning"]:
                st.markdown("#### Reasoning for making this chart")
                st.markdown(f"{reasoning}")
            if vega_lite_schema := adjust_chart_result["chart_schema"]:
                st.markdown("#### Vega-Lite Schema")
                st.json(vega_lite_schema, expanded=False)
                st.vega_lite_chart(vega_lite_schema, use_container_width=True)
