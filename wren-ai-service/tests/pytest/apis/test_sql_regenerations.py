from fastapi.testclient import TestClient


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
