import json
import uuid

from fastapi.testclient import TestClient

from src.__main__ import app

from .conftest import ValueStorage


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


def test_semantics_preparations():
    with TestClient(app) as client:
        semantics_preperation_id = str(uuid.uuid4())
        ValueStorage.semantics_preperation_id = semantics_preperation_id

        with open("tests/data/book_2_mdl.json", "r") as f:
            mdl_str = json.dumps(json.load(f))

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


def test_asks():
    with TestClient(app) as client:
        semantics_preparation_id = ValueStorage.semantics_preperation_id

        response = client.post(
            url="/v1/asks",
            json={
                "query": "How many books are there?",
                "id": semantics_preparation_id,
            },
        )

        assert response.status_code == 200
        assert response.json()["query_id"] != ""

        query_id = response.json()["query_id"]
        ValueStorage.query_id = query_id

        response = client.get(url=f"/v1/asks/{query_id}/result/")
        while (
            response.json()["status"] != "finished"
            and response.json()["status"] != "failed"
        ):
            response = client.get(url=f"/v1/asks/{query_id}/result/")

        assert response.status_code == 200
        if response.json()["status"] == "failed":
            assert response.json()["error"]
        else:
            for r in response.json()["response"]:
                assert r["sql"] is not None and r["sql"] != ""
                assert r["summary"] is not None and r["summary"] != ""


def test_stop_asks():
    with TestClient(app) as client:
        query_id = ValueStorage.query_id

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


def test_ask_details():
    with TestClient(app) as client:
        response = client.post(
            url="/v1/ask-details/",
            json={
                "query": "How many books are there?",
                "sql": "SELECT COUNT(*) FROM book",
                "summary": "Retrieve the number of books",
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
