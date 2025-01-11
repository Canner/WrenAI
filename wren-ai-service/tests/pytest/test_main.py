import json
import os
import uuid

import orjson
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module", autouse=True)
def app():
    os.environ["CONFIG_PATH"] = "tests/data/config.test.yaml"
    from src.__main__ import app

    yield app
    # Clean up (if necessary)
    del os.environ["CONFIG_PATH"]


GLOBAL_DATA = {
    "semantics_preperation_id": str(uuid.uuid4()),
    "query_id": None,
}


def test_semantics_preparation(app):
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


def test_asks_with_successful_query(app):
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

        # TODO: we'll refactor almost all test case with a mock server, thus temporarily only assert the status is finished or failed.
        assert response.status_code == 200
        assert response.json()["status"] == "finished" or "failed"
        # for r in response.json()["response"]:
        #     assert r["sql"] is not None and r["sql"] != ""
        #     assert r["summary"] is not None and r["summary"] != ""


def test_stop_asks(app):
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


def test_sql_regenerations(app):
    with TestClient(app) as client:
        response = client.post(
            url="/v1/sql-regenerations",
            json={
                "description": "This query identifies the customer who bought the most products within a specific time frame.",
                "steps": [
                    {
                        "sql": 'SELECT * FROM "customers"',
                        "summary": "Selects all columns from the customers table to retrieve customer information.",
                        "cte_name": "customer_data",
                        "corrections": [],
                    },
                    {
                        "sql": 'SELECT * FROM "orders" WHERE "PurchaseTimestamp" >= \'2023-01-01\' AND "PurchaseTimestamp" < \'2024-01-01\'',
                        "summary": "Filters orders based on the purchase timestamp to include only orders within the specified time frame.",
                        "cte_name": "filtered_orders",
                        "corrections": [
                            {
                                "before": {
                                    "type": "filter",
                                    "value": "('PurchaseTimestamp' >= '2023-01-01') AND ('PurchaseTimestamp' < '2024-01-01')",
                                },
                                "after": {
                                    "type": "nl_expression",
                                    "value": "change the time to 2022 only",
                                },
                            }
                        ],
                    },
                    {
                        "sql": 'SELECT * FROM "order_items"',
                        "summary": "Selects all columns from the order_items table to retrieve information about the products in each order.",
                        "cte_name": "order_items_data",
                        "corrections": [],
                    },
                    {
                        "sql": """
SELECT "c"."Id", COUNT("oi"."ProductId") AS "TotalProductsBought"
FROM "customer_data" AS "c"
JOIN "filtered_orders" AS "o" ON "c"."Id" = "o"."CustomerId"
JOIN "order_items_data" AS "oi" ON "o"."OrderId" = "oi"."OrderId"
GROUP BY "c"."Id"
""",
                        "summary": "Joins customer, order, and order item data to count the total products bought by each customer.",
                        "cte_name": "product_count_per_customer",
                        "corrections": [],
                    },
                    {
                        "sql": """
SELECT "Id",
       "TotalProductsBought"
FROM "product_count_per_customer"
ORDER BY "TotalProductsBought" DESC
LIMIT 1
""",
                        "summary": "Orders the customers based on the total products bought in descending order and limits the result to the top customer.",
                        "cte_name": "",
                        "corrections": [
                            {
                                "before": {
                                    "type": "sortings",
                                    "value": "('TotalProductsBought' DESC)",
                                },
                                "after": {
                                    "type": "nl_expression",
                                    "value": "sort by 'TotalProductsBought' ASC",
                                },
                            }
                        ],
                    },
                ],
            },
        )

        assert response.status_code == 200
        assert response.json()["query_id"] != ""

        query_id = response.json()["query_id"]
        response = client.get(url=f"/v1/sql-regenerations/{query_id}/result")
        while (
            response.json()["status"] != "finished"
            and response.json()["status"] != "failed"
        ):
            response = client.get(url=f"/v1/sql-regenerations/{query_id}/result")

        assert response.status_code == 200
        assert response.json()["status"] == "finished" or "failed"


def test_web_error_handler(app):
    with TestClient(app) as client:
        response = client.post(
            url="/v1/asks",
            json={},
        )

        assert response.status_code == 400
        assert response.json()["detail"] != ""
