import argparse
import asyncio
import base64
import json
import os
import time
import uuid
from datetime import datetime

import aiohttp
import orjson
import requests
import sqlparse
import yaml
from dotenv import load_dotenv

load_dotenv(".env.dev", override=True)

WREN_AI_SERVICE_BASE_URL = "http://localhost:5556"
WREN_ENGINE_API_URL = "http://localhost:8080"


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


def _update_wren_engine_configs(configs: list[dict]):
    response = requests.patch(
        f"{WREN_ENGINE_API_URL}/v1/config",
        json=configs,
    )

    assert response.status_code == 200


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


def is_ai_service_ready(url: str):
    try:
        response = requests.get(f"{url}/health")
        return response.status_code == 200
    except requests.exceptions.ConnectionError:
        return False


def test_load_mdl_and_questions(usecases: list[str]):
    mdls_and_questions = {}
    for usecase in usecases:
        try:
            with open(f"tests/data/usecases/{usecase}/mdl.json", "r") as f:
                mdl_str = orjson.dumps(json.load(f)).decode("utf-8")

            with open(f"tests/data/usecases/{usecase}/questions.yaml", "r") as f:
                questions = yaml.safe_load(f)

            mdls_and_questions[usecase] = {
                "mdl_str": mdl_str,
                "questions": [question["question"] for question in questions],
            }
        except FileNotFoundError:
            raise Exception(
                f"tests/data/usecases/{usecase}/mdl.json or tests/data/usecases/{usecase}/questions.yaml not found"
            )

    return mdls_and_questions


def setup_datasource(mdl_str: str, dataset: str, dataset_type: str, url: str):
    assert dataset_type in ["bigquery", "duckdb"]

    manifest = base64.b64encode(mdl_str.encode("utf-8")).decode("utf-8")
    if dataset_type == "bigquery":
        connection_info = _get_connection_info(dataset_type)
        _replace_wren_engine_env_variables(
            "wren_ibis",
            {
                "manifest": manifest,
                "source": dataset_type,
                "connection_info": base64.b64encode(
                    orjson.dumps(connection_info)
                ).decode(),
            },
        )
    elif dataset_type == "duckdb":
        _update_wren_engine_configs(
            [
                {
                    "name": "duckdb.connector.init-sql-path",
                    "value": "/usr/src/app/etc/duckdb-init.sql",
                },
            ]
        )
        _prepare_duckdb(dataset)
        _replace_wren_engine_env_variables("wren_engine", {"manifest": manifest})

    ready = False
    while not ready:
        ready = is_ai_service_ready(url)
        time.sleep(1)


def deploy_mdl(mdl_str: str, url: str):
    semantics_preperation_id = str(uuid.uuid4())
    response = requests.post(
        f"{url}/v1/semantics-preparations",
        json={"mdl": mdl_str, "id": semantics_preperation_id},
    )
    assert response.status_code == 200

    status = "indexing"
    while status == "indexing":
        response = requests.get(
            f"{url}/v1/semantics-preparations/{semantics_preperation_id}/status"
        )

        assert response.status_code == 200
        status = response.json()["status"]

    assert status == "finished"

    return semantics_preperation_id


async def ask_question(
    question: str, url: str, semantics_preperation_id: str, lang: str = "English"
):
    print(f"preparing to ask question: {question}")
    async with aiohttp.ClientSession() as session:
        start = time.time()
        response = await session.post(
            f"{url}/v1/asks",
            json={
                "query": question,
                "id": semantics_preperation_id,
                "configurations": {"language": lang},
            },
        )
        assert response.status == 200

        query_id = (await response.json())["query_id"]

        response = await session.get(f"{url}/v1/asks/{query_id}/result")
        while (await response.json())["status"] != "finished" and (
            await response.json()
        )["status"] != "failed":
            response = await session.get(f"{url}/v1/asks/{query_id}/result")

        assert response.status == 200

        result = await response.json()
        result["time"] = time.time() - start

        print(f"got the result of question: {question}")
        return result


async def ask_questions(
    questions: list[str], url: str, semantics_preperation_id: str, lang: str = "English"
):
    tasks = []
    for question in questions:
        task = asyncio.ensure_future(
            ask_question(question, url, semantics_preperation_id, lang)
        )
        tasks.append(task)
        await asyncio.sleep(10)

    return await asyncio.gather(*tasks)


def str_presenter(dumper, data):
    """configures yaml for dumping multiline strings
    Ref: https://stackoverflow.com/questions/8640959/how-can-i-control-what-scalar-form-pyyaml-uses-for-my-data"""
    if len(data.splitlines()) > 1:  # check for multiline string
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


if __name__ == "__main__":
    usecase_to_dataset_type = {
        "hubspot": "bigquery",
        "ga4": "bigquery",
        "woocommerce": "bigquery",
        "stripe": "bigquery",
        "ecommerce": "duckdb",
        # "hr": "duckdb",
        "facebook_marketing": "bigquery",
        "google_ads": "bigquery",
    }
    usecases = list(usecase_to_dataset_type.keys())

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--usecases",
        type=str,
        nargs="+",
        default=["all"],
        choices=["all"] + usecases,
    )
    parser.add_argument(
        "--lang",
        type=str,
        choices=["en", "zh-TW", "zh-CN"],
        default="en",
    )
    args = parser.parse_args()

    if "all" not in args.usecases:
        usecases = args.usecases

    lang = {
        "en": "English",
        "zh-TW": "Traditional Chinese",
        "zh-CN": "Simplified Chinese",
    }[args.lang]

    assert is_ai_service_ready(
        WREN_AI_SERVICE_BASE_URL
    ), "WrenAI AI service is not running, please start it first via 'just up && just start'"

    mdls_and_questions_by_usecase = test_load_mdl_and_questions(usecases)

    final_results = {}
    for usecase, data in mdls_and_questions_by_usecase.items():
        print(f"testing usecase: {usecase}")

        setup_datasource(
            data["mdl_str"],
            usecase,
            usecase_to_dataset_type[usecase],
            WREN_AI_SERVICE_BASE_URL,
        )

        semantics_preperation_id = deploy_mdl(data["mdl_str"], WREN_AI_SERVICE_BASE_URL)

        # ask questions
        results = asyncio.run(
            ask_questions(
                data["questions"],
                WREN_AI_SERVICE_BASE_URL,
                semantics_preperation_id,
                lang,
            )
        )
        assert len(results) == len(data["questions"])

        final_results[usecase] = {
            "results": [],
        }
        # count the number of results that are failed
        for question, result in zip(data["questions"], results):
            if (
                result.get("status") == "finished"
                and not result.get("error")
                and result.get("response", [])
            ):
                result["response"][0]["sql"] = sqlparse.format(
                    result["response"][0]["sql"],
                    reindent=True,
                    keyword_case="upper",
                )

            final_results[usecase]["results"].append(
                {
                    "question": question,
                    "result": result,
                }
            )

        final_results[usecase]["total"] = len(results)
        final_results[usecase]["failed"] = sum(
            1 for result in results if result["status"] == "failed"
        )

    # write final_results to a json file
    if not os.path.exists("outputs"):
        os.makedirs("outputs")

    with open(
        f"outputs/usecases_final_results_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.yaml",
        "w",
    ) as f:
        yaml.add_representer(str, str_presenter)
        yaml.representer.SafeRepresenter.add_representer(
            str, str_presenter
        )  # to use with safe_dum
        yaml.safe_dump(final_results, f, sort_keys=False, allow_unicode=True)
