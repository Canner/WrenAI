import asyncio

from src.pipelines.generation.utils.sql import (
    SQLGenPostProcessor,
    _SchemaCatalog,
    _fallback_limit,
    generate_simple_analytics_sql,
    normalize_sql_with_schema_identifiers,
    normalize_wren_sql_dialect,
    sanitize_sql_generation_reasoning,
    schema_grounding_failure_message,
    unsupported_schema_generation_result,
    unsupported_schema_message,
    validate_sql_against_contexts,
    validate_sql_semantic_coverage,
)


class _AcceptingEngine:
    async def dry_plan(self, *args, **kwargs):
        return True, ""

    async def execute_sql(self, *args, **kwargs):
        return True, [], {"correlation_id": "test"}


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


def test_sql_reasoning_sanitizer_blocks_query_shaped_output():
    reasoning = """
    The SQL could look like this:
    ```sql
    SELECT * FROM dbo_dimOrderNumber WHERE id2 = 'CATERPILLAR S.A.R.L.';
    ```
    """

    sanitized = sanitize_sql_generation_reasoning(reasoning)

    assert "SELECT" not in sanitized
    assert "WHERE" not in sanitized
    assert "assume" not in sanitized.lower()
    assert "retrieved schema metadata" in sanitized


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


def test_supported_how_many_question_ignores_interrogative_fillers():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Invoice records by business unit."},"columns":[{"sql_column_name_use_exactly":"invoice_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Invoice identifier."},{"sql_column_name_use_exactly":"business_unit","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Business unit for invoice grouping."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE invoice_records (
            invoice_id VARCHAR,
            business_unit VARCHAR
        );
        """
    ]

    message = unsupported_schema_message(
        "How many invoice records are there by business unit?",
        contexts,
    )

    assert message is None


def test_unsupported_how_many_question_still_reports_missing_schema_terms():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Customer order records."},"columns":[{"sql_column_name_use_exactly":"order_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Order identifier."},{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Customer name."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE order_records (
            order_id VARCHAR,
            customer_name VARCHAR
        );
        """
    ]

    message = unsupported_schema_message(
        "How many repair records are there by status?",
        contexts,
    )

    assert message is not None
    assert "repair" in message
    assert "status" in message
    assert "how" not in message
    assert "there" not in message


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


def test_schema_identifier_normalization_rewrites_verified_source_table_name():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","sql_identifier_contract":{"sql_table_name_use_exactly":"orders_model","sql_column_names_use_exactly":["customer_name"]},"semantic_context_not_sql_identifiers":{"source_table_reference":{"schema":"dbo","table":"tblOrders"},"display_name":"New Orders"},"columns":[{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":{"source_column_name":"CustName","display_name":"CustName"}}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE orders_model (
            customer_name VARCHAR
        );
        """
    ]

    sql = normalize_sql_with_schema_identifiers(
        "SELECT customer_name FROM dbo.tblOrders",
        contexts,
    )

    assert 'FROM "orders_model"' in sql
    assert _SchemaCatalog.from_contexts(contexts).validate_sql(sql) is None
    assert validate_sql_against_contexts(sql, contexts) is None


def test_schema_identifier_normalization_rewrites_verified_source_column_name():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","sql_identifier_contract":{"sql_table_name_use_exactly":"orders_model","sql_column_names_use_exactly":["customer_name"]},"semantic_context_not_sql_identifiers":{"source_table_reference":{"schema":"dbo","table":"tblOrders"}},"columns":[{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":{"source_column_name":"CustName","display_name":"CustName"}}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE orders_model (
            customer_name VARCHAR
        );
        """
    ]

    sql = normalize_sql_with_schema_identifiers(
        """
        SELECT o.CustName
        FROM dbo.tblOrders o
        WHERE LOWER(o.CustName) = LOWER('lockheed martin')
        """,
        contexts,
    )

    assert 'FROM "orders_model" o' in sql
    assert 'o."customer_name"' in sql
    assert "CustName" not in sql
    assert _SchemaCatalog.from_contexts(contexts).validate_sql(sql) is None
    assert validate_sql_against_contexts(sql, contexts) is None


def test_schema_identifier_normalization_rewrites_verified_display_column_variant():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","sql_identifier_contract":{"sql_table_name_use_exactly":"orders_model","sql_column_names_use_exactly":["CustName"]},"semantic_context_not_sql_identifiers":{"source_table_reference":{"schema":"dbo","table":"tblOrders"}},"columns":[{"sql_column_name_use_exactly":"CustName","data_type":"VARCHAR","display_name":"Customer name","semantic_context_not_sql_identifier":{"display_name":"Customer name"}}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE orders_model (
            CustName VARCHAR
        );
        """
    ]

    sql = normalize_sql_with_schema_identifiers(
        """
        SELECT o.CustomerName
        FROM dbo.tblOrders o
        WHERE LOWER(o.Customer_Name) = LOWER('lockheed martin')
        """,
        contexts,
    )

    assert 'o."CustName"' in sql
    assert "CustomerName" not in sql
    assert "Customer_Name" not in sql
    assert _SchemaCatalog.from_contexts(contexts).validate_sql(sql) is None


def test_schema_identifier_normalization_keeps_ambiguous_source_table_invalid():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","sql_identifier_contract":{"sql_table_name_use_exactly":"order_archive","sql_column_names_use_exactly":["id"]},"semantic_context_not_sql_identifiers":{"source_table_reference":{"schema":"dbo","table":"orders"}},"columns":[{"sql_column_name_use_exactly":"id","data_type":"VARCHAR"}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE order_archive (
            id VARCHAR
        );
        """,
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","sql_identifier_contract":{"sql_table_name_use_exactly":"order_current","sql_column_names_use_exactly":["id"]},"semantic_context_not_sql_identifiers":{"source_table_reference":{"schema":"dbo","table":"orders"}},"columns":[{"sql_column_name_use_exactly":"id","data_type":"VARCHAR"}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE order_current (
            id VARCHAR
        );
        """,
    ]

    sql = normalize_sql_with_schema_identifiers("SELECT id FROM dbo.orders", contexts)
    error = _SchemaCatalog.from_contexts(contexts).validate_sql(sql)

    assert "dbo.orders" in sql
    assert error is not None
    assert "dbo.orders" in error


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


def test_schema_grounding_failure_message_reports_terms_split_across_tables():
    contexts = [
        """
        CREATE TABLE user_activity (
            username VARCHAR
        );
        """,
        """
        CREATE TABLE record_counts (
            recordcnt INTEGER
        );
        """,
    ]

    message = schema_grounding_failure_message(
        "Show top 5 username by recordcnt.",
        contexts,
    )

    assert "active project" in message
    assert "username" in message
    assert "recordcnt" in message
    assert "Generated SQL referenced" not in message


def test_schema_coverage_accepts_generic_word_form_variants():
    contexts = [
        """
        CREATE TABLE work_update_log (
            item_id VARCHAR,
            updated_at TIMESTAMP
        );
        """
    ]

    sql = """
    SELECT
      CAST(EXTRACT(YEAR FROM updated_at) AS BIGINT) AS year,
      CAST(EXTRACT(MONTH FROM updated_at) AS BIGINT) AS month,
      COUNT(*) AS record_count
    FROM work_update_log
    GROUP BY
      CAST(EXTRACT(YEAR FROM updated_at) AS BIGINT),
      CAST(EXTRACT(MONTH FROM updated_at) AS BIGINT)
    """

    error = validate_sql_semantic_coverage(
        sql,
        "Show the number of work updates updated each month.",
        contexts,
    )

    assert error is None
    assert unsupported_schema_message(
        "Show the number of work updates updated each month.",
        contexts,
    ) is None


def test_schema_fallback_uses_verified_monthly_update_timestamp():
    contexts = [
        """
        CREATE TABLE work_update_log (
            item_id VARCHAR,
            updated_at TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show the number of work updates updated each month.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "work_update_log"' in sql
    assert 'CAST(EXTRACT(YEAR FROM "updated_at") AS BIGINT)' in sql
    assert "COUNT(*)" in sql


def test_schema_fallback_uses_unambiguous_implicit_text_value_filter():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Order records for customer activity."},"columns":[{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Customer name. Use for customer, account, or buyer filters."},{"sql_column_name_use_exactly":"product_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Product name. Use for product analysis."},{"sql_column_name_use_exactly":"order_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Order identifier."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE order_records (
            customer_name VARCHAR,
            product_name VARCHAR,
            order_id VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show orders from Lockheed Martine.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "order_records"' in sql
    assert 'LOWER("customer_name") LIKE \'%lockheed martine%\'' in sql


def test_schema_fallback_allows_punctuated_customer_value_after_for():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Order records for customer activity."},"columns":[{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Customer name. Use for customer, account, or buyer filters.","sample_values":["LOCKHEED MARTIN CORPORATION"]},{"sql_column_name_use_exactly":"product_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Product name. Use for product analysis."},{"sql_column_name_use_exactly":"order_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Order identifier."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE order_records (
            customer_name VARCHAR,
            product_name VARCHAR,
            order_id VARCHAR
        );
        """
    ]
    query = "Show orders for CATERPILLAR S.A.R.L."

    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert validate_sql_semantic_coverage(
        """
        SELECT customer_name, order_id
        FROM order_records
        WHERE LOWER(customer_name) LIKE '%caterpillar%'
        """,
        query,
        contexts,
    ) is None
    assert sql is not None
    assert 'FROM "order_records"' in sql
    assert 'LOWER("customer_name") LIKE \'%caterpillar s.a.r.l%\'' in sql


def test_schema_fallback_keeps_customer_value_separate_from_grouping_phrase():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Order records for customer activity."},"columns":[{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Customer name. Use for customer, account, or buyer filters."},{"sql_column_name_use_exactly":"product_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Product name. Use for product analysis."},{"sql_column_name_use_exactly":"order_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Order identifier."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE order_records (
            customer_name VARCHAR,
            product_name VARCHAR,
            order_id VARCHAR
        );
        """
    ]
    query = "Show orders from PACCAR PARTS DIVISION by product."

    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'LOWER("customer_name") LIKE \'%paccar parts division%\'' in sql
    assert 'GROUP BY "product_name"' in sql


def test_schema_fallback_stops_grouping_phrase_before_from_table_name():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Business unit activity records."},"columns":[{"sql_column_name_use_exactly":"bunit","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Business unit grouping code."},{"sql_column_name_use_exactly":"record_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Record identifier."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE business_unit_records (
            bunit VARCHAR,
            record_id VARCHAR
        );
        """
    ]
    query = "Show row counts grouped by bunit from business_unit_records."

    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "business_unit_records"' in sql
    assert 'GROUP BY "bunit"' in sql
    assert validate_sql_semantic_coverage(sql, query, contexts) is None


def test_schema_fallback_groups_monthly_record_request_without_count_word():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Order records for customer activity."},"columns":[{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Customer name. Use for customer, account, or buyer filters."},{"sql_column_name_use_exactly":"order_date","data_type":"DATE","semantic_context_not_sql_identifier":"Order placement date."},{"sql_column_name_use_exactly":"order_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Order identifier."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE order_records (
            customer_name VARCHAR,
            order_date DATE,
            order_id VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show monthly orders from JOHN DEERE COMMERCIAL PRODUCTS.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "order_records"' in sql
    assert 'CAST(EXTRACT(YEAR FROM "order_date") AS BIGINT)' in sql
    assert 'CAST(EXTRACT(MONTH FROM "order_date") AS BIGINT)' in sql
    assert 'COUNT(*) AS "record_count"' in sql
    assert 'LOWER("customer_name") LIKE \'%john deere commercial products%\'' in sql


def test_schema_fallback_does_not_treat_customer_suffix_as_required_schema():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Order records for customer activity."},"columns":[{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Customer name. Use for customer, account, or buyer filters."},{"sql_column_name_use_exactly":"order_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Order identifier."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE order_records (
            customer_name VARCHAR,
            order_id VARCHAR
        );
        """,
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Refund timing records."},"columns":[{"sql_column_name_use_exactly":"day_s_from_refund","data_type":"INTEGER","semantic_context_not_sql_identifier":"Refund timing days."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE refund_records (
            day_s_from_refund INTEGER
        );
        """,
    ]
    query = "Show orders for CATERPILLAR S.A.R.L."

    assert unsupported_schema_message(query, contexts) is None


def test_schema_fallback_prefers_customer_semantics_over_value_word_overlap():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Use this table for new order analysis."},"columns":[{"sql_column_name_use_exactly":"CustName","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Customer name. Use this column when the user asks for customer, customer name, account, or buyer.","display_name":"Customer name","source_column_name":"CustName"},{"sql_column_name_use_exactly":"Division","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Business division. Use for division-level reporting or grouping.","display_name":"Division","source_column_name":"Division"},{"sql_column_name_use_exactly":"OrdDate","data_type":"DATE","semantic_context_not_sql_identifier":"Order placement date."},{"sql_column_name_use_exactly":"OrdNo","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Sales order number."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE dbo_tblNewOrders (
            CustName VARCHAR,
            Division VARCHAR,
            OrdDate DATE,
            OrdNo VARCHAR
        );
        """
    ]
    query = "Show recent orders from PACCAR PARTS DIVISION."

    sql = generate_simple_analytics_sql(query, contexts)

    assert sql is not None
    assert 'FROM "dbo_tblNewOrders"' in sql
    assert 'LOWER("CustName") LIKE \'%paccar parts division%\'' in sql
    assert "Division) = 'paccar parts division'" not in sql
    assert 'ORDER BY "OrdDate" DESC' in sql


def test_schema_fallback_prefers_direct_table_name_match_when_metadata_overlaps():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Use this table for order and customer questions."},"columns":[{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Customer name. Use for customer filters."},{"sql_column_name_use_exactly":"order_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Order identifier."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE sales_history (
            customer_name VARCHAR,
            order_id VARCHAR
        );
        """,
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Use this table for order and customer questions."},"columns":[{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Customer name. Use for customer filters."},{"sql_column_name_use_exactly":"order_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Order identifier."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE new_orders (
            customer_name VARCHAR,
            order_id VARCHAR
        );
        """,
    ]

    sql = generate_simple_analytics_sql("Show orders from Acme.", contexts)

    assert sql is not None
    assert 'FROM "new_orders"' in sql


def test_schema_coverage_uses_word_form_variants_per_table():
    contexts = [
        """
        CREATE TABLE report_failures (
            report_id VARCHAR,
            failure_line VARCHAR
        );
        """,
        """
        CREATE TABLE failure_patterns (
            severity VARCHAR,
            failure_type VARCHAR
        );
        """,
    ]
    query = "Show failures by severity."

    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "failure_patterns"' in sql
    assert 'GROUP BY "severity"' in sql


def test_schema_fallback_splits_compound_identifier_names_for_grouping_and_measure():
    contexts = [
        """
        CREATE TABLE payable_invoices (
            bunit VARCHAR,
            suppliername VARCHAR,
            grossamount DECIMAL
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show total gross amount by supplier name.",
        contexts,
    )

    assert sql is not None
    assert 'SELECT "suppliername", SUM("grossamount") AS "total_value"' in sql
    assert 'GROUP BY "suppliername"' in sql


def test_semantic_validation_rejects_weaker_explicit_grouping_column():
    contexts = [
        """
        CREATE TABLE payable_invoices (
            bunit VARCHAR,
            suppliername VARCHAR,
            grossamount DECIMAL
        );
        """
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT bunit, SUM(grossamount) AS total_value
        FROM payable_invoices
        GROUP BY bunit
        ORDER BY total_value DESC
        """,
        "Show total gross amount by supplier name.",
        contexts,
    )

    assert error is not None
    assert "weaker matching column" in error or "grouping dimension" in error


def test_semantic_validation_accepts_compound_status_grouping_column():
    contexts = [
        """
        CREATE TABLE task_rollups (
            taskstatus VARCHAR,
            task_id VARCHAR
        );
        """,
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT taskstatus, COUNT(*) AS record_count
        FROM task_rollups
        GROUP BY taskstatus
        """,
        "How many task records are there by task status?",
        contexts,
    )

    assert error is None


def test_fallback_limit_accepts_spelled_out_top_number():
    assert _fallback_limit("Show the top five groups from that result.") == 5


def test_followup_group_result_words_do_not_require_schema_columns():
    contexts = [
        """
        CREATE TABLE repair_logs (
            status VARCHAR,
            repair_id VARCHAR
        );
        """,
    ]

    assert (
        unsupported_schema_message(
            "Show the top five groups from the repair records by status.",
            contexts,
        )
        is None
    )


def test_unsupported_subject_still_blocks_cross_domain_value_filter():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Order records for customer activity."},"columns":[{"sql_column_name_use_exactly":"customer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Customer name. Use for customer, account, or buyer filters."},{"sql_column_name_use_exactly":"order_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Order identifier."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE order_records (
            customer_name VARCHAR,
            order_id VARCHAR
        );
        """
    ]
    query = "Show tickets from ACME CORP."

    message = unsupported_schema_message(query, contexts)

    assert message is not None
    assert "ticket" in message.lower()
    assert "acme" not in message.lower()


def test_schema_fallback_skips_ambiguous_implicit_text_value_filter():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Order records."},"columns":[{"sql_column_name_use_exactly":"buyer_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Buyer name."},{"sql_column_name_use_exactly":"seller_name","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Seller name."},{"sql_column_name_use_exactly":"order_id","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Order identifier."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE order_records (
            buyer_name VARCHAR,
            seller_name VARCHAR,
            order_id VARCHAR
        );
        """
    ]

    assert (
        generate_simple_analytics_sql("Show orders from Acme Industries.", contexts)
        is None
    )


def test_schema_catalog_ignores_extract_from_column_clause():
    contexts = [
        """
        CREATE TABLE work_update_log (
            item_id VARCHAR,
            updated_at TIMESTAMP
        );
        """
    ]
    sql = """
    SELECT CAST(EXTRACT(YEAR FROM "updated_at") AS BIGINT) AS "year", COUNT(*) AS "record_count"
    FROM "work_update_log"
    GROUP BY CAST(EXTRACT(YEAR FROM "updated_at") AS BIGINT)
    """

    assert _SchemaCatalog.from_contexts(contexts).validate_sql(sql) is None


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


def test_post_processor_prefers_fact_table_fallback_over_dimension_only_sql():
    contexts = [
        """
        CREATE TABLE invoice_records (
            invoice_id VARCHAR,
            business_unit VARCHAR
        );
        """,
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"invoice business unit grouping lookup"},"columns":[{"sql_column_name_use_exactly":"name","display_name":"Business Unit Group"}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE business_unit_groups (
            name VARCHAR
        );
        """,
    ]
    post_processor = SQLGenPostProcessor(engine=_AcceptingEngine())

    result = asyncio.run(
        post_processor.run(
            [
                """
                SELECT name, COUNT(*) AS record_count
                FROM business_unit_groups
                GROUP BY name
                ORDER BY record_count DESC
                """
            ],
            contexts=contexts,
            fallback_query="How many invoice records are there by business unit?",
            data_source="MSSQL",
            use_dry_plan=True,
        )
    )

    sql = result["valid_generation_result"]["sql"]
    assert result["invalid_generation_result"] == {}
    assert "invoice_records" in sql
    assert "business_unit" in sql
    assert "business_unit_groups" not in sql


def test_post_processor_converts_invented_table_to_schema_message():
    contexts = [
        """
        CREATE TABLE user_activity (
            username VARCHAR
        );
        """,
        """
        CREATE TABLE record_counts (
            recordcnt INTEGER
        );
        """,
    ]
    post_processor = SQLGenPostProcessor(engine=None)

    result = asyncio.run(
        post_processor.run(
            [
                """
                SELECT username
                FROM records
                ORDER BY recordcnt DESC
                LIMIT 5
                """
            ],
            contexts=contexts,
            fallback_query="Show top 5 username by recordcnt.",
            data_source="MSSQL",
        )
    )

    invalid = result["invalid_generation_result"]
    assert result["valid_generation_result"] == {}
    assert invalid["type"] == "NO_RELEVANT_SQL"
    assert invalid["sql"] == ""
    assert invalid["original_sql"] == ""
    assert "active project" in invalid["error"]
    assert "username" in invalid["error"]
    assert "recordcnt" in invalid["error"]
    assert "Generated SQL referenced" not in invalid["error"]


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


def test_user_values_are_allowed_for_single_verified_text_column():
    contexts = [
        """
        CREATE TABLE work_update_log (
            item_id VARCHAR,
            state_name VARCHAR(255),
            updated_at TIMESTAMP
        );
        """
    ]

    query = (
        "Show the distribution of work updates across completed and "
        "in-progress state names."
    )
    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "work_update_log"' in sql
    assert 'LOWER("state_name") IN (\'completed\', \'in-progress\')' in sql
    assert 'GROUP BY "state_name"' in sql


def test_explicit_column_adjacent_value_after_column_is_filter_value():
    contexts = [
        """
        CREATE TABLE work_items (
            item_id VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            updated_at TIMESTAMP
        );
        """
    ]

    query = "Show work items with status open."
    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "work_items"' in sql
    assert 'LOWER("status") = \'open\'' in sql


def test_explicit_column_value_survives_multi_column_semantic_ambiguity():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Support ticket records."},"columns":[{"sql_column_name_use_exactly":"title","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Ticket title."},{"sql_column_name_use_exactly":"description","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Ticket description."},{"sql_column_name_use_exactly":"status","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Ticket status."},{"sql_column_name_use_exactly":"priority","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Ticket priority."},{"sql_column_name_use_exactly":"data","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Ticket payload."},{"sql_column_name_use_exactly":"created_at","data_type":"TIMESTAMP","semantic_context_not_sql_identifier":"Ticket creation time."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE support_tickets (
            title VARCHAR,
            description VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            data VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    query = "Show tickets with status open."
    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "support_tickets"' in sql
    assert 'LOWER("status") = \'open\'' in sql


def test_explicit_column_value_allows_value_token_seen_elsewhere_in_schema():
    contexts = [
        """
        CREATE TABLE production_batches (
            batch_id VARCHAR,
            supplier VARCHAR,
            inspection_status VARCHAR,
            created_at TIMESTAMP
        );
        """,
        """
        CREATE TABLE debug_entries (
            entry_id VARCHAR,
            failed_at TIMESTAMP
        );
        """,
    ]

    query = "Show batches with inspection status failed."
    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "production_batches"' in sql
    assert 'LOWER("inspection_status") = \'failed\'' in sql


def test_explicit_column_adjacent_value_before_column_is_filter_value():
    contexts = [
        """
        CREATE TABLE support_tickets (
            ticket_id VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    query = "Show high priority tickets."
    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "support_tickets"' in sql
    assert 'LOWER("priority") = \'high\'' in sql
    assert 'LOWER("title")' not in sql
    assert 'LOWER("description")' not in sql
    assert 'LOWER("status") = \'high priority\'' not in sql
    assert 'LOWER("data")' not in sql


def test_explicit_preceding_value_survives_multi_column_semantic_ambiguity():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Support ticket records."},"columns":[{"sql_column_name_use_exactly":"title","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Ticket title."},{"sql_column_name_use_exactly":"description","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Ticket description."},{"sql_column_name_use_exactly":"status","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Ticket status."},{"sql_column_name_use_exactly":"priority","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Ticket priority."},{"sql_column_name_use_exactly":"data","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Ticket payload."},{"sql_column_name_use_exactly":"created_at","data_type":"TIMESTAMP","semantic_context_not_sql_identifier":"Ticket creation time."}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE support_tickets (
            title VARCHAR,
            description VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            data VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    query = "Show high priority tickets."
    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "support_tickets"' in sql
    assert 'LOWER("priority") = \'high\'' in sql


def test_explicit_identifier_style_column_value_filter_is_grounded():
    contexts = [
        """
        CREATE TABLE repair_logs (
            board_model VARCHAR,
            failure_code VARCHAR,
            status VARCHAR,
            priority VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    query = "Show repairs for failure code BGA-001."
    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "repair_logs"' in sql
    assert 'LOWER("failure_code") = \'bga-001\'' in sql


def test_open_filter_phrase_strips_explicit_column_name_from_value():
    contexts = [
        """
        CREATE TABLE production_batches (
            batch_id VARCHAR,
            supplier VARCHAR,
            board_model VARCHAR,
            created_at TIMESTAMP
        );
        """
    ]

    query = "Show batches from supplier Wurth Elektronik."
    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "production_batches"' in sql
    assert 'LOWER("supplier") = \'wurth elektronik\'' in sql
    assert "supplier wurth" not in sql.lower()


def test_column_value_label_is_not_treated_as_literal_filter_value():
    contexts = [
        """
        CREATE TABLE work_update_log (
            item_id VARCHAR,
            state_name VARCHAR(255),
            updated_at TIMESTAMP
        );
        """
    ]

    query = "Show the distribution of work updates across state name values."
    sql = generate_simple_analytics_sql(query, contexts)

    assert unsupported_schema_message(query, contexts) is None
    assert sql is not None
    assert 'FROM "work_update_log"' in sql
    assert 'GROUP BY "state_name"' in sql
    assert "WHERE" not in sql


def test_subject_noun_is_not_treated_as_literal_filter_value():
    contexts = [
        """
        CREATE TABLE purchase_order_records (
            purchase_order_id VARCHAR,
            currency_code VARCHAR,
            order_date DATE,
            order_quantity DECIMAL,
            record_type VARCHAR,
            record_status VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "How many purchase orders are there by currency?",
        contexts,
    )

    assert unsupported_schema_message(
        "How many purchase orders are there by currency?",
        contexts,
    ) is None
    assert sql is not None
    assert 'FROM "purchase_order_records"' in sql
    assert 'GROUP BY "currency_code"' in sql
    assert "WHERE" not in sql


def test_grouping_dimension_is_not_treated_as_subject_column_literal():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"sales records with repair item status reporting metadata"},"columns":[{"sql_column_name_use_exactly":"RepairItem","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Repair item"}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE sales_records (
            RepairItem VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "How many repair records are there by repair status?",
        contexts,
    )

    assert sql is None
    assert validate_sql_semantic_coverage(
        """
        SELECT "RepairItem", COUNT(*) AS "record_count"
        FROM "sales_records"
        WHERE LOWER("RepairItem") = 'status'
        GROUP BY "RepairItem"
        """,
        "How many repair records are there by repair status?",
        contexts,
    )


def test_subject_entity_is_not_grounded_by_sample_value_filter():
    contexts = [
        """
        /*
        WREN RETRIEVED SEMANTIC CONTEXT
        {"object_type":"model","semantic_context_not_sql_identifiers":{"description":"Tariff liquidation records."},"columns":[{"sql_column_name_use_exactly":"LiquidationStatus","data_type":"VARCHAR","semantic_context_not_sql_identifier":"Liquidation status.","sample_values":["Repair","Complete"]}]}
        WREN SQL IDENTIFIER CONTRACT
        */
        CREATE TABLE tariff_records (
            LiquidationStatus VARCHAR,
            Entry_Date TIMESTAMP
        );
        """
    ]
    query = "How many repair records are there by repair status?"

    sql = generate_simple_analytics_sql(query, contexts)
    message = unsupported_schema_message(query, contexts)
    error = validate_sql_semantic_coverage(
        """
        SELECT LiquidationStatus, COUNT(*) AS record_count
        FROM tariff_records
        WHERE LOWER(LiquidationStatus) = 'repair'
        GROUP BY LiquidationStatus
        """,
        query,
        contexts,
    )

    assert sql is None
    assert message is not None
    assert "repair" in message.lower()
    assert error is not None
    assert "repair" in error.lower()


def test_compact_accounting_identifiers_support_balance_and_currency_questions():
    balance_contexts = [
        """
        CREATE TABLE balance_records (
            bunit VARCHAR,
            period VARCHAR,
            endbalance FLOAT8
        );
        """
    ]
    balance_sql = generate_simple_analytics_sql(
        "Show total ending balance by period and business unit.",
        balance_contexts,
    )

    assert balance_sql is not None
    assert 'SUM("endbalance") AS "total_value"' in balance_sql
    assert 'GROUP BY "bunit", "period"' in balance_sql or 'GROUP BY "period", "bunit"' in balance_sql
    assert "WHERE" not in balance_sql

    exchange_contexts = [
        """
        CREATE TABLE exchange_rate_records (
            currencyfrom VARCHAR,
            currencyto VARCHAR,
            exchangerate FLOAT8
        );
        """
    ]
    exchange_sql = generate_simple_analytics_sql(
        "Show exchange rates by currency pair.",
        exchange_contexts,
    )

    assert exchange_sql is not None
    assert 'FROM "exchange_rate_records"' in exchange_sql
    assert '"exchangerate"' in exchange_sql
    assert '"currencyfrom"' in exchange_sql or '"currencyto"' in exchange_sql


def test_semantic_validation_rejects_subject_noun_literal_filter():
    contexts = [
        """
        CREATE TABLE purchase_order_records (
            purchase_order_id VARCHAR,
            currency_code VARCHAR,
            order_date DATE,
            order_quantity DECIMAL,
            record_type VARCHAR,
            record_status VARCHAR
        );
        """
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT currency_code, COUNT(*) AS record_count
        FROM purchase_order_records
        WHERE LOWER(record_type) = 'purchase'
        GROUP BY currency_code
        """,
        "How many purchase orders are there by currency?",
        contexts,
    )

    assert error is not None
    assert "not grounded as a filter value" in error


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


def test_count_mentions_subject_without_implicit_grouping():
    contexts = [
        """
        CREATE TABLE invoice_records (
            invoice_number VARCHAR,
            invoice_date TIMESTAMP,
            invoice_type VARCHAR,
            business_unit VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "How many invoice records are there?",
        contexts,
    )

    assert sql is not None
    assert sql.strip() == (
        'SELECT COUNT(*) AS "record_count"\n'
        'FROM "invoice_records"'
    )
    assert "GROUP BY" not in sql


def test_latest_by_temporal_column_does_not_become_grouped_count():
    contexts = [
        """
        CREATE TABLE account_reconciliation_records (
            account_number VARCHAR,
            approval_date TIMESTAMP,
            status VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show the latest account reconciliation records by approval date.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "account_reconciliation_records"' in sql
    assert 'ORDER BY "approval_date" DESC' in sql
    assert "COUNT(*)" not in sql
    assert "GROUP BY" not in sql


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
    assert 'CAST(EXTRACT(YEAR FROM "updated_at") AS BIGINT) AS "year"' in sql
    assert 'CAST(EXTRACT(MONTH FROM "updated_at") AS BIGINT) AS "month"' in sql
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


def test_single_grouping_dimension_does_not_over_split_results():
    contexts = [
        """
        CREATE TABLE account_events (
            event_id VARCHAR,
            account_name VARCHAR,
            account_reference VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql("Show number of events by account.", contexts)

    assert sql is not None
    assert 'GROUP BY "account_name"' in sql
    assert "account_reference" not in sql


def test_missing_value_intent_uses_verified_plural_name_column():
    contexts = [
        """
        CREATE TABLE account_events (
            event_id VARCHAR,
            account_name VARCHAR,
            event_time TIMESTAMP
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show events with missing account names.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "account_events"' in sql
    assert '"account_name" IS NULL' in sql


def test_semantic_validation_rejects_weaker_null_check_column():
    contexts = [
        """
        CREATE TABLE account_events (
            event_id VARCHAR,
            account_name VARCHAR,
            account_reference VARCHAR
        );
        """
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT account_name, account_reference
        FROM account_events
        WHERE account_reference IS NULL
        """,
        "Show events with missing account names.",
        contexts,
    )

    assert error is not None
    assert "weaker matching column" in error


def test_top_records_are_listed_without_implicit_grouped_aggregate():
    contexts = [
        """
        CREATE TABLE scored_events (
            event_id VARCHAR,
            score_value DECIMAL,
            event_date TIMESTAMP,
            category_name VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql("Show top 10 scored events from July.", contexts)

    assert sql is not None
    assert 'FROM "scored_events"' in sql
    assert "GROUP BY" not in sql
    assert 'ORDER BY "score_value" DESC' in sql
    assert "LIMIT 10" in sql


def test_semantic_validation_accepts_generated_month_date_range():
    contexts = [
        """
        CREATE TABLE scored_events (
            event_id VARCHAR,
            score_value DECIMAL,
            event_date TIMESTAMP,
            category_name VARCHAR
        );
        """
    ]
    query = "Show top 10 scored events from July."
    sql = generate_simple_analytics_sql(query, contexts)

    assert sql is not None
    assert validate_sql_semantic_coverage(sql, query, contexts) is None


def test_top_records_without_verified_rank_measure_uses_date_ordering():
    contexts = [
        """
        CREATE TABLE order_records (
            order_id VARCHAR,
            order_date TIMESTAMP,
            fx_currency DECIMAL,
            customer_name VARCHAR
        );
        """
    ]

    sql = generate_simple_analytics_sql("Show top 10 order records from July.", contexts)

    assert sql is not None
    assert 'FROM "order_records"' in sql
    assert 'ORDER BY "order_date" DESC' in sql
    assert 'fx_currency' not in sql.split("ORDER BY", maxsplit=1)[1]
    assert "LIMIT 10" in sql


def test_top_rows_by_numeric_column_orders_without_grouping():
    contexts = [
        """
        CREATE TABLE failure_patterns (
            pattern_id VARCHAR,
            name VARCHAR,
            severity VARCHAR,
            occurrences INTEGER,
            cost_impact DECIMAL
        );
        """
    ]

    sql = generate_simple_analytics_sql(
        "Show top 10 failure patterns by occurrences.",
        contexts,
    )

    assert sql is not None
    assert 'FROM "failure_patterns"' in sql
    assert "GROUP BY" not in sql
    assert 'ORDER BY "occurrences" DESC' in sql
    assert "LIMIT 10" in sql


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
    assert 'CAST(EXTRACT(YEAR FROM "posted_at") AS BIGINT) AS "year"' in sql
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


def test_semantic_validation_rejects_multi_group_for_single_dimension():
    contexts = [
        """
        CREATE TABLE account_events (
            event_id VARCHAR,
            account_name VARCHAR,
            account_reference VARCHAR
        );
        """
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT account_name, account_reference, COUNT(*) AS record_count
        FROM account_events
        GROUP BY account_name, account_reference
        """,
        "Show number of events by account.",
        contexts,
    )

    assert error is not None
    assert "one grouping dimension" in error


def test_semantic_validation_rejects_top_record_grouped_aggregate():
    contexts = [
        """
        CREATE TABLE scored_events (
            event_id VARCHAR,
            score_value DECIMAL,
            event_date TIMESTAMP,
            category_name VARCHAR
        );
        """
    ]

    error = validate_sql_semantic_coverage(
        """
        SELECT category_name, SUM(score_value) AS total_value
        FROM scored_events
        GROUP BY category_name
        ORDER BY total_value DESC
        LIMIT 10
        """,
        "Show top 10 scored events from July.",
        contexts,
    )

    assert error is not None
    assert "grouped aggregate" in error
