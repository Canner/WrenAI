import asyncio

from src.pipelines.generation.utils.sql import (
    SQLGenPostProcessor,
    generate_simple_analytics_sql,
    normalize_sql_with_schema_identifiers,
    normalize_wren_sql_dialect,
    unsupported_schema_generation_result,
    unsupported_schema_message,
    validate_sql_against_contexts,
    validate_sql_semantic_coverage,
)


SCHEMA_CONTEXTS = [
    """
    CREATE TABLE valid_invoice_comments (
        invoice_id VARCHAR,
        comment_id VARCHAR
    );
    """,
    """
    CREATE TABLE "valid-order-lines" (
        order_id VARCHAR,
        line_amount DECIMAL
    );
    """,
]


def test_schema_grounding_rejects_unretrieved_table_name():
    error = validate_sql_against_contexts(
        "SELECT invoice_id, COUNT(comment_id) FROM comments GROUP BY invoice_id",
        SCHEMA_CONTEXTS,
    )

    assert error is not None
    assert "comments" in error
    assert "valid_invoice_comments" in error


def test_schema_grounding_accepts_retrieved_table_name():
    error = validate_sql_against_contexts(
        """
        SELECT invoice_id, COUNT(comment_id)
        FROM valid_invoice_comments
        GROUP BY invoice_id
        """,
        SCHEMA_CONTEXTS,
    )

    assert error is None


def test_schema_grounding_rejects_invalid_qualified_column():
    error = validate_sql_against_contexts(
        """
        SELECT c.invoice_number
        FROM valid_invoice_comments c
        """,
        SCHEMA_CONTEXTS,
    )

    assert error is not None
    assert "c.invoice_number" in error


def test_schema_identifier_normalization_quotes_special_identifiers():
    sql = normalize_sql_with_schema_identifiers(
        "SELECT order_id FROM [valid-order-lines]",
        SCHEMA_CONTEXTS,
    )

    assert 'FROM "valid-order-lines"' in sql


def test_wren_sql_dialect_normalization_handles_top_and_joined_limit():
    assert (
        normalize_wren_sql_dialect("SELECT TOP 10 id1 FROM dbo_mbrTime")
        == "SELECT id1 FROM dbo_mbrTime\nLIMIT 10"
    )
    assert (
        normalize_wren_sql_dialect(
            "SELECT id1 FROM dbo_mbrTime ORDER BY metric DESCLIMIT 10"
        )
        == "SELECT id1 FROM dbo_mbrTime ORDER BY metric DESC LIMIT 10"
    )


def test_semantic_coverage_rejects_unrepresented_query_terms():
    contexts = [
        """
        CREATE TABLE neutral_records (
            id1 INTEGER,
            id2 INTEGER
        );
        """
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT id1, COUNT(*) AS record_count
        FROM neutral_records
        GROUP BY id1
        ORDER BY record_count DESC
        LIMIT 10
        """,
        "Show top 10 records by missing_dimension.",
        contexts,
    )

    assert error is not None
    assert "missing" in error or "dimension" in error


def test_unsupported_schema_message_reports_partial_coverage():
    contexts = [
        """
        CREATE TABLE event_records (
            event_id VARCHAR,
            phase VARCHAR
        );
        """
    ]

    message = unsupported_schema_message(
        "Show records by phase and unknown_segment.",
        contexts,
    )

    assert message is not None
    assert "unknown" in message or "segment" in message


def test_unsupported_schema_generation_result_has_no_invalid_sql():
    contexts = [
        """
        CREATE TABLE event_records (
            event_id VARCHAR,
            phase VARCHAR
        );
        """
    ]

    result = unsupported_schema_generation_result(
        "Show records by unknown_segment.",
        contexts,
        data_source="MSSQL",
    )

    assert result is not None
    assert result["valid_generation_result"] == {}
    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "NO_RELEVANT_SQL"
    assert invalid["sql"] == ""
    assert invalid["original_sql"] == ""
    assert "unknown" in invalid["error"] or "segment" in invalid["error"]


def test_post_processor_clears_sql_for_unsupported_schema():
    contexts = [
        """
        CREATE TABLE neutral_records (
            id1 INTEGER,
            id2 INTEGER
        );
        """
    ]
    post_processor = SQLGenPostProcessor(engine=None)

    result = asyncio.run(
        post_processor.run(
            [
                """
                SELECT id1, COUNT(*) AS record_count
                FROM neutral_records
                GROUP BY id1
                ORDER BY record_count DESC
                LIMIT 10
                """
            ],
            contexts=contexts,
            fallback_query="Show records by missing_dimension.",
            data_source="MSSQL",
        )
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "NO_RELEVANT_SQL"
    assert result["invalid_generation_result"]["sql"] == ""
    assert result["invalid_generation_result"]["original_sql"] == ""


def test_schema_sample_value_filter_is_grounded_in_metadata():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"work item records"},"columns":[{"sql_column_name_use_exactly":"State","data_type":"VARCHAR","sample_values":["Done","In Progress"]}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE work_items (
            item_id VARCHAR,
            State VARCHAR,
            updated_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show all work item records with In Progress.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "work_items"' in sql
    assert 'LOWER("State") = \'in progress\'' in sql


def test_unverified_filter_value_is_not_invented():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"work item records"},"columns":[{"sql_column_name_use_exactly":"State","data_type":"VARCHAR","sample_values":["Done"]}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE work_items (
            item_id VARCHAR,
            State VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show all work item records with Archived.",
        contexts,
    )
    message = unsupported_schema_message(
        "Show all work item records with Archived.",
        contexts,
    )

    assert sql is None
    assert message is not None
    assert "archived" in message.lower()


def test_grouped_count_uses_verified_dimension_only():
    contexts = [
        """
        CREATE TABLE event_records (
            event_id VARCHAR,
            phase VARCHAR,
            updated_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql("Show records by phase.", contexts)

    assert sql is not None
    assert 'SELECT "phase", COUNT(*) AS "record_count"' in sql
    assert 'FROM "event_records"' in sql
    assert 'GROUP BY "phase"' in sql


def test_average_uses_verified_numeric_measure_not_count():
    contexts = [
        """
        CREATE TABLE measurement_records (
            entity_id VARCHAR,
            model_code VARCHAR,
            age_days DECIMAL
        );
        """
    ]

    sql = generate_simple_analytics_sql("Show average age by model.", contexts)

    assert sql is not None
    assert 'SELECT "model_code", AVG("age_days") AS "average_value"' in sql
    assert 'GROUP BY "model_code"' in sql
    assert "COUNT(" not in sql


def test_average_without_verified_measure_is_unsupported():
    contexts = [
        """
        CREATE TABLE measurement_records (
            entity_id VARCHAR,
            model_code VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql("Show average age by model.", contexts)
    message = unsupported_schema_message("Show average age by model.", contexts)

    assert sql is None
    assert message is not None
    assert "age" in message.lower()


def test_latest_uses_verified_temporal_column():
    contexts = [
        """
        CREATE TABLE event_records (
            event_id VARCHAR,
            event_time TIMESTAMP,
            phase VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql("Show latest event records.", contexts)

    assert sql is not None
    assert 'FROM "event_records"' in sql
    assert 'ORDER BY "event_time" DESC' in sql


def test_monthly_count_uses_requested_temporal_column_when_verified():
    contexts = [
        """
        CREATE TABLE event_records (
            event_id VARCHAR,
            updated_at TIMESTAMP,
            created_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show the number of event records updated each month.",
        contexts,
    )

    assert sql is not None
    assert 'EXTRACT(YEAR FROM "updated_at") AS "year"' in sql
    assert 'EXTRACT(MONTH FROM "updated_at") AS "month"' in sql
    assert 'COUNT(*) AS "record_count"' in sql


def test_order_by_uses_verified_column_and_sample_value():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"case records"},"columns":[{"sql_column_name_use_exactly":"State","data_type":"VARCHAR","sample_values":["Open","Closed"]}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE case_records (
            case_id VARCHAR,
            State VARCHAR,
            updated_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show all case records with Open ordered by case ID.",
        contexts,
    )

    assert sql is not None
    assert 'LOWER("State") = \'open\'' in sql
    assert 'ORDER BY "case_id" ASC' in sql


def test_top_grouped_count_is_schema_shape_based():
    contexts = [
        """
        CREATE TABLE occurrence_records (
            occurrence_id VARCHAR,
            model_code VARCHAR,
            reason_code VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show top 5 occurrence records by model.",
        contexts,
    )

    assert sql is not None
    assert 'SELECT "model_code", COUNT(*) AS "record_count"' in sql
    assert 'ORDER BY "record_count" DESC' in sql
    assert "LIMIT 5" in sql


def test_sum_by_year_uses_verified_measure_and_temporal_column():
    contexts = [
        """
        CREATE TABLE transaction_records (
            transaction_id VARCHAR,
            account_name VARCHAR,
            amount_value DECIMAL,
            posted_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql("Show total amount by year.", contexts)

    assert sql is not None
    assert 'EXTRACT(YEAR FROM "posted_at") AS "year"' in sql
    assert 'SUM("amount_value") AS "total_value"' in sql


def test_semantic_coverage_rejects_count_for_average_intent():
    contexts = [
        """
        CREATE TABLE measurement_records (
            entity_id VARCHAR,
            model_code VARCHAR,
            age_days DECIMAL
        );
        """
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT model_code, COUNT(*) AS record_count
        FROM measurement_records
        GROUP BY model_code
        """,
        "Show average age by model.",
        contexts,
    )

    assert error is not None
    assert "average" in error.lower()


def test_literal_validation_rejects_values_outside_verified_samples():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"case records"},"columns":[{"sql_column_name_use_exactly":"State","data_type":"VARCHAR","sample_values":["Open"]}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE case_records (
            case_id VARCHAR,
            State VARCHAR
        );
        """
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT case_id
        FROM case_records
        WHERE LOWER(State) = 'Closed'
        """,
        "Show case records with Open.",
        contexts,
    )

    assert error is not None
    assert "sample values" in error
