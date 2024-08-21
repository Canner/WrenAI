import json
import logging
import os
import time
import uuid

import orjson
import requests
from locust import FastHttpUser, events, task

from src.utils import load_env_vars

deployment_id = str(uuid.uuid4())
mdl_str = ""
finished_ask_query = []
successful_ask_query = []
finished_ask_details_query = []
successful_ask_details_query = []

load_env_vars()

with open(f"tests/data/{os.getenv("DATASET_NAME")}_mdl.json", "r") as f:
    mdl_str = orjson.dumps(json.load(f)).decode("utf-8")


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    logging.info(f"Using dataset: {os.getenv("DATASET_NAME")}")

    requests.post(
        f"{environment.host}/v1/semantics-preparations",
        json={
            "mdl": mdl_str,
            "id": deployment_id,
        },
    )

    status = "indexing"
    while status == "indexing":
        response = requests.get(
            f"{environment.host}/v1/semantics-preparations/{deployment_id}/status",
        )
        status = response.json()["status"]

    logging.info(f"Indexing status: {status}")
    logging.info("Indexing document completed. Start load testing.")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    logging.info(f"Total finished ask queries: {len(finished_ask_query)}")
    logging.info(f"Total successful ask queries: {len(successful_ask_query)}")
    logging.info(
        f"Total finished ask details queries: {len(finished_ask_details_query)}"
    )
    logging.info(
        f"Total successful ask details queries: {len(successful_ask_details_query)}"
    )


class IndexingUser(FastHttpUser):
    @task
    def indexing(self):
        semantics_preperation_id = str(uuid.uuid4())

        with self.client.post(
            url="/v1/semantics-preparations",
            json={
                "mdl": mdl_str,
                "id": semantics_preperation_id,
            },
            catch_response=True,
        ) as response:
            try:
                assert response.status_code == 200
                assert (
                    json.loads(response.content.decode("utf-8"))["id"]
                    == semantics_preperation_id
                )
            except AssertionError:
                response.failure(response.content.decode("utf-8"))

        status = "indexing"
        while status == "indexing":
            with self.client.get(
                url=f"/v1/semantics-preparations/{semantics_preperation_id}/status",
                catch_response=True,
            ) as response:
                try:
                    assert response.status_code == 200
                    status = json.loads(response.content.decode("utf-8"))["status"]
                    assert status in ["indexing", "finished"]
                    response.success()
                    time.sleep(1.0)
                except AssertionError:
                    response.failure(response.content.decode("utf-8"))


class AskUser(FastHttpUser):
    @task
    def ask(self):
        with self.client.post(
            url="/v1/asks",
            json={
                "query": "How many books?",
                "id": deployment_id,
            },
            catch_response=True,
        ) as response:
            query_id = json.loads(response.content.decode("utf-8"))["query_id"]
            try:
                assert response.status_code == 200
                assert query_id != ""
                response.success()
            except AssertionError:
                response.failure(response.content.decode("utf-8"))

        status = "understanding"

        while status in ["understanding", "searching", "generating"]:
            with self.client.get(
                url=f"/v1/asks/{query_id}/result",
                catch_response=True,
            ) as response:
                try:
                    assert response.status_code == 200
                    status = json.loads(response.content.decode("utf-8"))["status"]
                    assert status in [
                        "understanding",
                        "searching",
                        "generating",
                        "finished",
                    ]
                    response.success()
                    if status == "finished":
                        finished_ask_query.append(query_id)
                        successful_ask_query.append(response.content.decode("utf-8"))
                    else:
                        time.sleep(1.0)
                except AssertionError:
                    finished_ask_query.append(query_id)
                    response.failure(response.content.decode("utf-8"))


class AskDetailsUser(FastHttpUser):
    @task
    def ask(self):
        with self.client.post(
            url="/v1/ask-details",
            json={
                "query": "How many books are there?",
                "sql": "SELECT COUNT(*) FROM book",
                "summary": "Retrieve the number of books",
            },
            catch_response=True,
        ) as response:
            query_id = json.loads(response.content.decode("utf-8"))["query_id"]
            try:
                assert response.status_code == 200
                assert query_id != ""
                response.success()
            except AssertionError:
                response.failure(response.content.decode("utf-8"))

        status = "understanding"

        while status in ["understanding", "searching", "generating"]:
            with self.client.get(
                url=f"/v1/ask-details/{query_id}/result",
                catch_response=True,
            ) as response:
                try:
                    assert response.status_code == 200
                    status = json.loads(response.content.decode("utf-8"))["status"]
                    assert status in [
                        "understanding",
                        "searching",
                        "generating",
                        "finished",
                    ]
                    response.success()
                    if status == "finished":
                        finished_ask_details_query.append(query_id)
                        successful_ask_details_query.append(
                            response.content.decode("utf-8")
                        )
                    else:
                        time.sleep(1.0)
                except AssertionError:
                    finished_ask_details_query.append(query_id)
                    response.failure(response.content.decode("utf-8"))


class DummyUser(FastHttpUser):
    @task
    def dummy(self):
        self.client.get(url="/dev/dummy")


class DummyAskUser(FastHttpUser):
    @task
    def ask(self):
        with self.client.post(
            url="/dev/dummy-asks",
            json={
                "query": "How many books?",
                "id": deployment_id,
            },
            catch_response=True,
        ) as response:
            query_id = json.loads(response.content.decode("utf-8"))["query_id"]
            try:
                assert response.status_code == 200
                assert query_id != ""
                response.success()
            except AssertionError:
                response.failure(response.content.decode("utf-8"))

        status = "understanding"

        while status in ["understanding", "searching", "generating"]:
            with self.client.get(
                url=f"/dev/dummy-asks/{query_id}/result",
                catch_response=True,
            ) as response:
                try:
                    assert response.status_code == 200
                    status = json.loads(response.content.decode("utf-8"))["status"]
                    assert status in [
                        "understanding",
                        "searching",
                        "generating",
                        "finished",
                    ]
                    response.success()
                    if status == "finished":
                        finished_ask_query.append(query_id)
                        successful_ask_query.append(response.content.decode("utf-8"))
                    else:
                        time.sleep(1.0)
                except AssertionError:
                    finished_ask_query.append(query_id)
                    response.failure(response.content.decode("utf-8"))
