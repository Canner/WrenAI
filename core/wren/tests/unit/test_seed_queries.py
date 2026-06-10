"""Unit tests for wren.memory.seed_queries."""

from __future__ import annotations

import pytest

from wren.memory.seed_queries import SEED_TAG, generate_seed_queries

# ── Fixtures ──────────────────────────────────────────────────────────────


def _model(name: str, pk: str | list[str], columns: list[dict]) -> dict:
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


# ── relationship-key / identifier exclusion ───────────────────────────────


@pytest.mark.unit
class TestIdentifierExclusion:
    """Numeric identifier columns must not be picked as aggregation targets:
    SUM(customer_id) is semantically meaningless noise (MEM-001)."""

    def test_relationship_key_not_aggregated(self):
        # customer_id is numeric and declared as a relationship key on orders.
        manifest = {
            "models": [
                _model(
                    "orders",
                    "order_id",
                    [
                        _col("order_id", "int"),
                        _col("customer_id", "int"),
                        _col("amount", "double"),
                        _col("status", "varchar"),
                    ],
                ),
                _model(
                    "customers",
                    "customer_id",
                    [_col("customer_id", "int"), _col("name", "varchar")],
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
        sqls = [p["sql"] for p in pairs]
        # No relationship-key aggregation on either side of the join.
        assert not any("SUM(customer_id)" in s for s in sqls)
        # The real metric is aggregated instead
        assert "SELECT SUM(amount) FROM orders" in sqls
        assert "SELECT status, SUM(amount) FROM orders GROUP BY 1" in sqls

    def test_composite_primary_key_columns_not_aggregated(self):
        # Composite PKs are list-shaped in schema v4 MDL. Every PK member must
        # be treated as an identifier even when it is numeric and not *_id-like.
        manifest = {
            "models": [
                _model(
                    "store_sales",
                    ["ss_item_sk", "ss_ticket_number"],
                    [
                        _col("ss_item_sk", "int"),
                        _col("ss_ticket_number", "int"),
                        _col("sales_price", "decimal"),
                        _col("status", "varchar"),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        sqls = [p["sql"] for p in pairs]
        assert not any("SUM(ss_item_sk)" in s for s in sqls)
        assert not any("SUM(ss_ticket_number)" in s for s in sqls)
        assert "SELECT SUM(sales_price) FROM store_sales" in sqls
        assert "SELECT status, SUM(sales_price) FROM store_sales GROUP BY 1" in sqls

    def test_id_like_column_not_aggregated_without_relationship(self):
        # user_id is numeric, not a PK, and not declared in any relationship —
        # the *_id naming heuristic should still exclude it.
        manifest = {
            "models": [
                _model(
                    "raw_orders",
                    "id",
                    [
                        _col("id", "int"),
                        _col("user_id", "int"),
                        _col("amount", "double"),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        sqls = [p["sql"] for p in pairs]
        assert not any("SUM(user_id)" in s for s in sqls)
        assert "SELECT SUM(amount) FROM raw_orders" in sqls

    def test_column_named_id_not_aggregated(self):
        # A bare numeric "id" that is not the declared primaryKey.
        manifest = {
            "models": [
                _model(
                    "events",
                    "event_pk",
                    [
                        _col("event_pk", "varchar"),
                        _col("id", "bigint"),
                        _col("duration", "int"),
                    ],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        sqls = [p["sql"] for p in pairs]
        assert not any("SUM(id)" in s for s in sqls)
        assert "SELECT SUM(duration) FROM events" in sqls

    def test_relationship_key_only_model_has_no_aggregation(self):
        # When the sole numeric column is a relationship key, fall back to
        # listing only.
        manifest = {
            "models": [
                _model(
                    "order_items",
                    "line_id",
                    [
                        _col("line_id", "varchar"),
                        _col("order_id", "int"),
                        _col("label", "varchar"),
                    ],
                ),
                _model("orders", "order_id", [_col("order_id", "int")]),
            ],
            "relationships": [
                {
                    "name": "order_items_orders",
                    "models": ["order_items", "orders"],
                    "condition": "order_items.order_id = orders.order_id",
                }
            ],
        }
        pairs = generate_seed_queries(manifest)
        sqls = [p["sql"] for p in pairs]
        assert not any("SUM(" in s for s in sqls)

    def test_quoted_relationship_condition_parsed(self):
        # Conditions may quote identifiers; relationship-key detection must
        # still work.
        manifest = {
            "models": [
                _model(
                    "orders",
                    "order_id",
                    [
                        _col("order_id", "int"),
                        _col("customer_id", "int"),
                        _col("amount", "double"),
                    ],
                ),
                _model("customers", "customer_id", [_col("customer_id", "int")]),
            ],
            "relationships": [
                {
                    "name": "orders_customers",
                    "models": ["orders", "customers"],
                    "condition": '"orders"."customer_id" = "customers"."customer_id"',
                }
            ],
        }
        pairs = generate_seed_queries(manifest)
        sqls = [p["sql"] for p in pairs]
        assert not any("SUM(customer_id)" in s for s in sqls)
        assert "SELECT SUM(amount) FROM orders" in sqls

    def test_legitimate_metric_named_with_id_suffix_is_still_excluded(self):
        # Documented trade-off: the *_id heuristic also drops a would-be metric
        # like "household_id". Real metrics should avoid the _id suffix; the
        # noise reduction is worth this rare false-positive.
        manifest = {
            "models": [
                _model(
                    "households",
                    "pk",
                    [_col("pk", "varchar"), _col("household_id", "int")],
                )
            ]
        }
        pairs = generate_seed_queries(manifest)
        assert not any("SUM(household_id)" in p["sql"] for p in pairs)

    def test_uppercase_id_like_column_excluded(self):
        # Warehouses such as Snowflake/Oracle fold identifiers to upper case.
        # An undeclared CUSTOMER_ID (not a PK, not a relationship key) must
        # still be caught by the case-insensitive *_id heuristic.
        manifest = {
            "models": [
                _model(
                    "orders",
                    "ORDER_PK",
                    [
                        _col("ORDER_PK", "varchar"),
                        _col("CUSTOMER_ID", "int"),
                        _col("AMOUNT", "double"),
                    ],
                )
            ]
        }
        sqls = [p["sql"] for p in generate_seed_queries(manifest)]
        assert not any("SUM(CUSTOMER_ID)" in s for s in sqls)
        assert "SELECT SUM(AMOUNT) FROM orders" in sqls

    def test_relationship_key_without_id_suffix_excluded(self):
        # A foreign key whose name does NOT end in _id (e.g. created_by) is only
        # caught via the relationship condition, not the naming heuristic — this
        # is the value the relationship-key parsing adds on top of *_id.
        manifest = {
            "models": [
                _model(
                    "documents",
                    "doc_pk",
                    [
                        _col("doc_pk", "varchar"),
                        _col("created_by", "int"),
                        _col("word_count", "int"),
                    ],
                ),
                _model("users", "id", [_col("id", "int")]),
            ],
            "relationships": [
                {
                    "name": "users_documents",
                    "models": ["users", "documents"],
                    "condition": "users.id = documents.created_by",
                }
            ],
        }
        sqls = [p["sql"] for p in generate_seed_queries(manifest)]
        assert not any("SUM(created_by)" in s for s in sqls)
        assert "SELECT SUM(word_count) FROM documents" in sqls

    def test_composite_and_condition_parsed(self):
        # Composite join keys are emitted as an `AND`-joined condition; every
        # referenced column on both sides must be excluded from aggregation.
        manifest = {
            "models": [
                _model(
                    "a",
                    "akey",
                    [
                        _col("akey", "varchar"),
                        _col("x", "int"),
                        _col("y", "int"),
                        _col("val", "double"),
                    ],
                ),
                _model("b", ["x", "y"], [_col("x", "int"), _col("y", "int")]),
            ],
            "relationships": [
                {
                    "name": "a_b",
                    "models": ["a", "b"],
                    "condition": "a.x = b.x AND a.y = b.y",
                }
            ],
        }
        sqls = [p["sql"] for p in generate_seed_queries(manifest)]
        assert not any("SUM(x)" in s or "SUM(y)" in s for s in sqls)
        assert "SELECT SUM(val) FROM a" in sqls

    def test_identifier_matching_is_case_insensitive(self):
        # A non-*_id identifier (e.g. "Custkey") is only excluded via the PK /
        # relationship-key path. Those checks must be case-insensitive so a
        # manifest that mixes cases — PK "custkey", column "Custkey", condition
        # "ORDERS.CUSTKEY = ..." — still keeps it out of aggregation. The
        # generated SQL must preserve the original column case.
        manifest = {
            "models": [
                _model(
                    "orders",
                    "custkey",  # PK declared lower-case
                    [
                        _col("Custkey", "int"),  # column defined Title-case
                        _col("totalprice", "double"),
                    ],
                ),
                _model(
                    "customer",
                    "CUSTKEY",
                    [_col("CUSTKEY", "int"), _col("name", "varchar")],
                ),
            ],
            "relationships": [
                {
                    "name": "orders_customer",
                    "models": ["orders", "customer"],
                    "condition": "ORDERS.CUSTKEY = CUSTOMER.CUSTKEY",
                }
            ],
        }
        sqls = [p["sql"] for p in generate_seed_queries(manifest)]
        assert not any("SUM(Custkey)" in s for s in sqls)
        assert "SELECT SUM(totalprice) FROM orders" in sqls

    def test_relationship_key_case_insensitive_isolated(self):
        # Isolates the relationship-key normalization path: "CreatedBy" is NOT a
        # PK and NOT *_id-like, so only the (case-insensitive) relationship-key
        # match can exclude it. The column is "CreatedBy" but the condition says
        # "DOCUMENTS.CREATEDBY" — without normalization this leaks SUM(CreatedBy).
        manifest = {
            "models": [
                _model(
                    "documents",
                    "doc_pk",
                    [
                        _col("doc_pk", "varchar"),
                        _col("CreatedBy", "int"),
                        _col("word_count", "int"),
                    ],
                ),
                _model("users", "user_pk", [_col("user_pk", "int")]),
            ],
            "relationships": [
                {
                    "name": "users_documents",
                    "models": ["users", "documents"],
                    "condition": "DOCUMENTS.CREATEDBY = USERS.USER_PK",
                }
            ],
        }
        sqls = [p["sql"] for p in generate_seed_queries(manifest)]
        assert not any("SUM(CreatedBy)" in s for s in sqls)
        assert "SELECT SUM(word_count) FROM documents" in sqls
