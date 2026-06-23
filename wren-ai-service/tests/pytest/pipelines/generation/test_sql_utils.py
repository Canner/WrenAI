from src.pipelines.generation.utils.sql import (
    contains_unsupported_mssql_json_access,
    construct_valid_table_names,
    extract_sql_generation_result,
    find_invalid_column_references,
    find_invalid_table_references,
    get_json_field_instructions,
    get_metric_instructions,
    normalize_data_source,
    normalize_generation_result_sql,
    normalize_sql_column_references_to_schema,
    get_sql_generation_system_prompt,
    get_text_to_sql_rules,
)


def test_construct_valid_table_names_from_schema_documents():
    documents = [
        'CREATE TABLE repair_logs ("id" INTEGER);',
        '/* comment */ CREATE TABLE "employees" ("emp_no" INTEGER);',
    ]

    assert construct_valid_table_names(documents) == ["employees", "repair_logs"]


def test_schema_validation_ignores_null_table_metadata():
    assert find_invalid_table_references(
        'SELECT * FROM "dbo_tblSales"',
        [None, "dbo_tblSales"],
    ) == []


def test_schema_validation_ignores_null_column_metadata():
    assert find_invalid_column_references(
        'SELECT "dbo_tblSales"."Market" FROM "dbo_tblSales"',
        {"dbo_tblSales": [None, "Market"]},
    ) == []


def test_normalize_sql_column_references_to_schema_uses_exact_schema_names():
    sql = (
        'SELECT "dbo_xStageLoad8_Test"."PH-BU", "dbo_xStageLoad8_Test"."P-M" '
        'FROM "dbo_xStageLoad8_Test"'
    )

    normalized = normalize_sql_column_references_to_schema(
        sql,
        {"dbo_xStageLoad8_Test": ["PH_BU", "P_M"]},
    )

    assert '"dbo_xStageLoad8_Test"."PH_BU"' in normalized
    assert '"dbo_xStageLoad8_Test"."P_M"' in normalized
    assert "PH-BU" not in normalized
    assert "P-M" not in normalized


def test_normalize_sql_column_references_to_schema_maps_underscore_to_camel_columns():
    sql = (
        'SELECT "dbo_tblSalesHistory"."OTD_Date", SUM("dbo_tblSalesHistory"."Sales_Value") '
        'FROM "dbo_tblSalesHistory" '
        'GROUP BY "dbo_tblSalesHistory"."OTD_Date"'
    )

    normalized = normalize_sql_column_references_to_schema(
        sql,
        {"dbo_tblSalesHistory": ["OTDDate", "SalesValue"]},
    )

    assert '"dbo_tblSalesHistory"."OTDDate"' in normalized
    assert '"dbo_tblSalesHistory"."SalesValue"' in normalized
    assert "OTD_Date" not in normalized
    assert "Sales_Value" not in normalized
    assert find_invalid_column_references(
        normalized,
        {"dbo_tblSalesHistory": ["OTDDate", "SalesValue"]},
    ) == []


def test_normalize_sql_column_references_to_schema_maps_unqualified_underscore_to_camel_columns():
    sql = (
        'SELECT DATEPART(YEAR, "OTD_Date") AS "Year", SUM(Sales_Value) '
        'FROM "dbo_tblSalesHistory" '
        'GROUP BY DATEPART(YEAR, "OTD_Date")'
    )

    normalized = normalize_sql_column_references_to_schema(
        sql,
        {"dbo_tblSalesHistory": ["OTDDate", "SalesValue"]},
    )

    assert 'DATEPART(YEAR, "OTDDate") AS "Year"' in normalized
    assert 'SUM("SalesValue")' in normalized
    assert "OTD_Date" not in normalized
    assert "Sales_Value" not in normalized
    assert find_invalid_column_references(
        normalized,
        {"dbo_tblSalesHistory": ["OTDDate", "SalesValue"]},
    ) == []


def test_normalize_sql_column_references_to_schema_maps_otd_date_to_invoice_date():
    sql = (
        'SELECT DATEPART(YEAR, "dbo_tblSalesHistory"."OTD_Date") AS "Year", '
        'SUM("dbo_tblSalesHistory"."SalesValue") AS "TotalSalesValue" '
        'FROM "dbo_tblSalesHistory" '
        'GROUP BY DATEPART(YEAR, "dbo_tblSalesHistory"."OTD_Date")'
    )

    normalized = normalize_sql_column_references_to_schema(
        sql,
        {"dbo_tblSalesHistory": ["InvDate", "SalesValue"]},
    )

    assert 'DATEPART(YEAR, "dbo_tblSalesHistory"."InvDate") AS "Year"' in normalized
    assert "OTD_Date" not in normalized
    assert find_invalid_column_references(
        normalized,
        {"dbo_tblSalesHistory": ["InvDate", "SalesValue"]},
    ) == []


def test_normalize_sql_column_references_to_schema_maps_sales_business_aliases():
    sql = (
        'SELECT "dbo_qSales1"."Customer_Region", '
        'SUM("dbo_qSales1"."InvoiceQuantity") AS "InvoiceQuantity" '
        'FROM "dbo_qSales1" '
        'GROUP BY "dbo_qSales1"."Customer_Region"'
    )

    normalized = normalize_sql_column_references_to_schema(
        sql,
        {"dbo_qSales1": ["Country", "Market", "Qty"]},
    )

    assert '"dbo_qSales1"."Country"' in normalized
    assert '"dbo_qSales1"."Qty"' in normalized
    assert "Customer_Region" not in normalized
    assert "InvoiceQuantity" not in normalized
    assert find_invalid_column_references(
        normalized,
        {"dbo_qSales1": ["Country", "Market", "Qty"]},
    ) == []


def test_normalize_sql_column_references_to_schema_maps_debug_business_aliases():
    sql = (
        'SELECT COUNT("FixLogId") AS "FixLogCount" '
        'FROM "dbo_DebugEntries"'
    )

    normalized = normalize_sql_column_references_to_schema(
        sql,
        {"dbo_DebugEntries": ["DebugEntryId", "FixId"]},
    )

    assert 'COUNT("DebugEntryId") AS "FixLogCount"' in normalized
    assert "FixLogId" not in normalized
    assert find_invalid_column_references(
        normalized,
        {"dbo_DebugEntries": ["DebugEntryId", "FixId"]},
    ) == []


def test_normalize_sql_column_references_to_schema_keeps_unknown_columns_invalid():
    sql = 'SELECT "dbo_qSales1"."UnitPrice" FROM "dbo_qSales1"'
    normalized = normalize_sql_column_references_to_schema(
        sql,
        {"dbo_qSales1": ["SalesValue", "Cost"]},
    )

    assert normalized == sql
    assert find_invalid_column_references(
        normalized,
        {"dbo_qSales1": ["SalesValue", "Cost"]},
    ) == ["dbo_qSales1.UnitPrice"]


def test_normalize_sql_column_references_to_schema_maps_kb_article_aliases():
    sql = (
        'SELECT "dbo_kb_articles"."article_type", COUNT(*) AS "RecordCount" '
        'FROM "dbo_kb_articles" '
        'GROUP BY "dbo_kb_articles"."article_type"'
    )

    normalized = normalize_sql_column_references_to_schema(
        sql,
        {"dbo_kb_articles": ["id", "category", "source_ticket_id"]},
    )

    assert '"dbo_kb_articles"."category"' in normalized
    assert "article_type" not in normalized
    assert find_invalid_column_references(
        normalized,
        {"dbo_kb_articles": ["id", "category", "source_ticket_id"]},
    ) == []


def test_normalize_sql_column_references_to_schema_maps_unqualified_source():
    sql = (
        'SELECT source, COUNT(*) AS "RecordCount" '
        'FROM "dbo_kb_articles" '
        'GROUP BY source '
        'ORDER BY COUNT(*) DESC'
    )

    normalized = normalize_sql_column_references_to_schema(
        sql,
        {"dbo_kb_articles": ["id", "category", "source_ticket_id"]},
    )

    assert '"source_ticket_id"' in normalized
    assert " source" not in normalized
    assert "GROUP BY source" not in normalized


def test_normalize_sql_column_references_to_schema_maps_unqualified_article_id():
    sql = (
        'SELECT COUNT(article_id) AS "article_count" '
        'FROM "dbo_knowledge_articles"'
    )

    normalized = normalize_sql_column_references_to_schema(
        sql,
        {
            "dbo_knowledge_articles": [
                "id",
                "org_id",
                "title",
                "category",
                "subcategory",
                "content",
                "author",
                "tags",
                "views",
                "helpful",
                "data",
                "created_at",
                "updated_at",
            ]
        },
    )

    assert 'COUNT("id") AS "article_count"' in normalized
    assert "article_id" not in normalized
    assert find_invalid_column_references(
        normalized,
        {"dbo_knowledge_articles": ["id", "org_id", "title"]},
    ) == []


def test_sql_generation_system_prompt_rejects_stale_sales_sample_schema():
    prompt = get_sql_generation_system_prompt()

    assert "SQL SAMPLES are examples of style only" in prompt
    assert "sales performance" in prompt
    assert "Do not SUM or AVG string columns" in prompt


def test_extract_sql_generation_result_from_json_payload():
    result = '{"sql": "SELECT COUNT(*) AS repair_count FROM repairs;"}'

    assert (
        extract_sql_generation_result(result)
        == "SELECT COUNT(*) AS repair_count FROM repairs"
    )


def test_extract_sql_generation_result_from_prose_wrapped_sql():
    result = (
        "The SQL query is: SELECT DATEPART(YEAR, created_at) AS year, "
        "COUNT(*) AS repair_count FROM repairs GROUP BY DATEPART(YEAR, created_at);"
    )

    assert extract_sql_generation_result(result) == (
        "SELECT DATEPART(YEAR, created_at) AS year, COUNT(*) AS repair_count "
        "FROM repairs GROUP BY DATEPART(YEAR, created_at)"
    )


def test_extract_sql_generation_result_from_fenced_sql():
    result = """
    Here is the query:
    ```sql
    SELECT id FROM repairs;
    ```
    """

    assert extract_sql_generation_result(result) == "SELECT id FROM repairs"


def test_extract_sql_generation_result_from_prose_wrapped_json():
    result = 'Here is the result:\n{"sql": "SELECT id FROM repairs;"}'

    assert extract_sql_generation_result(result) == "SELECT id FROM repairs"


def test_get_text_to_sql_rules_adds_mssql_specific_constraints():
    rules = get_text_to_sql_rules(data_source="MSSQL")

    assert "The target database is MSSQL." in rules
    assert "DATEPART(YEAR, <timestamp_expression>)" in rules
    assert "DATEADD, DATEDIFF, DATETIME2, or DATETIMEOFFSET" in rules
    assert "TO_UNIXTIME" in rules
    assert "Do not subtract timestamp/date columns directly" in rules
    assert "TO_TIMESTAMP_MILLIS" in rules
    assert "DO NOT use PostgreSQL-style or Trino-style date syntax" in rules
    assert "DO NOT use JSON extraction functions or operators" in rules
    assert "JSON_VALUE" in rules
    assert "JSON_EXTRACT" in rules
    assert "->>" in rules
    assert "do not assume keys inside it are queryable" in rules
    assert "Never invent JSON-derived columns" in rules
    assert "Resolve relative time phrases" in rules
    assert "Do not include helper ranking columns" in rules
    assert "prefer SELECT TOP (N)" in rules
    assert "connected datasource metadata" in rules
    assert '"dbo_DebugFixes"."Description"' in rules
    assert '"dbo_DebugFixLogs"."FixId"' in rules
    assert "repair SLA compliance" in rules
    assert '"dbo_repair_logs"."status"' in rules
    assert "FailurePatternID" in rules
    assert "failure_code" in rules
    assert "CURRENT_DATE - INTERVAL '1 month'" not in rules


def test_get_json_field_instructions_for_mssql_disables_json_extraction():
    instructions = get_json_field_instructions(data_source="MSSQL")

    assert "cannot execute JSON extraction" in instructions
    assert "JSON_VALUE" in instructions
    assert "->>" in instructions
    assert "Use only first-class columns" in instructions
    assert "LAX_STRING(JSON_QUERY" not in instructions


def test_contains_unsupported_mssql_json_access_detects_json_syntax():
    assert contains_unsupported_mssql_json_access(
        'SELECT "data" ->> \'AttemptNumber\' FROM "dbo_repair_logs"'
    )
    assert contains_unsupported_mssql_json_access(
        'SELECT JSON_VALUE("data", \'$.AttemptNumber\') FROM "dbo_repair_logs"'
    )
    assert not contains_unsupported_mssql_json_access(
        'SELECT "created_at", "status" FROM "dbo_repair_logs"'
    )


def test_get_metric_instructions_for_mssql_avoids_date_trunc_example():
    instructions = get_metric_instructions(data_source="MSSQL")

    assert "DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')" not in instructions
    assert "Do not use DATE_TRUNC, DATETRUNC, DATEADD, DATEDIFF, INTERVAL, CURRENT_DATE, or TIMESTAMP WITH TIME ZONE" in instructions
    assert "DATEPART(YEAR, <timestamp_expression>)" in instructions


def test_get_sql_generation_system_prompt_uses_data_source_specific_rules():
    prompt = get_sql_generation_system_prompt(data_source="MSSQL")

    assert "The target database is MSSQL." in prompt
    assert "DATEPART(YEAR, <timestamp_expression>)" in prompt
    assert "deployed semantic model definitions" in prompt
    assert '"dbo_DebugFixes"."Description"' in prompt
    assert "repair SLA compliance" in prompt


def test_normalize_generation_result_sql_rewrites_common_mssql_time_patterns():
    sql = """
    SELECT
      DATEPART(YEAR, "created_at") AS "year",
      DATEPART(MONTH, "created_at") AS "month",
      COUNT("id") AS "repair_count"
    FROM "dbo_repair_logs"
    GROUP BY DATEPART(YEAR, "created_at"), DATEPART(MONTH, "created_at")
    ORDER BY "year" ASC NULLS LAST, "month" ASC NULLS LAST
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert 'DATEPART(\'YEAR\', "created_at")' not in normalized
    assert 'DATEPART(\'MONTH\', "created_at")' not in normalized
    assert "NULLS LAST" not in normalized
    assert 'DATEPART(YEAR, "created_at")' in normalized
    assert 'DATEPART(MONTH, "created_at")' in normalized


def test_normalize_generation_result_sql_rewrites_cwsales_otd_date_for_mssql():
    sql = (
        'SELECT DATEPART(YEAR, "dbo_tblSalesHistory"."OTD_Date") AS "Year", '
        'SUM("dbo_tblSalesHistory"."SalesValue") AS "TotalSalesValue" '
        'FROM "dbo_tblSalesHistory" '
        'GROUP BY DATEPART(YEAR, "dbo_tblSalesHistory"."OTD_Date")'
    )

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "OTD_Date" not in normalized
    assert 'DATEPART(YEAR, "dbo_tblSalesHistory"."InvDate") AS "Year"' in normalized
    assert 'GROUP BY DATEPART(YEAR, "dbo_tblSalesHistory"."InvDate")' in normalized


def test_normalize_generation_result_sql_rewrites_cwsales_fix_log_id_for_mssql():
    sql = (
        'SELECT COUNT("dbo_qSales1"."FixLogId") AS "NumberOfInvoices" '
        'FROM "dbo_qSales1"'
    )

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "FixLogId" not in normalized
    assert 'COUNT("dbo_qSales1"."InvoiceNo") AS "NumberOfInvoices"' in normalized


def test_normalize_generation_result_sql_rewrites_common_mssql_dateadd_patterns():
    sql = """
    SELECT
      DATEADD(month, DATEDIFF(month, 0, "created_at"), 0) AS "month_start",
      COUNT("id") AS "repair_count"
    FROM "dbo_repair_logs"
    WHERE "created_at" >= DATEADD(month, -12, GETDATE())
      AND "created_at" < DATEADD(month, DATEDIFF(month, 0, GETDATE()), 0)
    GROUP BY DATEADD(month, DATEDIFF(month, 0, "created_at"), 0)
    ORDER BY "month_start" ASC NULLS LAST
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "DATEADD(" not in normalized
    assert "DATEDIFF(" not in normalized
    assert "NULLS LAST" not in normalized
    assert 'DATEPART(YEAR, "created_at")' in normalized
    assert 'DATEPART(MONTH, "created_at")' in normalized


def test_normalize_data_source_maps_sql_server_aliases_to_mssql():
    assert normalize_data_source("sqlserver") == "MSSQL"
    assert normalize_data_source("SQL Server") == "MSSQL"


def test_normalize_generation_result_sql_rewrites_nested_temporal_patterns_for_mssql():
    sql = """
    SELECT
      DATE_PART('YEAR', CAST("created_at" AS DATETIME)) AS "year",
      DATE_TRUNC('MONTH', CAST("created_at" AS DATETIME)) AS "month_bucket",
      EXTRACT(DAY FROM CAST("created_at" AS DATETIME)) AS "day_of_month"
    FROM "dbo_repair_logs"
    ORDER BY "month_bucket" ASC NULLS LAST
    """

    normalized = normalize_generation_result_sql(sql, data_source="sqlserver")

    assert "DATE_PART(" not in normalized
    assert "DATE_TRUNC(" not in normalized
    assert "EXTRACT(" not in normalized
    assert "NULLS LAST" not in normalized
    assert 'DATEPART(YEAR, CAST("created_at" AS DATETIME))' in normalized
    assert 'DATEPART(MONTH, CAST("created_at" AS DATETIME))' in normalized
    assert 'DATEPART(DAY, CAST("created_at" AS DATETIME))' in normalized


def test_normalize_generation_result_sql_rewrites_to_timestamp_for_mssql():
    sql = """
    SELECT
      DATEPART(YEAR, TO_TIMESTAMP("created_at")) AS "year",
      COUNT("id") AS "repair_count"
    FROM "dbo_repair_logs"
    GROUP BY DATEPART(YEAR, TO_TIMESTAMP("created_at"))
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "TO_TIMESTAMP(" not in normalized
    assert 'DATEPART(YEAR, CAST("created_at" AS DATETIME))' in normalized


def test_normalize_generation_result_sql_rewrites_to_timestamp_variants_for_mssql():
    sql = """
    SELECT
      TO_TIMESTAMP_MILLIS("created_at_ms") AS "created_at",
      TO_TIMESTAMP_SECONDS("closed_at_sec") AS "closed_at"
    FROM "dbo_repair_logs"
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "TO_TIMESTAMP_MILLIS(" not in normalized
    assert "TO_TIMESTAMP_SECONDS(" not in normalized
    assert 'CAST("created_at_ms" AS DATETIME)' in normalized
    assert 'CAST("closed_at_sec" AS DATETIME)' in normalized


def test_normalize_generation_result_sql_rewrites_mssql_datepart_alias_references():
    sql = """
    SELECT
      DATEPART(YEAR, "created_at") AS "YEAR",
      DATEPART(MONTH, "created_at") AS "MONTH",
      COUNT("id") AS "repair_count"
    FROM "dbo_repair_logs"
    GROUP BY "YEAR", "MONTH"
    ORDER BY "YEAR" ASC, "MONTH" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert 'GROUP BY "YEAR"' not in normalized
    assert 'ORDER BY "YEAR"' not in normalized
    assert 'DATEPART(YEAR, "created_at") AS "YEAR"' in normalized
    assert (
        'GROUP BY DATEPART(YEAR, "created_at"), DATEPART(MONTH, "created_at")'
        in normalized
    )
    assert (
        'ORDER BY DATEPART(YEAR, "created_at") ASC, DATEPART(MONTH, "created_at") ASC'
        in normalized
    )


def test_normalize_generation_result_sql_rewrites_unquoted_mssql_datepart_alias_references():
    sql = """
    SELECT
      DATEPART(YEAR, "created_at") AS YEAR,
      DATEPART(MONTH, "created_at") AS MONTH,
      COUNT("id") AS "repair_count"
    FROM "dbo_repair_logs"
    GROUP BY YEAR, MONTH
    ORDER BY YEAR ASC, MONTH ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "GROUP BY YEAR" not in normalized
    assert "ORDER BY YEAR" not in normalized
    assert 'DATEPART(YEAR, "created_at") AS YEAR' in normalized
    assert (
        'GROUP BY DATEPART(YEAR, "created_at"), DATEPART(MONTH, "created_at")'
        in normalized
    )
    assert (
        'ORDER BY DATEPART(YEAR, "created_at") ASC, DATEPART(MONTH, "created_at") ASC'
        in normalized
    )


def test_normalize_generation_result_sql_rewrites_invented_repair_date_for_mssql():
    sql = """
    SELECT
      DATEPART(YEAR, "RepairDate") AS "YEAR",
      DATEPART(MONTH, "RepairDate") AS "MONTH",
      COUNT("dbo_repair_logs"."id") AS "repair_count"
    FROM "dbo_repair_logs"
    GROUP BY DATEPART(YEAR, "RepairDate"), DATEPART(MONTH, "RepairDate")
    ORDER BY "YEAR" ASC, "MONTH" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert '"RepairDate"' not in normalized
    assert 'DATEPART(YEAR, "dbo_repair_logs"."created_at") AS "YEAR"' in normalized
    assert 'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "MONTH"' in normalized
    assert (
        'GROUP BY DATEPART(YEAR, "dbo_repair_logs"."created_at"), '
        'DATEPART(MONTH, "dbo_repair_logs"."created_at")'
        in normalized
    )
    assert (
        'ORDER BY DATEPART(YEAR, "dbo_repair_logs"."created_at") ASC, '
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") ASC'
        in normalized
    )


def test_normalize_generation_result_sql_rewrites_qualified_invented_repair_date_for_mssql():
    sql = """
    SELECT
      DATEPART(YEAR, "dbo_repair_logs"."RepairDate") AS "YEAR",
      DATEPART(MONTH, "dbo_repair_logs"."RepairDate") AS "MONTH",
      COUNT("dbo_repair_logs"."id") AS "repair_count"
    FROM "dbo_repair_logs"
    GROUP BY DATEPART(YEAR, "dbo_repair_logs"."RepairDate"),
      DATEPART(MONTH, "dbo_repair_logs"."RepairDate")
    ORDER BY "YEAR" ASC, "MONTH" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "RepairDate" not in normalized
    assert 'DATEPART(YEAR, "dbo_repair_logs"."created_at") AS "YEAR"' in normalized
    assert 'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "MONTH"' in normalized


def test_normalize_generation_result_sql_rewrites_invented_repair_failure_pattern_id_for_mssql():
    sql = """
    SELECT
      "dbo_failure_patterns"."category" AS "failure_category",
      COUNT("dbo_repair_logs"."id") AS "repair_count"
    FROM "dbo_repair_logs"
    JOIN "dbo_failure_patterns"
      ON "dbo_repair_logs"."FailurePatternID" = "dbo_failure_patterns"."id"
    GROUP BY "dbo_failure_patterns"."category"
    ORDER BY "repair_count" DESC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "FailurePatternID" not in normalized
    assert (
        '"dbo_repair_logs"."failure_code" = "dbo_failure_patterns"."id"'
        in normalized
    )


def test_normalize_generation_result_sql_rewrites_debug_entry_failure_pattern_join_for_mssql():
    sql = """
    SELECT TOP 10
      "dbo_failure_patterns"."category" AS "FailureCategory",
      COUNT_BIG(1) AS "FailureCount"
    FROM "dbo_DebugEntries"
    INNER JOIN "dbo_failure_patterns"
      ON "dbo_DebugEntries"."DebugEntryId" = "dbo_failure_patterns"."id"
    GROUP BY "dbo_failure_patterns"."category"
    ORDER BY "FailureCount" DESC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert '"dbo_DebugEntries"."DebugEntryId" = "dbo_failure_patterns"."id"' not in normalized
    assert (
        '"dbo_DebugEntries"."FailureSys" = "dbo_failure_patterns"."id"'
        in normalized
    )


def test_normalize_generation_result_sql_rewrites_pcb_throughput_repair_log_fields_for_mssql():
    sql = """
    SELECT
      "dbo_repair_logs"."ManufacturingUnit" AS "manufacturing_unit",
      "dbo_repair_logs"."MONTH",
      COUNT("dbo_repair_logs"."id") AS "throughput"
    FROM "dbo_repair_logs"
    GROUP BY "dbo_repair_logs"."ManufacturingUnit", "dbo_repair_logs"."MONTH"
    ORDER BY "dbo_repair_logs"."MONTH" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "dbo_repair_logs" not in normalized
    assert "ManufacturingUnit" not in normalized
    assert '"dbo_DebugEntries"."BusinessUnit" AS "manufacturing_unit"' in normalized
    assert '"dbo_DebugEntries"."DebugEntryId"' in normalized
    assert 'DATEPART(MONTH, "dbo_DebugEntries"."DateIn") AS "month"' in normalized
    assert 'GROUP BY "dbo_DebugEntries"."BusinessUnit"' in normalized
    assert 'ORDER BY DATEPART(MONTH, "dbo_DebugEntries"."DateIn") ASC' in normalized


def test_normalize_generation_result_sql_rewrites_repair_log_turnaround_throughput_shape_for_mssql():
    sql = """
    SELECT
      board_model AS unit_name,
      COUNT(*) AS repair_count,
      AVG((DATEPART(DAY, updated_at) - DATEPART(DAY, created_at))) AS avg_turnaround_time
    FROM dbo_repair_logs
    GROUP BY board_model
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "DATEPART(DAY" not in normalized
    assert "avg_turnaround_time" not in normalized
    assert "dbo_repair_logs" not in normalized
    assert (
        'SELECT "dbo_DebugEntries"."BusinessUnit" AS "unit_name", '
        'COUNT("dbo_DebugEntries"."DebugEntryId") AS "throughput"'
        in normalized
    )
    assert 'FROM "dbo_DebugEntries"' in normalized


def test_normalize_generation_result_sql_rewrites_repair_log_turnaround_month_trend_shape_for_mssql():
    sql = """
    SELECT
      MONTH,
      AVG(avg_turnaround_time) AS avg_turnaround_time
    FROM dbo_repair_logs
    GROUP BY MONTH
    ORDER BY MONTH ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "avg_turnaround_time" not in normalized
    assert "GROUP BY MONTH" not in normalized
    assert 'DATEPART(YEAR, "dbo_repair_logs"."created_at") AS "year"' in normalized
    assert 'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "month"' in normalized
    assert (
        'AVG(DATEDIFF(\'second\', "dbo_repair_logs"."created_at", '
        '"dbo_repair_logs"."updated_at")) AS "avg_turnaround_seconds"'
        in normalized
    )


def test_normalize_generation_result_sql_rewrites_bare_month_field_for_mssql():
    sql = """
    SELECT
      "MONTH",
      COUNT("dbo_repair_logs"."id") AS "repair_count"
    FROM "dbo_repair_logs"
    WHERE "dbo_repair_logs"."created_at" >= '2025-05-01 00:00:00'
    GROUP BY "MONTH"
    ORDER BY "MONTH" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert 'SELECT "MONTH"' not in normalized
    assert 'GROUP BY "MONTH"' not in normalized
    assert 'ORDER BY "MONTH"' not in normalized
    assert (
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "month"'
        in normalized
    )
    assert 'GROUP BY DATEPART(MONTH, "dbo_repair_logs"."created_at")' in normalized
    assert 'ORDER BY DATEPART(MONTH, "dbo_repair_logs"."created_at") ASC' in normalized


def test_normalize_generation_result_sql_rewrites_qualified_month_field_for_mssql():
    sql = """
    SELECT
      "dbo_repair_logs"."MONTH",
      COUNT("dbo_repair_logs"."id") AS "repair_count"
    FROM "dbo_repair_logs"
    GROUP BY "dbo_repair_logs"."MONTH"
    ORDER BY "dbo_repair_logs"."MONTH" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert '"dbo_repair_logs"."MONTH"' not in normalized
    assert (
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "month"'
        in normalized
    )
    assert 'GROUP BY DATEPART(MONTH, "dbo_repair_logs"."created_at")' in normalized
    assert 'ORDER BY DATEPART(MONTH, "dbo_repair_logs"."created_at") ASC' in normalized


def test_normalize_generation_result_sql_rewrites_unquoted_qualified_month_field_for_mssql():
    sql = """
    SELECT
      dbo_repair_logs.MONTH,
      COUNT(dbo_repair_logs.id) AS "repair_count"
    FROM dbo_repair_logs
    GROUP BY dbo_repair_logs.MONTH
    ORDER BY dbo_repair_logs.MONTH ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "dbo_repair_logs.MONTH" not in normalized
    assert (
        'DATEPART(MONTH, dbo_repair_logs."created_at") AS "month"'
        in normalized
    )
    assert 'GROUP BY DATEPART(MONTH, dbo_repair_logs."created_at")' in normalized
    assert 'ORDER BY DATEPART(MONTH, dbo_repair_logs."created_at") ASC' in normalized


def test_normalize_generation_result_sql_rewrites_bare_unquoted_month_field_for_mssql():
    sql = """
    SELECT
      MONTH,
      COUNT(*) AS repair_volume
    FROM dbo_repair_logs
    GROUP BY MONTH
    ORDER BY MONTH ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "SELECT MONTH" not in normalized
    assert "GROUP BY MONTH" not in normalized
    assert "ORDER BY MONTH" not in normalized
    assert (
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "month"'
        in normalized
    )
    assert 'GROUP BY DATEPART(MONTH, "dbo_repair_logs"."created_at")' in normalized
    assert 'ORDER BY DATEPART(MONTH, "dbo_repair_logs"."created_at") ASC' in normalized


def test_normalize_generation_result_sql_rewrites_bare_month_field_for_local_file():
    sql = """
    SELECT
      MONTH,
      COUNT(*) AS repair_volume
    FROM dbo_repair_logs
    GROUP BY MONTH
    ORDER BY MONTH ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="local_file")

    assert "SELECT MONTH" not in normalized
    assert "GROUP BY MONTH" not in normalized
    assert "ORDER BY MONTH" not in normalized
    assert (
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "month"'
        in normalized
    )
    assert 'GROUP BY DATEPART(MONTH, "dbo_repair_logs"."created_at")' in normalized
    assert 'ORDER BY DATEPART(MONTH, "dbo_repair_logs"."created_at") ASC' in normalized


def test_normalize_generation_result_sql_rewrites_bare_month_field_for_sqlite():
    sql = """
    SELECT
      "MONTH",
      COUNT("dbo_repair_logs"."id") AS "repair_count"
    FROM "dbo_repair_logs"
    GROUP BY "MONTH"
    ORDER BY "MONTH" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="sqlite")

    assert 'SELECT "MONTH"' not in normalized
    assert 'GROUP BY "MONTH"' not in normalized
    assert 'ORDER BY "MONTH"' not in normalized
    assert (
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "month"'
        in normalized
    )


def test_normalize_generation_result_sql_rewrites_bare_year_for_report_charts():
    sql = """
    SELECT
      "YEAR",
      COUNT("dbo_reports"."id") AS "report_count"
    FROM "dbo_reports"
    GROUP BY "YEAR"
    ORDER BY "YEAR" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert 'SELECT "YEAR"' not in normalized
    assert 'GROUP BY "YEAR"' not in normalized
    assert 'ORDER BY "YEAR"' not in normalized
    assert 'DATEPART(YEAR, "dbo_reports"."generated_at") AS "year"' in normalized
    assert 'GROUP BY DATEPART(YEAR, "dbo_reports"."generated_at")' in normalized
    assert 'ORDER BY DATEPART(YEAR, "dbo_reports"."generated_at") ASC' in normalized


def test_normalize_generation_result_sql_rewrites_timestamp_casts_for_mssql():
    sql = """
    SELECT COUNT("id")
    FROM "dbo_repair_logs"
    WHERE CAST("created_at" AS TIMESTAMP) >= CAST('2026-01-01 00:00:00' AS TIMESTAMP)
    """

    normalized = normalize_generation_result_sql(sql, data_source="sqlserver")

    assert " AS TIMESTAMP" not in normalized
    assert 'CAST("created_at" AS DATETIME)' in normalized
    assert "CAST('2026-01-01 00:00:00' AS DATETIME)" in normalized


def test_normalize_generation_result_sql_rewrites_to_date_bucket_for_mssql():
    sql = """
    SELECT
      TO_DATE(DateIn, 'YYYY-MM-DD') EntryDate,
      COUNT(*) Throughput
    FROM dbo_DebugEntries
    GROUP BY EntryDate
    ORDER BY EntryDate ASC NULLS LAST
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "TO_DATE(" not in normalized
    assert "NULLS LAST" not in normalized
    assert "GROUP BY EntryDate" not in normalized
    assert "ORDER BY EntryDate" not in normalized
    assert 'DATEPART(YEAR, "dbo_DebugEntries"."DateIn")' in normalized
    assert 'DATEPART(MONTH, "dbo_DebugEntries"."DateIn")' in normalized
    assert 'DATEPART(DAY, "dbo_DebugEntries"."DateIn")' in normalized


def test_normalize_generation_result_sql_rewrites_date_function_for_mssql():
    sql = """
    SELECT
      DATE(DateIn) AS EntryDate,
      COUNT(*) AS Throughput
    FROM dbo_DebugEntries
    GROUP BY EntryDate
    ORDER BY EntryDate ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "DATE(DateIn)" not in normalized
    assert "GROUP BY EntryDate" not in normalized
    assert 'DATEPART(DAY, "dbo_DebugEntries"."DateIn")' in normalized


def test_normalize_generation_result_sql_rewrites_date_sub_for_mssql():
    sql = """
    SELECT
      DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "MONTH",
      COUNT(*) AS "repair_volume"
    FROM "dbo_repair_logs"
    WHERE "dbo_repair_logs"."created_at" >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
    GROUP BY DATEPART(MONTH, "dbo_repair_logs"."created_at")
    ORDER BY "MONTH" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "DATE_SUB(" not in normalized
    assert "CURRENT_DATE" not in normalized
    assert 'DATEPART(MONTH, "dbo_repair_logs"."created_at")' in normalized


def test_normalize_generation_result_sql_rewrites_repair_log_failure_category_for_mssql():
    sql = """
    SELECT
      failure_category,
      COUNT(*) AS repair_count
    FROM dbo_repair_logs
    GROUP BY failure_category
    ORDER BY repair_count DESC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "failure_category," not in normalized
    assert "GROUP BY failure_category" not in normalized
    assert '"dbo_repair_logs"."failure_code" AS "failure_category"' in normalized
    assert 'GROUP BY "dbo_repair_logs"."failure_code"' in normalized


def test_normalize_generation_result_sql_rewrites_report_hallucinated_fields_for_mssql():
    sql = """
    SELECT
      COUNT(*) total_reports,
      SUM(CASE WHEN (filters LIKE '%raw%data%file%') THEN 1 ELSE 0 END) raw_data_files_included,
      AVG((CASE WHEN (filters LIKE '%raw%data%file%') THEN file_size ELSE null END)) avg_file_size_with_raw_data
    FROM dbo_reports
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "filters" not in normalized
    assert "THEN file_size" not in normalized
    assert '"dbo_reports"."data" LIKE' in normalized
    assert '"dbo_reports"."size_bytes"' in normalized


def test_normalize_generation_result_sql_rewrites_ticket_token_cost_for_mssql():
    sql = """
    SELECT
      "status",
      AVG(token_cost) average_token_cost
    FROM "dbo_tickets"
    GROUP BY "status"
    ORDER BY average_token_cost DESC NULLS LAST
    LIMIT 1
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "token_cost" not in normalized
    assert 'SELECT "dbo_tickets"."status" AS "status"' in normalized
    assert 'COUNT("dbo_tickets"."id") AS "ticket_count"' in normalized
    assert 'FROM "dbo_tickets"' in normalized
    assert 'GROUP BY "dbo_tickets"."status"' in normalized


def test_normalize_generation_result_sql_strips_to_unixtime_for_mssql():
    sql = """
    SELECT
      TO_UNIXTIME(CAST("created_at" AS TIMESTAMP)) AS "created_at_unix",
      AVG("repair_cost") AS "avg_repair_cost"
    FROM "dbo_repair_logs"
    GROUP BY TO_UNIXTIME(CAST("created_at" AS TIMESTAMP))
    ORDER BY "created_at_unix" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "TO_UNIXTIME(" not in normalized
    assert 'CAST("created_at" AS DATETIME) AS "created_at_unix"' in normalized
    assert 'GROUP BY CAST("created_at" AS DATETIME)' in normalized


def test_normalize_generation_result_sql_rewrites_timestamp_subtraction_for_mssql():
    sql = """
    SELECT
      "updated_at" - "created_at" AS "turnaround_seconds",
      "repair_cost"
    FROM "dbo_repair_logs"
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert '"updated_at" - "created_at"' not in normalized
    assert (
        'DATEDIFF(\'second\', "created_at", "updated_at") AS "turnaround_seconds"'
        in normalized
    )

def test_normalize_generation_result_sql_rewrites_mssql_time_buckets_and_ordering():
    sql = """
    SELECT
      YEAR,
      MONTH,
      COUNT(*) AS repair_count
    FROM dbo_repair_logs
    GROUP BY YEAR, MONTH
    ORDER BY YEAR ASC NULLS LAST, MONTH ASC NULLS LAST
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "NULLS LAST" not in normalized
    assert "SELECT YEAR" not in normalized
    assert "GROUP BY YEAR" not in normalized
    assert "ORDER BY YEAR" not in normalized
    assert (
        'DATEPART(YEAR, "dbo_repair_logs"."created_at") AS "year"'
        in normalized
    )
    assert (
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "month"'
        in normalized
    )
    assert 'GROUP BY DATEPART(YEAR, "dbo_repair_logs"."created_at")' in normalized
    assert 'ORDER BY DATEPART(YEAR, "dbo_repair_logs"."created_at") ASC' in normalized


def test_normalize_generation_result_sql_rewrites_aliased_mssql_time_buckets():
    sql = """
    SELECT
      YEAR AS year,
      MONTH AS month,
      COUNT(*) AS repair_count
    FROM dbo_repair_logs
    GROUP BY YEAR, MONTH
    ORDER BY YEAR ASC, MONTH ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "YEAR AS year" not in normalized
    assert "MONTH AS month" not in normalized
    assert (
        'DATEPART(YEAR, "dbo_repair_logs"."created_at") AS year'
        in normalized
    )
    assert (
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS month'
        in normalized
    )
    assert 'GROUP BY DATEPART(YEAR, "dbo_repair_logs"."created_at")' in normalized
    assert 'ORDER BY DATEPART(YEAR, "dbo_repair_logs"."created_at") ASC' in normalized


def test_normalize_generation_result_sql_rewrites_debug_entry_quoted_year_alias():
    sql = """
    SELECT
      "YEAR" AS "YEAR",
      "dbo_DebugEntries"."BusinessUnit" AS "manufacturing_unit",
      COUNT("dbo_DebugEntries"."DebugEntryId") AS "throughput"
    FROM "dbo_DebugEntries"
    GROUP BY "YEAR", "dbo_DebugEntries"."BusinessUnit"
    ORDER BY "YEAR" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert '"YEAR" AS "YEAR"' not in normalized
    assert 'GROUP BY "YEAR"' not in normalized
    assert 'ORDER BY "YEAR"' not in normalized
    assert 'DATEPART(YEAR, "dbo_DebugEntries"."DateIn") AS "YEAR"' in normalized
    assert 'GROUP BY DATEPART(YEAR, "dbo_DebugEntries"."DateIn")' in normalized
    assert 'ORDER BY DATEPART(YEAR, "dbo_DebugEntries"."DateIn") ASC' in normalized


def test_normalize_generation_result_sql_rewrites_mssql_limit_and_where_parentheses():
    sql = """
    SELECT model_id, COUNT(*) AS ticket_count
    FROM dbo_tickets
    WHERE (source = 'AI')
    GROUP BY model_id
    ORDER BY ticket_count DESC NULLS LAST
    LIMIT 1
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert normalized.startswith("SELECT TOP 1")
    assert "WHERE (source = 'AI')" not in normalized
    assert "WHERE source = 'AI'" in normalized
    assert "NULLS LAST" not in normalized
    assert "LIMIT 1" not in normalized


def test_normalize_generation_result_sql_removes_mssql_limit_when_top_exists():
    sql = """
    SELECT TOP 5
      id
    FROM dbo_tickets
    ORDER BY id DESC
    LIMIT 1
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "LIMIT" not in normalized
    assert "SELECT TOP 5 id" in normalized


def test_normalize_generation_result_sql_rewrites_knowledge_article_time_buckets_for_mssql():
    sql = """
    SELECT
      "YEAR",
      COUNT("dbo_knowledge_articles"."id") AS "article_count"
    FROM "dbo_knowledge_articles"
    GROUP BY "YEAR"
    ORDER BY "YEAR" ASC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert 'SELECT "YEAR"' not in normalized
    assert 'GROUP BY "YEAR"' not in normalized
    assert 'ORDER BY "YEAR"' not in normalized
    assert (
        'DATEPART(YEAR, "dbo_knowledge_articles"."created_at") AS "year"'
        in normalized
    )
    assert (
        'GROUP BY DATEPART(YEAR, "dbo_knowledge_articles"."created_at")'
        in normalized
    )


def test_normalize_generation_result_sql_rewrites_knowledge_article_hallucinated_fields_for_mssql():
    sql = """
    SELECT
      AVG("dbo_knowledge_articles"."effectiveness_score") AS "avg_effectiveness",
      "dbo_knowledge_articles"."created_by" AS "created_by"
    FROM "dbo_knowledge_articles"
    GROUP BY "dbo_knowledge_articles"."created_by"
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "effectiveness_score" not in normalized
    assert '"dbo_knowledge_articles"."created_by"' not in normalized
    assert 'AVG("dbo_knowledge_articles"."helpful") AS "avg_effectiveness"' in normalized
    assert '"dbo_knowledge_articles"."author" AS "author"' in normalized
    assert 'GROUP BY "dbo_knowledge_articles"."author"' in normalized


def test_normalize_generation_result_sql_rewrites_knowledge_article_id_for_mssql():
    sql = """
    SELECT
      COUNT("dbo_knowledge_articles"."article_id") AS "article_count"
    FROM "dbo_knowledge_articles"
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "article_id" not in normalized
    assert 'COUNT("dbo_knowledge_articles"."id") AS "article_count"' in normalized


def test_normalize_generation_result_sql_rewrites_article_content_for_mssql():
    sql = """
    SELECT
      LENGTH("dbo_kb_articles"."article_text") AS "article_length"
    FROM "dbo_kb_articles"
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "article_text" not in normalized
    assert 'LENGTH("dbo_kb_articles"."content") AS "article_length"' in normalized


def test_normalize_generation_result_sql_keeps_union_limit_planner_safe_for_mssql():
    sql = """
    SELECT
      LENGTH(article_text) AS article_length
    FROM "dbo_kb_articles"
    UNION ALL SELECT
      LENGTH(article_text) AS article_length
    FROM "dbo_knowledge_articles"
    LIMIT 1
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "LIMIT" not in normalized
    assert "TOP 1" not in normalized
    assert 'LENGTH("content") AS article_length' in normalized
    assert "UNION ALL SELECT" in normalized


def test_normalize_generation_result_sql_rewrites_kb_article_created_by_for_mssql():
    sql = """
    SELECT
      created_by,
      COUNT(*) AS article_count
    FROM dbo_kb_articles
    GROUP BY created_by
    ORDER BY article_count DESC
    """

    normalized = normalize_generation_result_sql(sql, data_source="MSSQL")

    assert "created_by," not in normalized
    assert "GROUP BY created_by" not in normalized
    assert '"created_by_user_id"' in normalized
