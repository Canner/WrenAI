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
            "description": "Synthetic analytical model.",
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


def test_generates_count_ranking_without_using_measure_sum():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "division_name",
                "data_type": "VARCHAR",
                "comment": "Analytical division",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "metric_value",
                "data_type": "DOUBLE",
                "comment": "Metric value",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql(
        "Which divisions have the highest count?", [document]
    )

    assert "COUNT(*) AS TotalCount" in sql
    assert "SUM(metric_value)" not in sql
    assert "GROUP BY\n  division_name" in sql
    assert "ORDER BY\n  TotalCount DESC" in sql


def test_total_count_prefers_count_even_when_numeric_measure_exists():
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
                "name": "metric_value",
                "data_type": "DOUBLE",
                "comment": "Metric value",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql("Show top 5 countries by total count.", [document])

    assert "COUNT(*) AS TotalCount" in sql
    assert "SUM(metric_value)" not in sql
    assert "LIMIT 5" in sql


def test_ranking_by_measure_groups_by_requested_dimension_only():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "entity_label",
                "data_type": "VARCHAR",
                "comment": "Analytical entity",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "record_code",
                "data_type": "VARCHAR",
                "comment": "Analytical record code",
                "roles": ["identifier_candidate"],
            },
            {
                "name": "metric_value",
                "data_type": "DOUBLE",
                "comment": "Requested metric",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql("Show top 10 entities by metric.", [document])

    assert "entity_label" in sql
    assert "SUM(metric_value) AS TotalValue" in sql
    assert "GROUP BY\n  entity_label" in sql
    assert "GROUP BY\n  entity_label, record_code" not in sql
    assert "ORDER BY\n  TotalValue DESC" in sql
    assert "LIMIT 10" in sql


def test_generates_filtered_detail_sql_with_deployed_identifiers_only():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "segment_label",
                "data_type": "VARCHAR",
                "comment": "Segment label",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "event_date",
                "data_type": "DATE",
                "comment": "Event date",
                "roles": ["date_time_candidate"],
            },
            {
                "name": "record_code",
                "data_type": "VARCHAR",
                "comment": "Record code",
                "roles": ["identifier_candidate"],
            },
            {
                "name": "metric_value",
                "data_type": "DOUBLE",
                "comment": "Metric value",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql("show records for segment Alpha", [document])

    assert "FROM\n  analytics_model" in sql
    assert "segment_label = 'Alpha'" in sql
    assert "event_date" in sql
    assert "LIMIT 500" in sql


def test_generates_metric_comparison_by_matching_dimension():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "market_segment",
                "data_type": "VARCHAR",
                "comment": "Domestic or international segment",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "metric_value",
                "data_type": "DOUBLE",
                "comment": "Metric value",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql(
        "Compare metric between domestic and international segments.", [document]
    )

    assert "market_segment" in sql
    assert "SUM(metric_value) AS TotalValue" in sql
    assert "GROUP BY\n  market_segment" in sql


def test_generates_average_by_requested_dimension():
    document = _schema_document(
        "analytics_model",
        [
            {
                "name": "category_type",
                "data_type": "VARCHAR",
                "comment": "Category type",
                "roles": ["dimension_candidate"],
            },
            {
                "name": "metric_value",
                "data_type": "DOUBLE",
                "comment": "Metric value",
                "roles": ["numeric_measure_candidate"],
            },
        ],
    )

    sql = generate_grounded_sql(
        "Show average metric by category type.", [document]
    )

    assert "category_type" in sql
    assert "AVG(metric_value) AS AverageValue" in sql
    assert "GROUP BY\n  category_type" in sql


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
                "name": "record_key",
                "data_type": "VARCHAR",
                "comment": "Record identifier",
                "roles": ["identifier_candidate"],
            },
        ],
    )

    async def failing_generator(**_):
        raise AssertionError("LLM generator should not be called")

    result = await generate_sql(
        prompt={"prompt": "unused"},
        query="Show top 5 countries by total count.",
        documents=[document],
        generator=failing_generator,
        generator_name="test-model",
    )

    assert result["replies"]
    assert "COUNT(*) AS TotalCount" in result["replies"][0]
