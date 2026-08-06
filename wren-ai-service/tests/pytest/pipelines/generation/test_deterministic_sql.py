import pytest

from src.pipelines.generation.sql_generation import generate_sql
from src.pipelines.generation.utils.deterministic_sql import generate_grounded_sql


def _schema_document(table_name: str, columns: list[dict]) -> str:
    import orjson

    context = {
        "object_type": "model",
        "sql_identifier_contract": {
            "sql_table_name_use_exactly": table_name,
            "sql_column_names_use_exactly": [column["name"] for column in columns],
        },
        "semantic_context_not_sql_identifiers": {
            "description": "Synthetic sales and order analytics model.",
        },
        "columns": [
            {
                "sql_column_name_use_exactly": column["name"],
                "data_type": column["data_type"],
                "semantic_context_not_sql_identifier": column.get("comment", ""),
                "semantic_roles_not_identifiers": column.get("roles", []),
            }
            for column in columns
        ],
    }
    column_ddl = ",\n  ".join(
        f"{column['name']} {column['data_type']}" for column in columns
    )
    return (
        "/*\n"
        "WREN RETRIEVED SEMANTIC CONTEXT\n"
        f"{orjson.dumps(context).decode('utf-8')}\n"
        "*/\n"
        f"CREATE TABLE {table_name} (\n  {column_ddl}\n);"
    )


def test_generates_count_ranking_for_orders_without_using_sales_sum():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "division_name",
                "data_type": "VARCHAR",
                "comment": "Business division",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "sales_value",
                "data_type": "DOUBLE",
                "comment": "Sales amount",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql(
        "Which divisions are generating the most orders?", [document]
    )

    assert "COUNT(*) AS TotalOrders" in sql
    assert "SUM(sales_value)" not in sql
    assert "GROUP BY\n  division_name" in sql
    assert "ORDER BY\n  TotalOrders DESC" in sql


def test_total_orders_prefers_count_even_when_numeric_measure_exists():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "country_name",
                "data_type": "VARCHAR",
                "comment": "Country",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "sales_value",
                "data_type": "DOUBLE",
                "comment": "Sales amount",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql("Show top 5 countries by total orders.", [document])

    assert "COUNT(*) AS TotalOrders" in sql
    assert "SUM(sales_value)" not in sql
    assert "LIMIT 5" in sql


def test_ranking_by_measure_groups_by_requested_dimension_only():
    document = _schema_document(
        "business_activity",
        [
            {
                "name": "entity_name",
                "data_type": "VARCHAR",
                "comment": "Business entity",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "document_code",
                "data_type": "VARCHAR",
                "comment": "Transaction document code",
                "roles": ["identifier_candidate"],
            },
            {
                "name": "metric_value",
                "data_type": "DOUBLE",
                "comment": "Transaction value",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql("Show top 10 entities by transaction value.", [document])

    assert "entity_name" in sql
    assert "SUM(metric_value) AS TotalValue" in sql
    assert "GROUP BY\n  entity_name" in sql
    assert "GROUP BY\n  entity_name, document_code" not in sql
    assert "ORDER BY\n  TotalValue DESC" in sql
    assert "LIMIT 10" in sql


def test_generates_filtered_detail_sql_with_deployed_identifiers_only():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "customer_country",
                "data_type": "VARCHAR",
                "comment": "Country",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "order_date",
                "data_type": "DATE",
                "comment": "Order placed date",
                "roles": ["date_time_candidate"],
            },
            {
                "name": "order_number",
                "data_type": "VARCHAR",
                "comment": "Order number",
                "roles": ["identifier_candidate"],
            },
            {
                "name": "amount",
                "data_type": "DOUBLE",
                "comment": "Transaction amount",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql("show order placed from the country India", [document])

    assert "FROM\n  analytics_model" in sql
    assert "customer_country = 'India'" in sql
    assert "order_date" in sql
    assert "LIMIT 500" in sql


def test_generates_sales_comparison_by_matching_dimension():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "market_segment",
                "data_type": "VARCHAR",
                "comment": "Domestic or international market",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "sales_value",
                "data_type": "DOUBLE",
                "comment": "Sales value",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql(
        "Compare sales between domestic and international markets.", [document]
    )

    assert "market_segment" in sql
    assert "SUM(sales_value) AS TotalValue" in sql
    assert "GROUP BY\n  market_segment" in sql


def test_generates_average_by_requested_dimension():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "product_type",
                "data_type": "VARCHAR",
                "comment": "Product type",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "sales_value",
                "data_type": "DOUBLE",
                "comment": "Sales value",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql(
        "Show average sales value by product type.", [document]
    )

    assert "product_type" in sql
    assert "AVG(sales_value) AS AverageValue" in sql
    assert "GROUP BY\n  product_type" in sql


@pytest.mark.asyncio
async def test_generation_fast_path_does_not_call_llm_when_grounded():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "country_name",
                "data_type": "VARCHAR",
                "comment": "Country",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "order_key",
                "data_type": "VARCHAR",
                "comment": "Order identifier",
                "roles": ["identifier_candidate"],
            },
        ],
    )

    async def failing_generator(**_):
        raise AssertionError("LLM generator should not be called")

    result = await generate_sql(
        prompt={"prompt": "unused"},
        query="Show top 5 countries by total orders.",
        documents=[document],
        generator=failing_generator,
        generator_name="test-model",
    )

    assert result["replies"]
    assert "COUNT(*) AS TotalOrders" in result["replies"][0]
