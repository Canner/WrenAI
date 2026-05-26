"""Unit tests for wren.memory.seed_queries."""

from __future__ import annotations

import pytest

from wren.memory.seed_queries import SEED_TAG, generate_seed_queries

# ── Fixtures ──────────────────────────────────────────────────────────────


def _model(name: str, pk: str, columns: list[dict]) -> dict:
    return {"name": name, "primaryKey": pk, "columns": columns}


def _col(
    name: str,
    col_type: str,
    *,
    is_calc: bool = False,
    properties: dict | None = None,
) -> dict:
    payload = {"name": name, "type": col_type, "isCalculated": is_calc}
    if properties is not None:
        payload["properties"] = properties
    return payload


# ── generate_seed_queries tests ───────────────────────────────────────────


@pytest.mark.unit
class TestGenerateSeedQueries:
    def test_empty_manifest(self):
        assert generate_seed_queries({}) == []

    def test_empty_models_list(self):
        assert generate_seed_queries({"models": []}) == []

    def test_single_model_all_string_columns(self):
        manifest = {
            "models": [
                _model(
                    "orders",
                    "id",
                    [
                        _col("id", "varchar"),
                        _col("status", "varchar"),
                        _col("note", "varchar"),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        assert len(pairs) == 1
        assert pairs[0]["nl"] == "List all orders"
        assert "SELECT * FROM orders" in pairs[0]["sql"]

    def test_single_model_only_pk_column(self):
        # PK is varchar — no numeric col, no group col → listing only
        manifest = {
            "models": [
                _model("products", "product_id", [_col("product_id", "varchar")])
            ]
        }
        pairs = generate_seed_queries(manifest)
        assert len(pairs) == 1
        assert pairs[0]["nl"] == "List all products"

    def test_numeric_pk_not_used_for_aggregation(self):
        # PK is numeric — should not be picked as aggregate target
        manifest = {
            "models": [
                _model(
                    "orders",
                    "order_id",
                    [
                        _col("order_id", "int"),
                        _col("status", "varchar"),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        # Only listing — no aggregation since numeric col is a PK
        assert len(pairs) == 1
        assert pairs[0]["nl"] == "List all orders"

    def test_single_model_one_numeric_no_group(self):
        # Only columns: pk (varchar) + amount (double) — no eligible group col
        manifest = {
            "models": [
                _model(
                    "payments",
                    "payment_id",
                    [
                        _col("payment_id", "varchar"),
                        _col("amount", "double"),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        nls = [p["nl"] for p in pairs]
        assert "List all payments" in nls
        assert "Total amount in payments" in nls
        # No group col → no grouped aggregation
        assert not any("by" in nl for nl in nls)
        assert len(pairs) == 2

    def test_single_model_numeric_and_group_column(self):
        # 3 columns: pk (varchar) + status (varchar) + amount (double)
        manifest = {
            "models": [
                _model(
                    "orders",
                    "order_id",
                    [
                        _col("order_id", "varchar"),
                        _col("status", "varchar"),
                        _col("amount", "double"),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        assert len(pairs) == 3
        nls = [p["nl"] for p in pairs]
        assert "List all orders" in nls
        assert "Total amount in orders" in nls
        assert "amount by status in orders" in nls

    def test_grouped_aggregation_sql(self):
        manifest = {
            "models": [
                _model(
                    "sales",
                    "id",
                    [
                        _col("id", "varchar"),
                        _col("region", "varchar"),
                        _col("revenue", "decimal"),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        grouped = next(p for p in pairs if "by" in p["nl"])
        assert grouped["sql"] == "SELECT region, SUM(revenue) FROM sales GROUP BY 1"

    def test_calculated_columns_skipped_for_aggregation(self):
        # The only numeric col is calculated — should be skipped for agg template
        manifest = {
            "models": [
                _model(
                    "orders",
                    "id",
                    [
                        _col("id", "varchar"),
                        _col("status", "varchar"),
                        _col("total", "double", is_calc=True),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        assert len(pairs) == 1
        assert pairs[0]["nl"] == "List all orders"

    def test_numeric_type_case_insensitive(self):
        # Type stored in mixed case (e.g. "BIGINT", "Float")
        manifest = {
            "models": [
                _model(
                    "metrics",
                    "id",
                    [
                        _col("id", "varchar"),
                        _col("category", "varchar"),
                        _col("count", "BIGINT"),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        assert any("Total count" in p["nl"] for p in pairs)

    def test_numeric_type_with_precision(self):
        # Type like "DECIMAL(10,2)" — precision should be stripped
        manifest = {
            "models": [
                _model(
                    "invoices",
                    "id",
                    [
                        _col("id", "varchar"),
                        _col("customer", "varchar"),
                        _col("amount", "DECIMAL(10,2)"),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        assert any("Total amount" in p["nl"] for p in pairs)

    def test_two_models_with_relationship(self):
        manifest = {
            "models": [
                _model(
                    "orders",
                    "order_id",
                    [
                        _col("order_id", "varchar"),
                        _col("status", "varchar"),
                        _col("amount", "double"),
                    ],
                ),
                _model(
                    "customers",
                    "customer_id",
                    [
                        _col("customer_id", "varchar"),
                        _col("name", "varchar"),
                        _col("score", "int"),
                    ],
                ),
            ],
            "relationships": [
                {
                    "name": "orders_customers",
                    "models": ["orders", "customers"],
                    "condition": "orders.customer_id = customers.customer_id",
                }
            ],
        }
        pairs = generate_seed_queries(manifest)
        # orders: 3 (listing + agg + grouped), customers: 3 (listing + agg + grouped), rel: 1
        assert len(pairs) == 7
        nls = [p["nl"] for p in pairs]
        assert "orders with customers details" in nls

    def test_relationship_join_sql(self):
        manifest = {
            "models": [
                _model("a", "aid", [_col("aid", "varchar")]),
                _model("b", "bid", [_col("bid", "varchar")]),
            ],
            "relationships": [
                {
                    "name": "a_b",
                    "models": ["a", "b"],
                    "condition": "a.bid = b.bid",
                }
            ],
        }
        pairs = generate_seed_queries(manifest)
        join_pair = next(p for p in pairs if "with" in p["nl"])
        assert join_pair["sql"] == "SELECT * FROM a JOIN b ON a.bid = b.bid LIMIT 100"

    def test_relationship_missing_condition_skipped(self):
        manifest = {
            "models": [
                _model("a", "aid", [_col("aid", "varchar")]),
                _model("b", "bid", [_col("bid", "varchar")]),
            ],
            "relationships": [{"name": "a_b", "models": ["a", "b"], "condition": ""}],
        }
        pairs = generate_seed_queries(manifest)
        assert not any("with" in p["nl"] for p in pairs)

    def test_relationship_whitespace_condition_skipped(self):
        manifest = {
            "models": [
                _model("a", "aid", [_col("aid", "varchar")]),
                _model("b", "bid", [_col("bid", "varchar")]),
            ],
            "relationships": [
                {"name": "a_b", "models": ["a", "b"], "condition": "   "}
            ],
        }
        pairs = generate_seed_queries(manifest)
        assert not any("with" in p["nl"] for p in pairs)

    def test_relationship_fewer_than_two_models_skipped(self):
        manifest = {
            "models": [_model("a", "aid", [_col("aid", "varchar")])],
            "relationships": [
                {"name": "a_self", "models": ["a"], "condition": "a.id = a.id"}
            ],
        }
        pairs = generate_seed_queries(manifest)
        assert not any("with" in p["nl"] for p in pairs)

    def test_accepted_values_seed(self):
        manifest = {
            "models": [
                _model(
                    "orders",
                    "order_id",
                    [
                        _col("order_id", "varchar"),
                        _col(
                            "status",
                            "varchar",
                            properties={"acceptedValues": "placed,shipped,completed"},
                        ),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        status_pair = next(p for p in pairs if "where status is placed" in p["nl"])
        assert (
            status_pair["sql"]
            == "SELECT * FROM orders WHERE status = 'placed' LIMIT 100"
        )

    def test_accepted_values_seed_accepts_list(self):
        manifest = {
            "models": [
                _model(
                    "customers",
                    "customer_id",
                    [
                        _col("customer_id", "varchar"),
                        _col(
                            "name",
                            "varchar",
                            properties={"acceptedValues": ["Smith, John", "Ada"]},
                        ),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        name_pair = next(p for p in pairs if "where name is Smith, John" in p["nl"])
        assert (
            name_pair["sql"]
            == "SELECT * FROM customers WHERE name = 'Smith, John' LIMIT 100"
        )

    def test_raw_models_are_not_seeded(self):
        manifest = {
            "models": [
                {
                    **_model(
                        "raw_orders",
                        "id",
                        [_col("id", "varchar"), _col("status", "varchar")],
                    ),
                    "properties": {"dbtLayer": "raw"},
                }
            ]
        }
        assert generate_seed_queries(manifest) == []

    def test_relationship_seed_skips_raw_models(self):
        manifest = {
            "models": [
                {
                    **_model("raw_orders", "id", [_col("id", "varchar")]),
                    "properties": {"dbtLayer": "raw"},
                },
                _model("customers", "customer_id", [_col("customer_id", "varchar")]),
            ],
            "relationships": [
                {
                    "name": "raw_orders_customers",
                    "models": ["raw_orders", "customers"],
                    "condition": "raw_orders.customer_id = customers.customer_id",
                }
            ],
        }
        pairs = generate_seed_queries(manifest)
        assert not any("with customers details" in p["nl"] for p in pairs)

    def test_seed_tag_constant(self):
        assert SEED_TAG == "source:seed"

    def test_listing_sql_has_limit(self):
        manifest = {"models": [_model("t", "id", [_col("id", "varchar")])]}
        pairs = generate_seed_queries(manifest)
        assert "LIMIT 100" in pairs[0]["sql"]
