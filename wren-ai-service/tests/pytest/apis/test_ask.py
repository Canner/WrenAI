from fastapi.testclient import TestClient

from tests.pytest.apis import GLOBAL_DATA, app


def test_asks_with_successful_query(app: app):
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

        assert response.status_code == 200
        assert response.json()["status"] == "finished" or "failed"


def test_asks_with_invalid_query(app: app):
    with TestClient(app) as client:
        response = client.post(
            url="/v1/asks",
            json={},
        )

        assert response.status_code == 400
        assert response.json()["detail"] != ""


def test_stop_asks(app: app):
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
