import asyncio

from src.pipelines.generation.utils.sql import (
    SQLGenPostProcessor,
    generate_simple_analytics_sql,
    normalize_wren_sql_dialect,
    normalize_sql_with_schema_identifiers,
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


def test_semantic_coverage_rejects_generic_table_for_business_concepts():
    contexts = [
        """
        CREATE TABLE dbo_mbrTime (
            id1 INTEGER,
            id2 INTEGER
        );
        """
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT id1, COUNT(*) AS failures
        FROM dbo_mbrTime
        GROUP BY id1
        ORDER BY failures DESC
        LIMIT 10
        """,
        "Show the top 10 materials with the highest number of failures.",
        contexts,
    )

    assert error is not None
    assert "failure/defect" in error
    assert "material" in error


def test_unsupported_schema_message_requires_all_requested_concepts():
    contexts = [
        """
        CREATE TABLE dbo_mbrTime (
            id1 INTEGER,
            id2 INTEGER
        );
        """
    ]

    message = unsupported_schema_message(
        "Show the top 10 materials with the highest number of failures.",
        contexts,
    )

    assert message is not None
    assert "No retrieved table or view" in message
    assert "failure/defect" in message
    assert "material" in message


def test_unsupported_schema_message_rejects_split_failure_technician_without_coverage():
    contexts = [
        """
        CREATE TABLE dbo_report_failures (
            id INTEGER,
            failure_type VARCHAR
        );
        """,
        """
        CREATE TABLE dbo_technicians (
            id INTEGER,
            name VARCHAR
        );
        """,
    ]

    message = unsupported_schema_message(
        "Show the number of failures by technician.",
        contexts,
    )

    assert message is not None
    assert "failure/defect" in message
    assert "technician" in message


def test_unsupported_schema_generation_result_has_no_invalid_sql():
    contexts = [
        """
        CREATE TABLE dbo_report_failures (
            id INTEGER,
            failure_type VARCHAR
        );
        """,
        """
        CREATE TABLE dbo_technicians (
            id INTEGER,
            name VARCHAR
        );
        """,
    ]

    result = unsupported_schema_generation_result(
        "Show the number of failures by technician.",
        contexts,
        data_source="MSSQL",
    )

    assert result is not None
    assert result["valid_generation_result"] == {}
    invalid = result["invalid_generation_result"]
    assert invalid["type"] == "NO_RELEVANT_SQL"
    assert invalid["sql"] == ""
    assert invalid["original_sql"] == ""
    assert "technician" in invalid["error"]


def test_post_processor_clears_sql_for_unsupported_schema():
    contexts = [
        """
        CREATE TABLE dbo_mbrTime (
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
                SELECT id1, COUNT(*) AS failures
                FROM dbo_mbrTime
                GROUP BY id1
                ORDER BY failures DESC
                LIMIT 10
                """
            ],
            contexts=contexts,
            fallback_query="Show the top 10 materials with the highest number of failures.",
            data_source="MSSQL",
        )
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "NO_RELEVANT_SQL"
    assert result["invalid_generation_result"]["sql"] == ""
    assert result["invalid_generation_result"]["original_sql"] == ""


def test_wren_sql_dialect_normalization_repairs_top_and_joined_limit():
    assert (
        normalize_wren_sql_dialect("SELECT TOP 10 id1 FROM dbo_mbrTime")
        == "SELECT id1 FROM dbo_mbrTime\nLIMIT 10"
    )
    assert (
        normalize_wren_sql_dialect(
            "SELECT id1 FROM dbo_mbrTime ORDER BY failures DESCLIMIT 10"
        )
        == "SELECT id1 FROM dbo_mbrTime ORDER BY failures DESC LIMIT 10"
    )


def test_repair_fallback_filters_critical_priority_and_in_progress_status():
    contexts = [
        """
        CREATE TABLE dbo_repair_logs (
            id VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            created_at TIMESTAMPTZ
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show all critical-priority repairs that are currently in progress.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_repair_logs"' in sql
    assert "\"status\" = 'in progress'" in sql
    assert "\"priority\" = 'critical'" in sql


def test_repair_fallback_preserves_hyphenated_in_progress_status_value():
    contexts = [
        """
        CREATE TABLE dbo_repair_logs (
            id VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show all repairs with a critical priority and an in-progress status.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_repair_logs"' in sql
    assert "\"status\" = 'in-progress'" in sql
    assert "\"priority\" = 'critical'" in sql


def test_repair_logs_highest_priority_orders_by_verified_priority_column():
    contexts = [
        """
        CREATE TABLE dbo_repair_logs (
            id VARCHAR,
            board_model VARCHAR,
            failure_code VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Which repair logs have the highest priority?",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_repair_logs"' in sql
    assert 'ORDER BY CASE LOWER("priority")' in sql
    assert "DESC" in sql


def test_critical_priority_repairs_filter_verified_priority_column():
    contexts = [
        """
        CREATE TABLE dbo_repair_logs (
            id VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show all critical-priority repairs",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_repair_logs"' in sql
    assert "\"priority\" = 'critical'" in sql


def test_repairs_by_status_counts_verified_repair_rows():
    contexts = [
        """
        CREATE TABLE dbo_repair_logs (
            id VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show repairs by status",
        contexts,
    )

    assert sql is not None
    assert 'SELECT "status", COUNT("id") AS "record_count"' in sql
    assert 'FROM "dbo_repair_logs"' in sql
    assert 'GROUP BY "status"' in sql


def test_latest_repair_logs_orders_by_verified_date_column():
    contexts = [
        """
        CREATE TABLE dbo_repair_logs (
            id VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show latest repair logs",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_repair_logs"' in sql
    assert 'ORDER BY "created_at" DESC' in sql


def test_semantic_column_alias_can_satisfy_priority_concept_with_verified_name():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"repair log records"},"columns":[{"sql_column_name_use_exactly":"Urgency","data_type":"VARCHAR","semantic_context_not_sql_identifier":"priority severity for a repair"}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE dbo_work_items (
            id VARCHAR,
            Urgency VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Which repair records have the highest priority?",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_work_items"' in sql
    assert '"Urgency"' in sql
    assert '"priority"' not in sql


def test_failure_by_technician_fallback_uses_verified_tech_column():
    contexts = [
        """
        CREATE TABLE dbo_DebugEntries_Staging2 (
            Tech VARCHAR,
            Failed VARCHAR,
            Material VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show the number of failures by technician.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_DebugEntries_Staging2"' in sql
    assert 'SELECT "Tech", COUNT("Failed") AS "record_count"' in sql
    assert 'WHERE ("Failed" IS NOT NULL AND "Failed" <> \'\')' in sql


def test_failure_by_material_fallback_uses_verified_material_column():
    contexts = [
        """
        CREATE TABLE dbo_DebugEntries_Staging2 (
            Tech VARCHAR,
            Failed VARCHAR,
            Material VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show failures by material.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_DebugEntries_Staging2"' in sql
    assert 'SELECT "Material", COUNT("Failed") AS "record_count"' in sql


def test_failure_type_value_filter_uses_verified_failure_type_column():
    contexts = [
        """
        CREATE TABLE dbo_DebugEntries (
            SerialNumber VARCHAR,
            FailedAt VARCHAR,
            Material VARCHAR
        );
        """,
        """
        CREATE TABLE dbo_repair_logs (
            board_model VARCHAR,
            failure_code VARCHAR,
            status VARCHAR
        );
        """,
        """
        CREATE TABLE dbo_report_failures (
            failure_type VARCHAR,
            failure_line VARCHAR,
            test_name VARCHAR
        );
        """,
    ]

    sql = generate_simple_analytics_sql(
        "Show the number of units with JTAG as the failure type.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_report_failures"' in sql
    assert 'COUNT(*) AS "record_count"' in sql
    assert "\"failure_type\" = 'JTAG'" in sql


def test_board_models_most_failures_counts_failure_records_not_defect_rate():
    contexts = [
        """
        CREATE TABLE dbo_batch_records (
            board_model VARCHAR,
            supplier VARCHAR,
            defect_rate DECIMAL
        );
        """,
        """
        CREATE TABLE dbo_repair_logs (
            board_model VARCHAR,
            failure_code VARCHAR,
            status VARCHAR,
            priority VARCHAR
        );
        """,
    ]

    sql = generate_simple_analytics_sql(
        "Show the top 5 board models with the most failures.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_repair_logs"' in sql
    assert 'SELECT "board_model", COUNT("failure_code") AS "record_count"' in sql
    assert '"defect_rate"' not in sql
    assert "LIMIT 5" in sql


def test_board_models_highest_defect_rate_uses_rate_metric():
    contexts = [
        """
        CREATE TABLE dbo_batch_records (
            board_model VARCHAR,
            supplier VARCHAR,
            defect_rate DECIMAL
        );
        """,
        """
        CREATE TABLE dbo_repair_logs (
            board_model VARCHAR,
            failure_code VARCHAR,
            status VARCHAR
        );
        """,
    ]

    sql = generate_simple_analytics_sql(
        "Show the board models with the highest defect rate.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "dbo_batch_records"' in sql
    assert 'SELECT "board_model", AVG("defect_rate") AS "average_value"' in sql
    assert 'ORDER BY "average_value" DESC' in sql


def test_semantic_coverage_rejects_rate_for_failure_count_intent():
    contexts = [
        """
        CREATE TABLE dbo_batch_records (
            board_model VARCHAR,
            defect_rate DECIMAL
        );
        """
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT board_model, defect_rate
        FROM dbo_batch_records
        ORDER BY defect_rate DESC
        LIMIT 5
        """,
        "Show the top 5 board models with the most failures.",
        contexts,
    )

    assert error is not None
    assert "count of failure records" in error


def test_repairs_by_technician_requires_one_schema_object_covering_both_concepts():
    contexts = [
        """
        CREATE TABLE dbo_repair_logs (
            id VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            failure_code VARCHAR
        );
        """,
        """
        CREATE TABLE dbo_DebugEntries_Staging2 (
            Tech VARCHAR,
            Failed VARCHAR
        );
        """,
    ]

    message = unsupported_schema_message("Show repairs by technician.", contexts)

    assert message is not None
    assert "repair" in message
    assert "technician" in message
