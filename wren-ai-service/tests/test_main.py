import json
import uuid

import pytest
from fastapi.testclient import TestClient

from src.__main__ import app


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return json.dumps(json.load(f))


def test_semantics_description():
    # using TestClient as a context manager would trigger startup/shutdown events as well as lifespans.
    with TestClient(app) as client:
        response = client.post(
            url="/v1/semantics-descriptions/",
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
                "identifiers": ["column@player_id"],
            },
        )

        assert response.status_code == 200
        assert len(response.json()) == 1
        assert response.json()[0]["identifier"] == "column@player_id"
        assert (
            response.json()[0]["display_name"] is not None
            and response.json()[0]["display_name"] != ""
        )
        assert (
            response.json()[0]["description"] is not None
            and response.json()[0]["description"] != ""
        )


def test_semantics_preparations(mdl_str: str):
    with TestClient(app) as client:
        semantics_preperation_id = str(uuid.uuid4())

        response = client.post(
            url="/v1/semantics-preparations/",
            json={
                "mdl": mdl_str,
                "id": semantics_preperation_id,
            },
        )

        assert response.status_code == 200
        assert response.json()["id"] == semantics_preperation_id

        status = "indexing"

        while status == "indexing":
            response = client.get(
                url=f"/v1/semantics-preparations/{semantics_preperation_id}/status/"
            )

            assert response.status_code == 200
            assert response.json()["status"] in ["indexing", "finished", "failed"]
            status = response.json()["status"]

        assert status == "finished"


def test_asks(mdl_str: str):
    with TestClient(app) as client:
        semantics_preperation_id = str(uuid.uuid4())

        response = client.post(
            url="/v1/semantics-preparations/",
            json={
                "mdl": mdl_str,
                "id": semantics_preperation_id,
            },
        )

        status = "indexing"
        while status != "finished":
            response = client.get(
                url=f"/v1/semantics-preparations/{semantics_preperation_id}/status/"
            )
            status = response.json()["status"]

        response = client.post(
            url="/v1/asks",
            json={
                "query": "How many books are there?",
                "id": semantics_preperation_id,
            },
        )

        assert response.status_code == 200
        assert response.json()["query_id"] != ""

        query_id = response.json()["query_id"]

        response = client.get(url=f"/v1/asks/{query_id}/result/")
        while response.json()["status"] != "finished":
            response = client.get(url=f"/v1/asks/{query_id}/result/")

        assert response.status_code == 200
        assert response.json()["status"] == "finished"
        # assert len(response.json()["response"]) == 3
        for r in response.json()["response"]:
            assert r["sql"] is not None and r["sql"] != ""
            assert r["summary"] is not None and r["summary"] != ""


def test_stop_asks(mdl_str: str):
    with TestClient(app) as client:
        semantics_preperation_id = str(uuid.uuid4())

        response = client.post(
            url="/v1/semantics-preparations/",
            json={
                "mdl": mdl_str,
                "id": semantics_preperation_id,
            },
        )

        status = "indexing"
        while status != "finished":
            response = client.get(
                url=f"/v1/semantics-preparations/{semantics_preperation_id}/status/"
            )
            status = response.json()["status"]

        response = client.post(
            url="/v1/asks",
            json={
                "query": "How many books are there?",
                "id": semantics_preperation_id,
            },
        )

        query_id = response.json()["query_id"]

        response = client.patch(
            url=f"/v1/asks/{query_id}",
            json={
                "status": "stopped",
            },
        )

        assert response.status_code == 200
        assert response.json()["query_id"] == query_id

        response = client.get(url=f"/v1/asks/{query_id}/result/")
        while response.json()["status"] != "stopped":
            response = client.get(url=f"/v1/asks/{query_id}/result/")

        assert response.status_code == 200
        assert response.json()["status"] == "stopped"


def test_ask_details(mdl_str: str):
    with TestClient(app) as client:
        semantics_preperation_id = str(uuid.uuid4())

        response = client.post(
            url="/v1/semantics-preparations/",
            json={
                "mdl": mdl_str,
                "id": semantics_preperation_id,
            },
        )

        status = "indexing"
        while status != "finished":
            response = client.get(
                url=f"/v1/semantics-preparations/{semantics_preperation_id}/status/"
            )
            status = response.json()["status"]

        query = "How many books are there?"
        response = client.post(
            url="/v1/asks",
            json={
                "query": query,
                "id": semantics_preperation_id,
            },
        )

        query_id = response.json()["query_id"]

        response = client.get(url=f"/v1/asks/{query_id}/result/")
        while response.json()["status"] != "finished":
            response = client.get(url=f"/v1/asks/{query_id}/result/")

        sql = response.json()["response"][0]["sql"]
        summary = response.json()["response"][0]["summary"]

        response = client.post(
            url="/v1/ask-details/",
            json={
                "query": query,
                "sql": sql,
                "summary": summary,
            },
        )

        assert response.status_code == 200
        assert response.json()["query_id"] != ""

        query_id = response.json()["query_id"]
        response = client.get(url=f"/v1/ask-details/{query_id}/result/")
        while response.json()["status"] != "finished":
            response = client.get(url=f"/v1/ask-details/{query_id}/result/")

        assert response.status_code == 200
        assert response.json()["status"] == "finished"
        assert response.json()["response"]["description"] != ""
        assert len(response.json()["response"]["steps"]) >= 1

        for step in response.json()["response"]["steps"]:
            assert step["sql"] != ""
            assert step["summary"] != ""
