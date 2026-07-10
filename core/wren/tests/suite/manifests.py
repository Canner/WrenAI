"""Shared MDL manifest factories for connector tests."""

from __future__ import annotations


def make_tpch_manifest(table_catalog: str | None, table_schema: str) -> dict:
    """Return a minimal TPCH MDL manifest for orders + customer.

    The manifest includes:
    - orders model with basic TPCH columns + a calculated field
    - customer model with basic TPCH columns
    - a MANY_TO_ONE relationship from orders to customer
    - a relationship column on orders (customer → c_name)

    Args:
        table_catalog: Database catalog for tableReference (None to omit).
        table_schema: Database schema for tableReference (e.g. "main", "public").
    """

    def table_ref(table: str) -> dict:
        ref: dict = {"schema": table_schema, "table": table}
        if table_catalog is not None:
            ref["catalog"] = table_catalog
        return ref

    return {
        "catalog": "wren",
        "schema": "public",
        "models": [
            {
                "name": "orders",
                "tableReference": table_ref("orders"),
                "columns": [
                    {"name": "o_orderkey", "type": "integer"},
                    {"name": "o_custkey", "type": "integer"},
                    {"name": "o_orderstatus", "type": "varchar"},
                    {"name": "o_totalprice", "type": "double"},
                    {"name": "o_orderdate", "type": "date"},
                    {
                        "name": "order_cust_key",
                        "type": "varchar",
                        "expression": "concat(cast(o_orderkey as varchar), '_', cast(o_custkey as varchar))",
                    },
                    {
                        "name": "customer",
                        "type": "customer",
                        "relationship": "orders_customer",
                    },
                ],
                "primaryKey": "o_orderkey",
            },
            {
                "name": "customer",
                "tableReference": table_ref("customer"),
                "columns": [
                    {"name": "c_custkey", "type": "integer"},
                    {"name": "c_name", "type": "varchar"},
                ],
                "primaryKey": "c_custkey",
            },
        ],
        "relationships": [
            {
                "name": "orders_customer",
                "models": ["orders", "customer"],
                "joinType": "many_to_one",
                "condition": '"orders".o_custkey = "customer".c_custkey',
            }
        ],
    }
