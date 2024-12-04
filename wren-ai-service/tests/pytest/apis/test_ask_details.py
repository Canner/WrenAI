from fastapi.testclient import TestClient


def test_ask_details(app):
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

        for i, step in enumerate(response.json()["response"]["steps"]):
            assert step["sql"] != ""
            assert step["summary"] != ""
            if i < len(response.json()["response"]["steps"]) - 1:
                assert step["cte_name"] != ""
            else:
                assert step["cte_name"] == ""
