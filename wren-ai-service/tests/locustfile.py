import json
import logging
import time
import uuid

import orjson
import requests
from locust import FastHttpUser, between, events, task

deployment_id = str(uuid.uuid4())
mdl_str = ""

with open("tests/data/book_2_mdl.json", "r") as f:
    mdl_str = orjson.dumps(json.load(f)).decode("utf-8")


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    requests.post(
        "http://localhost:5556/v1/semantics-preparations",
        json={
            "mdl": mdl_str,
            "id": deployment_id,
        },
    )

    status = "indexing"
    while status == "indexing":
        response = requests.get(
            f"http://localhost:5556/v1/semantics-preparations/{deployment_id}/status",
        )
        status = response.json()["status"]

    logging.info(f"Indexing status: {status}")
    logging.info("Indexing document completed. Start load testing.")


class SemanticsDescriptionsUser(FastHttpUser):
    @task
    def bulk_generate_description(self):
        with self.client.post(
            "/v1/semantics-descriptions",
            json={
                "mdl": {
                    "name": "all_star",
                    "properties": {},
                    "refsql": 'select * from "canner-cml".spider."baseball_1-all_star"',
                    "columns": [
                        {
                            "name": "player_id",
                            "type": "varchar",
                            "notnull": False,
                            "iscalculated": False,
                            "expression": "player_id",
                            "properties": {},
                        }
                    ],
                    "primarykey": "",
                },
                "model": "all_star",
                "identifiers": [
                    "model",
                ],
            },
            catch_response=True,
        ) as response:
            try:
                assert len(response.content) > 0
                response.success()
            except AssertionError as e:
                response.failure(str(e))


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
                except AssertionError as e:
                    response.failure(str(e))


class AskUser(FastHttpUser):
    wait_time = between(1, 5)

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

        status = ""

        while status in ["understanding", "searching", "generating"]:
            response = requests.get(f"/v1/asks/{query_id}/result")
            status = response.json()["status"]
            time.sleep(1.0)

        with self.client.get(
            url=f"/v1/asks/{query_id}/result",
            catch_response=True,
        ) as response:
            try:
                assert response.status_code == 200
                status = json.loads(response.content.decode("utf-8"))["status"]
                assert status == "finished"
                response.success()
            except AssertionError as e:
                response.failure(str(e))
