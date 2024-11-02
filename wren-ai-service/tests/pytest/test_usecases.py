import asyncio
import base64
import json
import time
import uuid

import aiohttp
import orjson
import requests
import toml

from demo.utils import _get_connection_info, _replace_wren_engine_env_variables


def is_ai_service_ready(url: str):
    try:
        response = requests.get(f"{url}/health")
        return response.status_code == 200
    except requests.exceptions.ConnectionError:
        return False


def test_load_mdl_and_questions():
    try:
        with open("tests/data/hubspot/mdl.json", "r") as f:
            mdl_str = orjson.dumps(json.load(f)).decode("utf-8")

        data = toml.load("tests/data/hubspot/eval_dataset.toml")
        questions = [item["question"] for item in data.get("eval_dataset", [])]
    except FileNotFoundError:
        raise Exception(
            "tests/data/hubspot/mdl.json or tests/data/hubspot/eval_dataset.toml not found"
        )

    return mdl_str, questions


def setup_datasource(mdl_str: str):
    dataset_type = "bigquery"
    connection_info = _get_connection_info(dataset_type)
    _replace_wren_engine_env_variables(
        "wren_ibis",
        {
            "manifest": base64.b64encode(mdl_str.encode("utf-8")).decode("utf-8"),
            "source": dataset_type,
            "connection_info": base64.b64encode(orjson.dumps(connection_info)).decode(),
        },
    )
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


async def ask_question(question: str, url: str, semantics_preperation_id: str):
    print(f"preparing to ask question: {question}")
    async with aiohttp.ClientSession() as session:
        response = await session.post(
            f"{url}/v1/asks", json={"query": question, "id": semantics_preperation_id}
        )
        assert response.status == 200

        query_id = (await response.json())["query_id"]

        response = await session.get(f"{url}/v1/asks/{query_id}/result")
        while (await response.json())["status"] != "finished" and (
            await response.json()
        )["status"] != "failed":
            response = await session.get(f"{url}/v1/asks/{query_id}/result")

        assert response.status == 200

        print(f"got the result of question: {question}")
        return await response.json()


async def ask_questions(questions: list[str], url: str, semantics_preperation_id: str):
    tasks = []
    for question in questions:
        task = asyncio.ensure_future(
            ask_question(question, url, semantics_preperation_id)
        )
        tasks.append(task)
        await asyncio.sleep(10)

    return await asyncio.gather(*tasks)


if __name__ == "__main__":
    url = "http://localhost:5556"

    assert is_ai_service_ready(
        url
    ), "WrenAI AI service is not running, please start it first via 'just up && just start'"

    mdl_str, questions = test_load_mdl_and_questions()

    setup_datasource(mdl_str)

    semantics_preperation_id = deploy_mdl(mdl_str, url)

    # ask questions
    results = asyncio.run(ask_questions(questions, url, semantics_preperation_id))
    assert len(results) == len(questions)

    # count the number of results that are failed
    for question, result in zip(questions, results):
        print(f"question: {question}")
        print(json.dumps(result, indent=2))

    failed_count = sum(1 for result in results if result["status"] == "failed")
    assert (
        failed_count == 0
    ), f"got {failed_count} failed results in {len(results)} questions"
