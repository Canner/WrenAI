from src.web.v1.services.ask import AskService


def test_build_schema_grounded_sales_sql_for_salesperson_performance():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Create a SalesPerson performance ranking chart",
        [
            """
            CREATE TABLE dbo_tblSales (
              SalesPerson VARCHAR,
              SalesValue DOUBLE,
              CustNo VARCHAR,
              Country VARCHAR,
              "MRO%" DOUBLE
            );
            """
        ],
    )

    assert sql == (
        'SELECT TOP 10 "dbo_tblSales"."SalesPerson" AS "SalesPerson", '
        'SUM("dbo_tblSales"."SalesValue") AS "TotalSalesValue" '
        'FROM "dbo_tblSales" '
        'WHERE "dbo_tblSales"."SalesPerson" IS NOT NULL '
        'GROUP BY "dbo_tblSales"."SalesPerson" '
        'ORDER BY SUM("dbo_tblSales"."SalesValue") DESC'
    )
    assert "MRO" not in sql
    assert "CustID" not in sql


def test_build_schema_grounded_sales_sql_requires_sales_schema():
    service = AskService.__new__(AskService)

    assert (
        service._build_schema_grounded_sales_sql(
            "Create a SalesPerson performance ranking chart",
            ["CREATE TABLE dbo_other (SalesPerson VARCHAR);"],
        )
        is None
    )


def test_build_schema_grounded_sales_sql_for_top_markets():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "What are the Top 10 Markets by New Order Value this year?",
        [
            """
            CREATE TABLE dbo_tblSales (
              Market VARCHAR,
              SalesValue DOUBLE,
              OrdDate TIMESTAMP,
              Division VARCHAR,
              ProdType VARCHAR
            );
            """,
            """
            CREATE TABLE dbo_tblStageNewOrders (
              Market VARCHAR,
              NewOrderValue DOUBLE,
              OrdDate TIMESTAMP
            );
            """,
        ],
    )

    assert sql == (
        'SELECT TOP 10 "dbo_tblSales"."Market" AS "Market", '
        'SUM("dbo_tblSales"."SalesValue") AS "TotalSalesValue" '
        'FROM "dbo_tblSales" '
        'WHERE "dbo_tblSales"."OrdDate" >= \'2026-01-01 00:00:00\' '
        'AND "dbo_tblSales"."OrdDate" < \'2027-01-01 00:00:00\' '
        'GROUP BY "dbo_tblSales"."Market" '
        'ORDER BY SUM("dbo_tblSales"."SalesValue") DESC'
    )
    assert "dbo_tblStageNewOrders" not in sql


def test_build_schema_grounded_sales_sql_for_division_revenue_trend():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Create a Division-wise revenue trend line chart.",
        [
            """
            CREATE TABLE dbo_tblSales (
              Division VARCHAR,
              SalesValue DOUBLE,
              OrdDate TIMESTAMP,
              Market VARCHAR
            );
            """
        ],
    )

    assert sql == (
        'SELECT DATEPART(YEAR, "dbo_tblSales"."OrdDate") AS "year", '
        'DATEPART(MONTH, "dbo_tblSales"."OrdDate") AS "month", '
        '"dbo_tblSales"."Division" AS "Division", '
        'SUM("dbo_tblSales"."SalesValue") AS "TotalSalesValue" '
        'FROM "dbo_tblSales" '
        'GROUP BY DATEPART(YEAR, "dbo_tblSales"."OrdDate"), '
        'DATEPART(MONTH, "dbo_tblSales"."OrdDate"), "dbo_tblSales"."Division" '
        'ORDER BY DATEPART(YEAR, "dbo_tblSales"."OrdDate"), '
        'DATEPART(MONTH, "dbo_tblSales"."OrdDate")'
    )


def test_build_schema_grounded_sales_sql_for_orders_by_dimensions():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Show New Orders by Division, Market, and Product Type.",
        [
            """
            CREATE TABLE dbo_tblSales (
              Division VARCHAR,
              Market VARCHAR,
              ProdType VARCHAR,
              SalesValue DOUBLE,
              OrdDate TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT "dbo_tblSales"."Market" AS "Market", '
        '"dbo_tblSales"."Division" AS "Division", '
        '"dbo_tblSales"."ProdType" AS "ProdType", '
        'SUM("dbo_tblSales"."SalesValue") AS "TotalSalesValue" '
        'FROM "dbo_tblSales" '
        'GROUP BY "dbo_tblSales"."Market", "dbo_tblSales"."Division", '
        '"dbo_tblSales"."ProdType" '
        'ORDER BY SUM("dbo_tblSales"."SalesValue") DESC'
    )


def test_build_schema_grounded_sales_sql_for_top_new_order_detail_rows():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Show the Top 20 New Orders for Period X, including Business Unit, "
        "Market, Customer, Product, and Order Value.",
        [
            """
            CREATE TABLE dbo_tblSales (
              BU VARCHAR,
              Market VARCHAR,
              Customer VARCHAR,
              ProdName VARCHAR,
              SalesValue DOUBLE,
              OrdDate TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT TOP 20 "dbo_tblSales"."BU" AS "BU", '
        '"dbo_tblSales"."Market" AS "Market", '
        '"dbo_tblSales"."ProdName" AS "ProdName", '
        '"dbo_tblSales"."Customer" AS "Customer", '
        '"dbo_tblSales"."SalesValue" AS "SalesValue" '
        'FROM "dbo_tblSales" '
        'ORDER BY "dbo_tblSales"."SalesValue" DESC'
    )


def test_build_schema_grounded_sales_sql_ignores_missing_metadata_entries():
    service = AskService.__new__(AskService)

    assert (
        service._build_schema_grounded_sales_sql(
            "Show the Top 20 New Orders including Market and Customer.",
            [
                None,
                """
                CREATE TABLE dbo_tblSales (
                  Market VARCHAR,
                  Customer VARCHAR,
                  SalesValue DOUBLE
                );
                """,
            ],
        )
        == 'SELECT TOP 20 "dbo_tblSales"."Market" AS "Market", '
        '"dbo_tblSales"."Customer" AS "Customer", '
        '"dbo_tblSales"."SalesValue" AS "SalesValue" '
        'FROM "dbo_tblSales" '
        'ORDER BY "dbo_tblSales"."SalesValue" DESC'
    )


def test_build_schema_grounded_sales_sql_for_order_invoice_conversion_rate():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Show Order-to-Invoice conversion rate by Month.",
        [
            """
            CREATE TABLE dbo_tblSales (
              OrdNo VARCHAR,
              InvoiceNo VARCHAR,
              OrdDate TIMESTAMP,
              SalesValue DOUBLE
            );
            """
        ],
    )

    assert sql == (
        'SELECT DATEPART(YEAR, "dbo_tblSales"."OrdDate") AS "year", '
        'DATEPART(MONTH, "dbo_tblSales"."OrdDate") AS "month", '
        'COUNT(DISTINCT "dbo_tblSales"."OrdNo") AS "OrderCount", '
        'COUNT(DISTINCT "dbo_tblSales"."InvoiceNo") AS "InvoiceCount", '
        '(COUNT(DISTINCT "dbo_tblSales"."InvoiceNo") * 100.0 / '
        'NULLIF(COUNT(DISTINCT "dbo_tblSales"."OrdNo"), 0)) AS "ConversionRate" '
        'FROM "dbo_tblSales" '
        'WHERE "dbo_tblSales"."OrdNo" IS NOT NULL '
        'GROUP BY DATEPART(YEAR, "dbo_tblSales"."OrdDate"), '
        'DATEPART(MONTH, "dbo_tblSales"."OrdDate") '
        'ORDER BY DATEPART(YEAR, "dbo_tblSales"."OrdDate"), '
        'DATEPART(MONTH, "dbo_tblSales"."OrdDate")'
    )
    assert "P-M" not in sql


def test_build_schema_grounded_sales_sql_for_highest_invoice_value():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Which Orders have the highest invoice value for by product and by customer",
        [
            """
            CREATE TABLE dbo_tblSales (
              Customer VARCHAR,
              ProdName VARCHAR,
              SalesValue DOUBLE,
              InvoiceNo VARCHAR
            );
            """
        ],
    )

    assert sql == (
        'SELECT "dbo_tblSales"."ProdName" AS "ProdName", '
        '"dbo_tblSales"."Customer" AS "Customer", '
        'SUM("dbo_tblSales"."SalesValue") AS "TotalSalesValue" '
        'FROM "dbo_tblSales" '
        'GROUP BY "dbo_tblSales"."ProdName", "dbo_tblSales"."Customer" '
        'ORDER BY SUM("dbo_tblSales"."SalesValue") DESC'
    )


def test_build_schema_grounded_sales_sql_for_product_type_contribution():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Create a Product Type contribution pie chart.",
        [
            """
            CREATE TABLE dbo_tblSales (
              ProdType VARCHAR,
              SalesValue DOUBLE
            );
            """
        ],
    )

    assert sql == (
        'SELECT "dbo_tblSales"."ProdType" AS "ProdType", '
        'SUM("dbo_tblSales"."SalesValue") AS "TotalSalesValue" '
        'FROM "dbo_tblSales" '
        'GROUP BY "dbo_tblSales"."ProdType" '
        'ORDER BY SUM("dbo_tblSales"."SalesValue") DESC'
    )


def test_build_schema_grounded_sales_sql_for_yoy_waterfall_dimensions():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Show a waterfall of YOY changes by Customer, Product, and Market.",
        [
            """
            CREATE TABLE dbo_tblSales (
              YearInd INTEGER,
              Customer VARCHAR,
              ProdName VARCHAR,
              Market VARCHAR,
              SalesValue DOUBLE
            );
            """
        ],
    )

    assert sql == (
        'SELECT "dbo_tblSales"."YearInd" AS "year", '
        '"dbo_tblSales"."Customer" AS "Customer", '
        '"dbo_tblSales"."ProdName" AS "ProdName", '
        '"dbo_tblSales"."Market" AS "Market", '
        'SUM("dbo_tblSales"."SalesValue") AS "TotalSalesValue" '
        'FROM "dbo_tblSales" '
        'GROUP BY "dbo_tblSales"."YearInd", "dbo_tblSales"."Customer", '
        '"dbo_tblSales"."ProdName", "dbo_tblSales"."Market" '
        'ORDER BY "dbo_tblSales"."YearInd", SUM("dbo_tblSales"."SalesValue") DESC'
    )


def test_build_schema_grounded_sql_for_ticket_category_request_uses_existing_columns():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Create a bar chart of tickets by category.",
        [
            """
            CREATE TABLE dbo_tickets (
              id VARCHAR,
              org_id VARCHAR,
              title VARCHAR,
              description VARCHAR,
              status VARCHAR,
              priority VARCHAR,
              assignee_user_id VARCHAR,
              created_at TIMESTAMP,
              updated_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT "dbo_tickets"."status" AS "status", '
        'COUNT(*) AS "RecordCount" '
        'FROM "dbo_tickets" '
        'GROUP BY "dbo_tickets"."status" '
        'ORDER BY COUNT(*) DESC'
    )
    assert "category" not in sql


def test_build_explicit_group_count_sql_for_schema_table_column_reference():
    service = AskService.__new__(AskService)
    sql = service._build_explicit_group_count_sql(
        "Show a pie chart grouped by dbo.tickets.status."
    )

    assert sql == (
        'SELECT "dbo_tickets"."status" AS "status", '
        'COUNT(*) AS "RecordCount" '
        'FROM "dbo_tickets" '
        'GROUP BY "dbo_tickets"."status" '
        'ORDER BY COUNT(*) DESC'
    )


def test_build_schema_grounded_sql_for_knowledge_source_request_uses_existing_columns():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Show knowledge article count by source.",
        [
            """
            CREATE TABLE dbo_knowledge_articles (
              id VARCHAR,
              org_id VARCHAR,
              title VARCHAR,
              category VARCHAR,
              subcategory VARCHAR,
              content VARCHAR,
              author VARCHAR,
              tags VARCHAR,
              views INTEGER,
              helpful INTEGER,
              data VARCHAR,
              created_at TIMESTAMP,
              updated_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT "dbo_knowledge_articles"."author" AS "author", '
        'COUNT(*) AS "RecordCount" '
        'FROM "dbo_knowledge_articles" '
        'GROUP BY "dbo_knowledge_articles"."author" '
        'ORDER BY COUNT(*) DESC'
    )
    assert "source" not in sql


def test_build_schema_grounded_sql_for_ticket_throughput_trend():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Show throughput trends across different manufacturing units.",
        [
            """
            CREATE TABLE dbo_tickets (
              id VARCHAR,
              status VARCHAR,
              priority VARCHAR,
              assignee_user_id VARCHAR,
              created_at TIMESTAMP,
              updated_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT DATEPART(YEAR, "dbo_tickets"."created_at") AS "year", '
        'DATEPART(MONTH, "dbo_tickets"."created_at") AS "month", '
        '"dbo_tickets"."assignee_user_id" AS "assignee_user_id", '
        'COUNT(*) AS "RecordCount" '
        'FROM "dbo_tickets" '
        'GROUP BY DATEPART(YEAR, "dbo_tickets"."created_at"), '
        'DATEPART(MONTH, "dbo_tickets"."created_at"), '
        '"dbo_tickets"."assignee_user_id" '
        'ORDER BY DATEPART(YEAR, "dbo_tickets"."created_at"), '
        'DATEPART(MONTH, "dbo_tickets"."created_at")'
    )


def test_build_audit_log_activity_sql_uses_existing_condition_columns():
    service = AskService.__new__(AskService)
    sql = service._build_audit_log_activity_sql(
        "Show audit log activity by condition name over time.",
        [
            """
            CREATE TABLE dbo_audit_log (
              id VARCHAR,
              action VARCHAR,
              actor_name VARCHAR,
              actor_user_id VARCHAR,
              after_state VARCHAR,
              before_state VARCHAR,
              created_at TIMESTAMP,
              entity_type VARCHAR,
              is_name_condition BOOLEAN,
              name VARCHAR
            );
            """
        ],
    )

    assert sql == (
        'SELECT DATEPART(YEAR, "dbo_audit_log"."created_at") AS "year", '
        'DATEPART(MONTH, "dbo_audit_log"."created_at") AS "month", '
        '"dbo_audit_log"."is_name_condition" AS "is_name_condition", '
        'COUNT(*) AS "activity_count" '
        'FROM "dbo_audit_log" '
        'WHERE "dbo_audit_log"."created_at" IS NOT NULL '
        'AND "dbo_audit_log"."is_name_condition" IS NOT NULL '
        'GROUP BY DATEPART(YEAR, "dbo_audit_log"."created_at"), '
        'DATEPART(MONTH, "dbo_audit_log"."created_at"), '
        '"dbo_audit_log"."is_name_condition" '
        'ORDER BY DATEPART(YEAR, "dbo_audit_log"."created_at"), '
        'DATEPART(MONTH, "dbo_audit_log"."created_at"), '
        '"activity_count" DESC'
    )
    assert "condition_name" not in sql
    assert "timestamp" not in sql
