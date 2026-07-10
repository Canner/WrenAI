from datetime import datetime

from src.pipelines.generation.semantic_sql import (
    IntentDetector,
    SchemaParser,
    compile_semantic_sql,
)


def test_intent_detector_returns_structured_business_intent():
    intent = IntentDetector().detect(
        "Show top 10 customers by total invoice amount last month as a bar chart"
    )

    assert intent.question_type == "ranking"
    assert intent.chart_requested is True
    assert intent.chart_type == "bar"
    assert intent.ranking is True
    assert intent.top_n == 10
    assert intent.aggregation == "SUM"


def test_compile_semantic_sql_generates_ranked_aggregate_with_date_filter():
    documents = [
        """
        CREATE TABLE invoices (
          id INTEGER,
          customer_id INTEGER,
          customer_name VARCHAR,
          invoice_amount DECIMAL(10,2),
          invoice_date DATE
        );
        """
    ]

    result = compile_semantic_sql(
        "Show top 10 customers by total invoice amount last month as a bar chart",
        documents,
        now=datetime(2026, 7, 10),
    )

    assert result is not None
    assert result.plan.intent.question_type == "ranking"
    assert result.plan.chart_type == "bar"
    assert result.plan.metrics[0].column.object_name == "invoices.invoice_amount"
    assert [dimension.object_name for dimension in result.plan.group_by] == [
        "invoices.customer_name"
    ]
    assert 'SUM("invoices"."invoice_amount")' in result.sql
    assert 'GROUP BY "invoices"."customer_name"' in result.sql
    assert "\"invoices\".\"invoice_date\" >= '2026-06-01'" in result.sql
    assert "\"invoices\".\"invoice_date\" < '2026-07-01'" in result.sql
    assert "ORDER BY SUM(" in result.sql
    assert "LIMIT 10" in result.sql


def test_compile_semantic_sql_resolves_join_path_from_foreign_keys():
    documents = [
        """
        CREATE TABLE orders (
          id INTEGER,
          customer_id INTEGER,
          order_amount DECIMAL(10,2),
          FOREIGN KEY (customer_id) REFERENCES customers(id)
        );
        """,
        """
        CREATE TABLE customers (
          id INTEGER,
          customer_name VARCHAR
        );
        """,
    ]

    result = compile_semantic_sql(
        "Show total order amount by customer name",
        documents,
    )

    assert result is not None
    assert [join.left_table for join in result.plan.joins] == ["orders"]
    assert [join.right_table for join in result.plan.joins] == ["customers"]
    assert (
        'INNER JOIN "customers" ON "orders"."customer_id" = "customers"."id"'
        in result.sql
    )
    assert 'GROUP BY "customers"."customer_name"' in result.sql


def test_compile_semantic_sql_uses_semantic_metadata_documents():
    documents = [
        """
        {
          "models": [
            {
              "name": "orders",
              "columns": [
                {"name": "id", "type": "INTEGER"},
                {"name": "customer_id", "type": "INTEGER"},
                {"name": "order_value", "type": "DECIMAL"},
                {"name": "created_at", "type": "DATE"}
              ]
            },
            {
              "name": "customers",
              "columns": [
                {"name": "id", "type": "INTEGER"},
                {"name": "customer_name", "type": "VARCHAR"}
              ]
            }
          ],
          "relationships": [
            {
              "condition": "orders.customer_id = customers.id",
              "joinType": "MANY_TO_ONE",
              "models": ["orders", "customers"]
            }
          ]
        }
        """
    ]

    result = compile_semantic_sql(
        "Show total order value by customer name this month",
        documents,
        now=datetime(2026, 7, 10),
    )

    assert result is not None
    assert 'SUM("orders"."order_value")' in result.sql
    assert 'INNER JOIN "customers" ON "orders"."customer_id" = "customers"."id"' in result.sql
    assert "\"orders\".\"created_at\" >= '2026-07-01'" in result.sql
    assert "\"orders\".\"created_at\" < '2026-08-01'" in result.sql


def test_compile_semantic_sql_counts_entities_without_unrequested_grouping():
    result = compile_semantic_sql(
        "How many customers are there?",
        ["CREATE TABLE customers (id INTEGER, customer_name VARCHAR);"],
    )

    assert result is not None
    assert result.sql == 'SELECT COUNT(*) AS "count" FROM "customers"'


def test_schema_parser_handles_single_line_create_table_definitions():
    catalog = SchemaParser().parse(
        ['CREATE TABLE customers (id INTEGER, customer_name VARCHAR, created_at DATE);']
    )

    assert list(catalog.tables) == ["customers"]
    assert [column.column for column in catalog.tables["customers"]] == [
        "id",
        "customer_name",
        "created_at",
    ]
