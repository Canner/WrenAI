import argparse
import base64
import json
import os
import time
from typing import Dict, Optional, Tuple

import orjson
import pandas as pd
import requests
import sqlglot
import yaml
from dotenv import load_dotenv

load_dotenv("tools/.env", override=True)

WREN_ENGINE_API_URL = "http://localhost:8080"
WREN_IBIS_API_URL = "http://localhost:8000"
DATA_SOURCES = ["duckdb", "bigquery", "postgres"]


def add_quotes(sql: str) -> Tuple[str, bool]:
    try:
        quoted_sql = sqlglot.transpile(sql, read=None, identify=True)[0]
        return quoted_sql, True
    except Exception as e:
        print(f"Error in adding quotes to SQL: {sql}")
        print(f"Error: {e}")
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
            "port": os.getenv("postgres.port"),
            "database": os.getenv("postgres.database"),
            "user": os.getenv("postgres.user"),
            "password": os.getenv("postgres.password"),
        }


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
            f"{WREN_IBIS_API_URL}/v3/connector/{dataset_type}/query?limit={limit}",
            json={
                "sql": quoted_sql,
                "manifestStr": base64.b64encode(orjson.dumps(manifest)).decode(),
                "connectionInfo": _get_connection_info(dataset_type),
            },
        )

        assert response.status_code == 200, response.text

        data = response.json()

        if return_df:
            column_names = [col for col in data["columns"]]

            return pd.DataFrame(data["data"], columns=column_names)
        else:
            return data


def _update_wren_engine_configs(configs: list[dict]):
    response = requests.patch(
        f"{WREN_ENGINE_API_URL}/v1/config",
        json=configs,
    )

    assert response.status_code == 200


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
                    if "engine" in pipe and pipe["name"] != "sql_functions_retrieval":
                        config["pipes"][i]["engine"] = engine_type

    with open("config.yaml", "w") as f:
        yaml.safe_dump_all(configs, f, default_flow_style=False)


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
                "connection_info": WREN_IBIS_CONNECTION_INFO,
            },
        )

    # wait for wren-ai-service to restart
    time.sleep(5)


def main():
    parser = argparse.ArgumentParser(
        description="Execute SQL query against MDL manifest"
    )

    parser.add_argument(
        "--mdl-path",
        type=str,
        required=True,
        help="Path to MDL JSON file",
    )

    parser.add_argument(
        "--data-source",
        type=str,
        default="bigquery",
        choices=["bigquery", "duckdb", "postgres"],
        help="Data source (default: bigquery)",
    )

    parser.add_argument(
        "--sample-dataset",
        type=str,
        default="ecommerce",
        choices=["ecommerce", "hr", ""],
        help="Sample dataset (default: ecommerce)",
    )

    args = parser.parse_args()

    mdl_path = args.mdl_path
    data_source = args.data_source
    sample_dataset = args.sample_dataset

    # Load MDL JSON file
    try:
        with open(mdl_path, "r") as f:
            mdl_json = json.load(f)
    except FileNotFoundError:
        print(f"Error: MDL file not found at {mdl_path}")
        return
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON in MDL file {mdl_path}")
        return

    rerun_wren_engine(mdl_json, data_source, sample_dataset)

    # Execute query
    print("Enter SQL query (end with semicolon on a new line to execute, 'q' to quit):")
    lines = []
    while True:
        line = input()
        if line.strip() == "q":
            break
        if line.strip() == ";":
            command = "\n".join(lines)
            lines = []
            try:
                df = get_data_from_wren_engine(
                    sql=command,
                    dataset_type=data_source,
                    manifest=mdl_json,
                    limit=50,
                )
                print(f"\nExecution result:\n{df.to_string()}\n")
            except Exception as e:
                print(f"\nError executing query: {str(e)}")
        else:
            lines.append(line)


if __name__ == "__main__":
    main()
