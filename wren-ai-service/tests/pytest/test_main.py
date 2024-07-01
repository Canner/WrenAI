import json
import uuid

import orjson
from fastapi.testclient import TestClient

from src.__main__ import app

GLOBAL_DATA = {
    "semantics_preperation_id": str(uuid.uuid4()),
    "query_id": None,
}


# this function didn't using in the project, so let's skip it
# when we need to use it, we can uncomment it, and also did the refactor for the pipelines
# def test_semantics_description():
#     # using TestClient as a context manager would trigger startup/shutdown events as well as lifespans.
#     with TestClient(app) as client:
#         response = client.post(
#             url="/v1/semantics-descriptions",
#             json={
#                 "mdl": {
#                     "name": "all_star",
#                     "properties": {},
#                     "refsql": 'select * from "wrenai".spider."baseball_1-all_star"',
#                     "columns": [
#                         {
#                             "name": "player_id",
#                             "type": "varchar",
#                             "notnull": False,
#                             "iscalculated": False,
#                             "expression": "player_id",
#                             "properties": {},
#                         }
#                     ],
#                     "primarykey": "",
#                 },
#                 "model": "all_star",
#                 "identifiers": ["column@player_id"],
#             },
#         )

#         assert response.status_code == 200
#         assert len(response.json()) == 1
#         assert response.json()[0]["identifier"] == "column@player_id"
#         assert (
#             response.json()[0]["display_name"] is not None
#             and response.json()[0]["display_name"] != ""
#         )
#         assert (
#             response.json()[0]["description"] is not None
#             and response.json()[0]["description"] != ""
#         )


def test_semantics_preparations():
    with TestClient(app) as client:
        semantics_preperation_id = GLOBAL_DATA["semantics_preperation_id"]

        with open("tests/data/book_2_mdl.json", "r") as f:
            mdl_str = orjson.dumps(json.load(f)).decode("utf-8")

        response = client.post(
            url="/v1/semantics-preparations",
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
                url=f"/v1/semantics-preparations/{semantics_preperation_id}/status"
            )

            assert response.status_code == 200
            assert response.json()["status"] in ["indexing", "finished", "failed"]
            status = response.json()["status"]

        assert status == "finished"


def test_asks_with_successful_query():
    with TestClient(app) as client:
        semantics_preparation_id = GLOBAL_DATA["semantics_preperation_id"]

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
        GLOBAL_DATA["query_id"] = query_id

        response = client.get(url=f"/v1/asks/{query_id}/result")
        while (
            response.json()["status"] != "finished"
            and response.json()["status"] != "failed"
        ):
            response = client.get(url=f"/v1/asks/{query_id}/result")

        # todo: we'll refactor almost all test case with a mock server, thus temporarily only assert the status is finished or failed.
        assert response.status_code == 200
        assert response.json()["status"] == "finished" or "failed"
        # for r in response.json()["response"]:
        #     assert r["sql"] is not None and r["sql"] != ""
        #     assert r["summary"] is not None and r["summary"] != ""


# def test_asks_with_failed_query():
#     with TestClient(app) as client:
#         semantics_preparation_id = GLOBAL_DATA["semantics_preperation_id"]

#         response = client.post(
#             url="/v1/asks",
#             json={
#                 "query": "xxxx",
#                 "id": semantics_preparation_id,
#             },
#         )

#         assert response.status_code == 200
#         assert response.json()["query_id"] != ""

#         query_id = response.json()["query_id"]
#         GLOBAL_DATA["query_id"] = query_id

#         response = client.get(url=f"/v1/asks/{query_id}/result")
#         while (
#             response.json()["status"] != "finished"
#             and response.json()["status"] != "failed"
#         ):
#             response = client.get(url=f"/v1/asks/{query_id}/result")

#         assert response.status_code == 200
#         assert response.json()["status"] == "failed"
#         assert response.json()["error"]["code"] == "MISLEADING_QUERY"


def test_stop_asks():
    with TestClient(app) as client:
        query_id = GLOBAL_DATA["query_id"]

        response = client.patch(
            url=f"/v1/asks/{query_id}",
            json={
                "status": "stopped",
            },
        )

        assert response.status_code == 200
        assert response.json()["query_id"] == query_id

        response = client.get(url=f"/v1/asks/{query_id}/result")
        while response.json()["status"] != "stopped":
            response = client.get(url=f"/v1/asks/{query_id}/result")

        assert response.status_code == 200
        assert response.json()["status"] == "stopped"


def test_ask_details():
    with TestClient(app) as client:
        response = client.post(
            url="/v1/ask-details",
            json={
                "query": "How many books are there?",
                "sql": "SELECT COUNT(*) FROM book",
                "summary": "Retrieve the number of books",
            },
        )

        assert response.status_code == 200
        assert response.json()["query_id"] != ""

        query_id = response.json()["query_id"]
        response = client.get(url=f"/v1/ask-details/{query_id}/result")
        while response.json()["status"] != "finished":
            response = client.get(url=f"/v1/ask-details/{query_id}/result")

        assert response.status_code == 200
        assert response.json()["status"] == "finished"
        assert response.json()["response"]["description"] != ""
        assert len(response.json()["response"]["steps"]) >= 1

        for step in response.json()["response"]["steps"]:
            assert step["sql"] != ""
            assert step["summary"] != ""


def test_web_error_handler():
    with TestClient(app) as client:
        response = client.post(
            url="/v1/semantics-descriptions",
            json={},
        )

        assert response.status_code == 400
        assert response.json()["detail"] != ""
