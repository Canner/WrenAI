import base64
import json

import duckdb
from wren_core import SessionContext


def test_one_to_many_refunds_preserve_sale_grain():
    manifest = {
        "catalog": "demo",
        "schema": "demo",
        "dataSource": "datafusion",
        "models": [
            {
                "name": "sales",
                "tableReference": {"schema": "main", "table": "sales"},
                "primaryKey": "id",
                "columns": [
                    {"name": "id", "type": "integer"},
                    {"name": "amount", "type": "integer"},
                    {"name": "refunds", "type": "refunds", "relationship": "sale_refunds"},
                    {
                        "name": "refunded",
                        "type": "integer",
                        "isCalculated": True,
                        "expression": "SUM(refunds.amount)",
                    },
                ],
            },
            {
                "name": "refunds",
                "tableReference": {"schema": "main", "table": "refunds"},
                "columns": [
                    {"name": "sale_id", "type": "integer"},
                    {"name": "amount", "type": "integer"},
                ],
            },
        ],
        "relationships": [
            {
                "name": "sale_refunds",
                "models": ["sales", "refunds"],
                "joinType": "ONE_TO_MANY",
                "condition": "sales.id = refunds.sale_id",
            }
        ],
    }
    encoded_manifest = base64.b64encode(json.dumps(manifest).encode()).decode()
    sql = SessionContext(encoded_manifest, None).transform_sql(
        "SELECT id, amount - COALESCE(refunded, 0) AS net_sales FROM sales ORDER BY id"
    )

    with duckdb.connect() as db:
        db.execute("CREATE TABLE sales(id INTEGER, amount INTEGER)")
        db.execute("INSERT INTO sales VALUES (1, 100), (2, 80)")
        db.execute("CREATE TABLE refunds(sale_id INTEGER, amount INTEGER)")
        db.execute("INSERT INTO refunds VALUES (1, 10), (1, 15)")

        assert db.execute(sql).fetchall() == [(1, 75), (2, 80)]
