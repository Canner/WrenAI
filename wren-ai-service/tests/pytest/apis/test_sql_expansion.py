from fastapi.testclient import TestClient

from tests.pytest.apis import app


def test_sql_expansion(app: app):
    with TestClient(app) as client:
        response = client.post(
            url="/v1/sql-expansions",
            json={
                "query": "limit 10",
                "history": {
                    "sql": "SELECT * FROM book",
                    "steps": [],
                },
            },
        )

        assert response.status_code == 200
        assert response.json()["query_id"] != ""

        query_id = response.json()["query_id"]

        response = client.get(url=f"/v1/sql-expansions/{query_id}/result")
        while (
            response.json()["status"] != "finished"
            and response.json()["status"] != "failed"
        ):
            response = client.get(url=f"/v1/sql-expansions/{query_id}/result")

        assert response.status_code == 200
        assert response.json()["status"] == "finished"
        assert response.json()["response"]["description"] != ""
        assert len(response.json()["response"]["steps"]) == 1
