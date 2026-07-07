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


def test_build_direct_orders_sales_sql_for_salesperson_order_count():
    service = AskService.__new__(AskService)
    sql = service._build_direct_orders_sales_sql(
        "Create a bar chart of top 10 SalesPerson by order count"
    )

    assert sql == (
        'SELECT TOP 10 "dbo_tblSales"."SalesPerson" AS "SalesPerson", '
        'COUNT(*) AS "OrderCount" '
        'FROM "dbo_tblSales" '
        'WHERE "dbo_tblSales"."SalesPerson" IS NOT NULL '
        'GROUP BY "dbo_tblSales"."SalesPerson" '
        'ORDER BY COUNT(*) DESC'
    )


def test_build_direct_orders_sales_sql_for_top_new_orders_q1():
    service = AskService.__new__(AskService)
    sql = service._build_direct_orders_sales_sql(
        "Show the top 20 new orders for period 2026-Q1"
    )

    assert sql == (
        'SELECT TOP 20 "dbo_tblSales"."BU" AS "BU", '
        '"dbo_tblSales"."Market" AS "Market", '
        '"dbo_tblSales"."Customer" AS "Customer", '
        '"dbo_tblSales"."ProdName" AS "ProdName", '
        '"dbo_tblSales"."SalesValue" AS "SalesValue" '
        'FROM "dbo_tblSales" '
        'WHERE "dbo_tblSales"."OrdDate" >= \'2026-01-01 00:00:00\' '
        'AND "dbo_tblSales"."OrdDate" < \'2026-04-01 00:00:00\' '
        'ORDER BY "dbo_tblSales"."SalesValue" DESC'
    )


def test_build_direct_orders_sales_sql_for_market_growth_comparison():
    service = AskService.__new__(AskService)
    sql = service._build_direct_orders_sales_sql(
        "Which markets had the highest growth in the first 6 months of this year compared with the same period last year?"
    )

    assert sql is not None
    assert '"dbo_tblSales"."Market" AS "Market"' in sql
    assert '"CurrentPeriodSales"' in sql
    assert '"PreviousPeriodSales"' in sql
    assert '"SalesGrowth"' in sql
    assert "2026-01-01" in sql
    assert "2025-01-01" in sql


def test_build_schema_grounded_sales_sql_requires_sales_schema():
    service = AskService.__new__(AskService)

    assert (
        service._build_schema_grounded_sales_sql(
            "Create a SalesPerson performance ranking chart",
            ["CREATE TABLE dbo_other (SalesPerson VARCHAR);"],
        )
        is None
    )


def test_build_explicit_table_preview_sql_for_named_table():
    service = AskService.__new__(AskService)
    result = service._build_explicit_table_preview_sql(
        "Show the first 5 rows from tblNewOrders",
        [
            """
            CREATE TABLE tblNewOrders (
              OrdNo VARCHAR,
              Customer VARCHAR,
              InvDate TIMESTAMP
            );
            """
        ],
    )

    assert result == ('SELECT TOP 5 * FROM "tblNewOrders"', "tblNewOrders")


def test_build_explicit_table_preview_sql_for_show_data_prompt():
    service = AskService.__new__(AskService)
    result = service._build_explicit_table_preview_sql(
        "Show data from CustomerMaster",
        [
            """
            CREATE TABLE CustomerMaster (
              CustomerId VARCHAR,
              CustomerName VARCHAR
            );
            """
        ],
    )

    assert result == ('SELECT TOP 10 * FROM "CustomerMaster"', "CustomerMaster")


def test_extract_explicit_table_names_from_query():
    service = AskService.__new__(AskService)

    assert service._extract_explicit_table_names_from_query(
        "Show the first 10 rows from tblNewOrders"
    ) == ["tblNewOrders"]


def test_extract_explicit_table_names_from_using_clause():
    service = AskService.__new__(AskService)

    assert service._extract_explicit_table_names_from_query(
        "Show new orders by CustName using dbo.XStageNewOrders OrdDate and CustName"
    ) == ["dbo.XStageNewOrders"]
    assert service._extract_explicit_table_names_from_query(
        "Show new orders using OrdDate and CustName"
    ) == []


def test_needs_conversation_context_only_for_true_followups():
    service = AskService.__new__(AskService)

    assert not service._needs_conversation_context(
        "Show refund status distribution by Refund_Status"
    )
    assert service._needs_conversation_context(
        "What about the same period from the previous result?"
    )


def test_prune_sql_generation_context_prefers_referenced_table_and_columns():
    service = AskService.__new__(AskService)
    table_ddls = [
        """
        CREATE TABLE dbo_Customers (
          CustomerId VARCHAR,
          CustomerName VARCHAR
        );
        """,
        """
        CREATE TABLE dbo_Products (
          ProductId VARCHAR,
          ProductName VARCHAR
        );
        """,
        """
        CREATE TABLE dbo_XStageNewOrders (
          OrdNo VARCHAR,
          OrdDate TIMESTAMP,
          CustName VARCHAR
        );
        """,
    ]
    documents = [
        {"table_name": "dbo_Customers", "table_ddl": table_ddls[0]},
        {"table_name": "dbo_Products", "table_ddl": table_ddls[1]},
        {"table_name": "dbo_XStageNewOrders", "table_ddl": table_ddls[2]},
    ]

    _, table_names, pruned_ddls = service._prune_sql_generation_context(
        "Show new orders by CustName using dbo.XStageNewOrders OrdDate and CustName",
        documents,
        [document["table_name"] for document in documents],
        table_ddls,
        max_tables=1,
    )

    assert table_names == ["dbo_XStageNewOrders"]
    assert pruned_ddls == [table_ddls[2]]


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
        'AND "dbo_tblSales"."Market" IS NOT NULL '
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
        'WHERE "dbo_tblSales"."Division" IS NOT NULL '
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
        'WHERE "dbo_tblSales"."Market" IS NOT NULL '
        'AND "dbo_tblSales"."Division" IS NOT NULL '
        'AND "dbo_tblSales"."ProdType" IS NOT NULL '
        'GROUP BY "dbo_tblSales"."Market", "dbo_tblSales"."Division", '
        '"dbo_tblSales"."ProdType" '
        'ORDER BY SUM("dbo_tblSales"."SalesValue") DESC'
    )


def test_build_schema_grounded_sales_sql_for_order_date_distribution_by_dimensions():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        'In the "Backlog" category, what is the distribution of order dates '
        "(OrdDate) for each product type (ProdType) sold in each market "
        "segment (Market), considering the salesperson responsible "
        "(SalesPerson)?",
        [
            """
            CREATE TABLE dbo_tblSales (
              Category VARCHAR,
              Market VARCHAR,
              ProdType VARCHAR,
              SalesPerson VARCHAR,
              SalesValue DOUBLE,
              OrdDate TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT DATEPART(YEAR, "dbo_tblSales"."OrdDate") AS "year", '
        'DATEPART(MONTH, "dbo_tblSales"."OrdDate") AS "month", '
        '"dbo_tblSales"."SalesPerson" AS "SalesPerson", '
        '"dbo_tblSales"."Market" AS "Market", '
        '"dbo_tblSales"."ProdType" AS "ProdType", '
        'COUNT(*) AS "OrderCount" '
        'FROM "dbo_tblSales" '
        'WHERE "dbo_tblSales"."OrdDate" IS NOT NULL '
        'AND "dbo_tblSales"."SalesPerson" IS NOT NULL '
        'AND "dbo_tblSales"."Market" IS NOT NULL '
        'AND "dbo_tblSales"."ProdType" IS NOT NULL '
        'AND "dbo_tblSales"."Category" = \'Backlog\' '
        'GROUP BY DATEPART(YEAR, "dbo_tblSales"."OrdDate"), '
        'DATEPART(MONTH, "dbo_tblSales"."OrdDate"), '
        '"dbo_tblSales"."SalesPerson", "dbo_tblSales"."Market", '
        '"dbo_tblSales"."ProdType" '
        'ORDER BY DATEPART(YEAR, "dbo_tblSales"."OrdDate"), '
        'DATEPART(MONTH, "dbo_tblSales"."OrdDate"), COUNT(*) DESC'
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
        'WHERE "dbo_tblSales"."BU" IS NOT NULL '
        'AND "dbo_tblSales"."Market" IS NOT NULL '
        'AND "dbo_tblSales"."ProdName" IS NOT NULL '
        'AND "dbo_tblSales"."Customer" IS NOT NULL '
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
        'WHERE "dbo_tblSales"."Market" IS NOT NULL '
        'AND "dbo_tblSales"."Customer" IS NOT NULL '
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


def test_build_schema_grounded_sales_sql_for_monthly_order_count_by_invdate():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Show monthly order count by InvDate.",
        [
            """
            CREATE TABLE dbo_tblSales (
              OrdNo VARCHAR,
              InvDate TIMESTAMP,
              OrdDate TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT DATEPART(YEAR, "dbo_tblSales"."InvDate") AS "year", '
        'DATEPART(MONTH, "dbo_tblSales"."InvDate") AS "month", '
        'COUNT(*) AS "OrderCount" '
        'FROM "dbo_tblSales" '
        'GROUP BY DATEPART(YEAR, "dbo_tblSales"."InvDate"), '
        'DATEPART(MONTH, "dbo_tblSales"."InvDate") '
        'ORDER BY DATEPART(YEAR, "dbo_tblSales"."InvDate"), '
        'DATEPART(MONTH, "dbo_tblSales"."InvDate")'
    )


def test_build_schema_grounded_sales_sql_counts_new_orders_by_customer_over_time():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Show new orders by CustName over the last 12 months using dbo.XStageNewOrders OrdDate and CustName.",
        [
            """
            CREATE TABLE dbo_XStageNewOrders (
              OrdNo VARCHAR,
              OrdDate TIMESTAMP,
              CustName VARCHAR
            );
            """
        ],
    )

    assert sql == (
        'SELECT DATEPART(YEAR, "dbo_XStageNewOrders"."OrdDate") AS "year", '
        'DATEPART(MONTH, "dbo_XStageNewOrders"."OrdDate") AS "month", '
        '"dbo_XStageNewOrders"."CustName" AS "CustName", '
        'COUNT(DISTINCT "dbo_XStageNewOrders"."OrdNo") AS "OrderCount" '
        'FROM "dbo_XStageNewOrders" '
        'WHERE "dbo_XStageNewOrders"."CustName" IS NOT NULL '
        'GROUP BY DATEPART(YEAR, "dbo_XStageNewOrders"."OrdDate"), '
        'DATEPART(MONTH, "dbo_XStageNewOrders"."OrdDate"), '
        '"dbo_XStageNewOrders"."CustName" '
        'ORDER BY DATEPART(YEAR, "dbo_XStageNewOrders"."OrdDate"), '
        'DATEPART(MONTH, "dbo_XStageNewOrders"."OrdDate")'
    )


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
        'WHERE "dbo_tblSales"."ProdName" IS NOT NULL '
        'AND "dbo_tblSales"."Customer" IS NOT NULL '
        'GROUP BY "dbo_tblSales"."ProdName", "dbo_tblSales"."Customer" '
        'ORDER BY SUM("dbo_tblSales"."SalesValue") DESC'
    )


def test_build_schema_grounded_sales_sql_for_highest_customers_each_market():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Which Customers have the highest New Orders in each Market?",
        [
            """
            CREATE TABLE dbo_tblSales (
              Market VARCHAR,
              Customer VARCHAR,
              OrdNo VARCHAR,
              SalesValue DOUBLE
            );
            """
        ],
    )

    assert sql == (
        'WITH grouped_results AS (SELECT "dbo_tblSales"."Market" AS "Market", '
        '"dbo_tblSales"."Customer" AS "Customer", '
        'COUNT(DISTINCT "dbo_tblSales"."OrdNo") AS "OrderCount" '
        'FROM "dbo_tblSales" '
        'WHERE "dbo_tblSales"."Market" IS NOT NULL '
        'AND "dbo_tblSales"."Customer" IS NOT NULL '
        'GROUP BY "dbo_tblSales"."Market", "dbo_tblSales"."Customer"), '
        'ranked_results AS (SELECT "Market", "Customer", "OrderCount", '
        'ROW_NUMBER() OVER (PARTITION BY "Market" '
        'ORDER BY "OrderCount" DESC) AS "rank" '
        'FROM grouped_results) '
        'SELECT "Market", "Customer", "OrderCount" '
        'FROM ranked_results '
        'WHERE "rank" = 1 '
        'ORDER BY "OrderCount" DESC'
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


def test_build_schema_grounded_sql_counts_categorical_status_values():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "Show refund status distribution.",
        [
            """
            CREATE TABLE dbo_ytblRefund (
              Refund_Id VARCHAR,
              Refund_Status VARCHAR,
              CustomerName VARCHAR
            );
            """
        ],
    )

    assert sql == (
        'SELECT "dbo_ytblRefund"."Refund_Status" AS "Refund_Status", '
        'COUNT(*) AS "RecordCount" '
        'FROM "dbo_ytblRefund" '
        'WHERE "dbo_ytblRefund"."Refund_Status" IS NOT NULL '
        'GROUP BY "dbo_ytblRefund"."Refund_Status" '
        'ORDER BY COUNT(*) DESC'
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


def test_build_manufacturing_throughput_sql_uses_active_unit_and_date_columns():
    service = AskService.__new__(AskService)

    sql = service._build_manufacturing_throughput_sql(
        "Show throughput trends across different manufacturing units.",
        [
            """
            CREATE TABLE dbo_production_events (
              id INTEGER,
              manufacturing_unit VARCHAR,
              created_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT "dbo_production_events"."manufacturing_unit" AS "manufacturing_unit", '
        'DATEPART(YEAR, "dbo_production_events"."created_at") AS "year", '
        'DATEPART(MONTH, "dbo_production_events"."created_at") AS "month", '
        'COUNT(*) AS "throughput" '
        'FROM "dbo_production_events" '
        'WHERE "dbo_production_events"."manufacturing_unit" IS NOT NULL '
        'AND "dbo_production_events"."created_at" IS NOT NULL '
        'GROUP BY "dbo_production_events"."manufacturing_unit", '
        'DATEPART(YEAR, "dbo_production_events"."created_at"), '
        'DATEPART(MONTH, "dbo_production_events"."created_at") '
        'ORDER BY "dbo_production_events"."manufacturing_unit" ASC, '
        'DATEPART(YEAR, "dbo_production_events"."created_at") ASC, '
        'DATEPART(MONTH, "dbo_production_events"."created_at") ASC'
    )


def test_build_monthly_repair_volume_sql_uses_repair_log_date_column():
    service = AskService.__new__(AskService)

    sql = service._build_schema_grounded_sales_sql(
        "Generate a line chart showing monthly repair volume for the last 12 months.",
        [
            """
            CREATE TABLE dbo_repair_logs (
              id VARCHAR,
              status VARCHAR,
              created_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT DATEPART(YEAR, "dbo_repair_logs"."created_at") AS "year", '
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS "month", '
        'COUNT(*) AS "repair_count" '
        'FROM "dbo_repair_logs" '
        'WHERE "dbo_repair_logs"."created_at" IS NOT NULL '
        'GROUP BY DATEPART(YEAR, "dbo_repair_logs"."created_at"), '
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") '
        'ORDER BY DATEPART(YEAR, "dbo_repair_logs"."created_at") ASC, '
        'DATEPART(MONTH, "dbo_repair_logs"."created_at") ASC'
    )
    assert '"status"' not in sql


def test_build_monthly_repair_volume_sql_uses_debug_entry_date_column():
    service = AskService.__new__(AskService)

    sql = service._build_schema_grounded_sales_sql(
        "Generate a line chart showing monthly repair volume for the last 12 months.",
        [
            """
            CREATE TABLE dbo_DebugEntries (
              DebugEntryId VARCHAR,
              Status VARCHAR,
              DateIn TIMESTAMP
            );
            """,
            """
            CREATE TABLE dbo_DebugFixLogs (
              DebugEntryId VARCHAR,
              FixId VARCHAR
            );
            """
        ],
    )

    assert sql == (
        'SELECT DATEPART(YEAR, "dbo_DebugEntries"."DateIn") AS "year", '
        'DATEPART(MONTH, "dbo_DebugEntries"."DateIn") AS "month", '
        'COUNT(*) AS "repair_count" '
        'FROM "dbo_DebugEntries" '
        'WHERE "dbo_DebugEntries"."DateIn" IS NOT NULL '
        'GROUP BY DATEPART(YEAR, "dbo_DebugEntries"."DateIn"), '
        'DATEPART(MONTH, "dbo_DebugEntries"."DateIn") '
        'ORDER BY DATEPART(YEAR, "dbo_DebugEntries"."DateIn") ASC, '
        'DATEPART(MONTH, "dbo_DebugEntries"."DateIn") ASC'
    )
    assert '"Status"' not in sql


def test_get_unqueryable_metric_message_for_throughput_without_unit_column():
    service = AskService.__new__(AskService)

    message = service._get_unqueryable_metric_message(
        "Show throughput trends across different manufacturing units.",
        [
            """
            CREATE TABLE dbo_failure_patterns (
              name VARCHAR,
              occurrences INTEGER,
              created_at TIMESTAMP
            );
            """
        ],
    )

    assert message is not None
    assert "unit" in message


def test_build_schema_grounded_sql_for_ticket_workflow_total_time_uses_first_class_columns():
    service = AskService.__new__(AskService)
    sql = service._build_schema_grounded_sales_sql(
        "What is the estimated total time for each workflow?",
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
              data VARCHAR,
              created_at TIMESTAMP,
              updated_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT "dbo_tickets"."status" AS "workflow", '
        'SUM(DATEDIFF(\'second\', "dbo_tickets"."created_at", '
        '"dbo_tickets"."updated_at")) AS "total_time_seconds" '
        'FROM "dbo_tickets" '
        'WHERE "dbo_tickets"."created_at" IS NOT NULL '
        'AND "dbo_tickets"."updated_at" IS NOT NULL '
        'AND "dbo_tickets"."status" IS NOT NULL '
        'GROUP BY "dbo_tickets"."status" '
        'ORDER BY "total_time_seconds" DESC'
    )
    assert "data" not in sql
    assert "JSON" not in sql


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


def test_build_validated_ask_result_from_sql_uses_local_schema_validation():
    service = AskService.__new__(AskService)

    result = service._build_validated_ask_result_from_sql(
        'SELECT "dbo_tblSales"."SalesPerson" FROM "dbo_tblSales"',
        [
            """
            CREATE TABLE dbo_tblSales (
              SalesPerson VARCHAR,
              SalesValue INTEGER
            );
            """
        ],
    )

    assert result is not None
    assert result.sql == 'SELECT "dbo_tblSales"."SalesPerson" FROM "dbo_tblSales"'


def test_build_validated_ask_result_from_sql_normalizes_column_case_to_schema():
    service = AskService.__new__(AskService)

    result = service._build_validated_ask_result_from_sql(
        'SELECT "dbo_tblFactSales"."TimeID" FROM "dbo_tblFactSales"',
        [
            """
            CREATE TABLE dbo_tblFactSales (
              account VARCHAR,
              timeid VARCHAR,
              amount DOUBLE
            );
            """
        ],
    )

    assert result is not None
    assert result.sql == 'SELECT "dbo_tblFactSales"."timeid" FROM "dbo_tblFactSales"'


def test_build_validated_ask_result_from_sql_normalizes_customer_to_account():
    service = AskService.__new__(AskService)

    result = service._build_validated_ask_result_from_sql(
        'SELECT "dbo_tblFactSales"."customer" FROM "dbo_tblFactSales"',
        [
            """
            CREATE TABLE dbo_tblFactSales (
              account VARCHAR,
              customerpo VARCHAR,
              timeid VARCHAR,
              amount DOUBLE
            );
            """
        ],
    )

    assert result is not None
    assert result.sql == 'SELECT "dbo_tblFactSales"."account" FROM "dbo_tblFactSales"'


def test_build_validated_ask_result_from_sql_normalizes_active_table_reference():
    service = AskService.__new__(AskService)

    result = service._build_validated_ask_result_from_sql(
        (
            'SELECT "public"."dbo_failure"."created_at" '
            'FROM "public"."dbo_failure"'
        ),
        [
            """
            CREATE TABLE dbo_failure_patterns (
              id VARCHAR,
              created_at TIMESTAMP,
              updated_at TIMESTAMP
            );
            """
        ],
        "Show monthly record count by created_at in dbo.failure_patterns",
    )

    assert result is not None
    assert result.sql == (
        'SELECT "dbo_failure_patterns"."created_at" '
        'FROM "dbo_failure_patterns"'
    )


def test_build_schema_grounded_operational_sql_prefers_failure_column_for_error_rate():
    service = AskService.__new__(AskService)

    sql = service._build_schema_grounded_operational_sql(
        "What is the error rate in the repair data collection system for different types of failures?",
        [
            {
                "name": "dbo_repair_logs",
                "columns": [
                    {"name": "status", "type": "varchar"},
                    {"name": "failure_code", "type": "varchar"},
                    {"name": "created_at", "type": "timestamp"},
                ],
            }
        ],
    )

    assert sql is not None
    assert '"dbo_repair_logs"."failure_code" AS "failure_code"' in sql
    assert '"dbo_repair_logs"."status" AS "status"' not in sql


def test_build_validated_ask_result_rejects_status_when_failure_field_matches_question():
    service = AskService.__new__(AskService)

    result = service._build_validated_ask_result_from_sql(
        (
            'SELECT "dbo_repair_logs"."status" AS "status", '
            'COUNT(*) AS "RecordCount" '
            'FROM "dbo_repair_logs" '
            'GROUP BY "dbo_repair_logs"."status"'
        ),
        [
            """
            CREATE TABLE dbo_repair_logs (
              status VARCHAR,
              failure_code VARCHAR,
              created_at TIMESTAMP
            );
            """
        ],
        "What is the error rate for different types of failures?",
    )

    assert result is None


def test_reusable_historical_question_allows_exact_recommended_question():
    assert AskService._is_reusable_historical_question(
        "How many tickets are currently open?",
        "How many tickets are currently open?",
    )


def test_reusable_historical_question_rejects_materially_different_agent_question():
    assert not AskService._is_reusable_historical_question(
        "What is the estimated total time for each workflow?",
        "How many tickets are currently open?",
    )


def test_reusable_historical_question_rejects_similar_but_different_failure_question():
    assert not AskService._is_reusable_historical_question(
        "Which name values have the highest occurrences in dbo.failure_patterns?",
        "What is the distribution of name in dbo.failure_patterns?",
    )


def test_should_not_use_histories_for_independent_same_thread_question():
    assert not AskService._should_use_histories_for_query(
        "Which name values have the highest occurrences in dbo.failure_patterns?"
    )
    assert not AskService._should_use_histories_for_query(
        "Show monthly record count by created_at in dbo.failure_patterns"
    )


def test_should_use_histories_for_contextual_followup_question():
    assert AskService._should_use_histories_for_query("What about by month?")
    assert AskService._should_use_histories_for_query("Show the same for last year")


def test_build_schema_grounded_table_question_sql_for_record_count():
    service = AskService.__new__(AskService)

    sql = service._build_schema_grounded_table_question_sql(
        "How many records are in dbo.failure_patterns?",
        [
            """
            CREATE TABLE dbo_failure_patterns (
              id INTEGER,
              name VARCHAR,
              created_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == 'SELECT COUNT(*) AS "RecordCount" FROM "dbo_failure_patterns"'


def test_build_schema_grounded_table_question_sql_for_name_distribution():
    service = AskService.__new__(AskService)

    sql = service._build_schema_grounded_table_question_sql(
        "What is the distribution of name in dbo.failure_patterns?",
        [
            """
            CREATE TABLE dbo_failure_patterns (
              id INTEGER,
              name VARCHAR,
              created_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT TOP 10 "dbo_failure_patterns"."name" AS "name", '
        'COUNT(*) AS "RecordCount" '
        'FROM "dbo_failure_patterns" '
        'WHERE "dbo_failure_patterns"."name" IS NOT NULL '
        'GROUP BY "dbo_failure_patterns"."name" '
        'ORDER BY COUNT(*) DESC'
    )


def test_build_schema_grounded_table_question_sql_for_highest_occurrences():
    service = AskService.__new__(AskService)

    sql = service._build_schema_grounded_table_question_sql(
        "Which name values have the highest occurrences in dbo.failure_patterns?",
        [
            """
            CREATE TABLE dbo_failure_patterns (
              id INTEGER,
              name VARCHAR,
              occurrences INTEGER,
              created_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT TOP 10 "dbo_failure_patterns"."name" AS "name", '
        '"dbo_failure_patterns"."occurrences" AS "occurrences" '
        'FROM "dbo_failure_patterns" '
        'WHERE "dbo_failure_patterns"."name" IS NOT NULL '
        'ORDER BY "dbo_failure_patterns"."occurrences" DESC'
    )


def test_build_schema_grounded_table_question_sql_for_plural_names_by_occurrences():
    service = AskService.__new__(AskService)

    sql = service._build_schema_grounded_table_question_sql(
        "Show top 10 names by occurrences in dbo.failure_patterns.",
        [
            """
            CREATE TABLE dbo_failure_patterns (
              name VARCHAR,
              occurrences INTEGER,
              created_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT TOP 10 "dbo_failure_patterns"."name" AS "name", '
        '"dbo_failure_patterns"."occurrences" AS "occurrences" '
        'FROM "dbo_failure_patterns" '
        'WHERE "dbo_failure_patterns"."name" IS NOT NULL '
        'ORDER BY "dbo_failure_patterns"."occurrences" DESC'
    )


def test_build_schema_grounded_table_question_sql_for_latest_records_by_created_at():
    service = AskService.__new__(AskService)

    sql = service._build_schema_grounded_table_question_sql(
        "Show the latest records from dbo.failure_patterns by created_at.",
        [
            """
            CREATE TABLE dbo_failure_patterns (
              name VARCHAR,
              occurrences INTEGER,
              created_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT TOP 10 * FROM "dbo_failure_patterns" '
        'WHERE "dbo_failure_patterns"."created_at" IS NOT NULL '
        'ORDER BY "dbo_failure_patterns"."created_at" DESC'
    )


def test_build_schema_grounded_table_question_sql_for_monthly_created_at_count():
    service = AskService.__new__(AskService)

    sql = service._build_schema_grounded_table_question_sql(
        "Show monthly record count by created_at in dbo.failure_patterns",
        [
            """
            CREATE TABLE dbo_failure_patterns (
              id INTEGER,
              name VARCHAR,
              created_at TIMESTAMP
            );
            """
        ],
    )

    assert sql == (
        'SELECT DATEPART(YEAR, "dbo_failure_patterns"."created_at") AS "year", '
        'DATEPART(MONTH, "dbo_failure_patterns"."created_at") AS "month", '
        'COUNT(*) AS "RecordCount" '
        'FROM "dbo_failure_patterns" '
        'WHERE "dbo_failure_patterns"."created_at" IS NOT NULL '
        'GROUP BY DATEPART(YEAR, "dbo_failure_patterns"."created_at"), '
        'DATEPART(MONTH, "dbo_failure_patterns"."created_at") '
        'ORDER BY DATEPART(YEAR, "dbo_failure_patterns"."created_at") ASC, '
        'DATEPART(MONTH, "dbo_failure_patterns"."created_at") ASC'
    )


def test_build_validated_ask_result_rejects_status_for_product_line_pcb_question():
    service = AskService.__new__(AskService)

    result = service._build_validated_ask_result_from_sql(
        (
            'SELECT "dbo_repair_logs"."status" AS "status" '
            'FROM "dbo_repair_logs"'
        ),
        [
            """
            CREATE TABLE dbo_repair_logs (
              status VARCHAR,
              product_line VARCHAR,
              pcb_issue VARCHAR,
              created_at TIMESTAMP
            );
            """
        ],
        "Create a visualization of recurring PCB issues by product line.",
    )

    assert result is None


def test_build_validated_ask_result_rejects_status_for_repair_cost_question():
    service = AskService.__new__(AskService)

    result = service._build_validated_ask_result_from_sql(
        (
            'SELECT "dbo_repair_logs"."status" AS "status" '
            'FROM "dbo_repair_logs"'
        ),
        [
            """
            CREATE TABLE dbo_repair_logs (
              status VARCHAR,
              repair_cost DOUBLE,
              created_at TIMESTAMP
            );
            """
        ],
        "Generate a quarterly repair cost analysis chart.",
    )

    assert result is None


def test_build_validated_ask_result_rejects_status_for_critical_repairs_question():
    service = AskService.__new__(AskService)

    result = service._build_validated_ask_result_from_sql(
        (
            'SELECT "dbo_repair_logs"."status" AS "status" '
            'FROM "dbo_repair_logs"'
        ),
        [
            """
            CREATE TABLE dbo_repair_logs (
              status VARCHAR,
              severity VARCHAR,
              repair_id INTEGER
            );
            """
        ],
        "Create a stacked bar chart comparing critical vs non-critical repairs.",
    )

    assert result is None


def test_build_validated_ask_result_accepts_product_line_pcb_question_sql():
    service = AskService.__new__(AskService)

    result = service._build_validated_ask_result_from_sql(
        (
            'SELECT "dbo_repair_logs"."product_line" AS "product_line", '
            '"dbo_repair_logs"."pcb_issue" AS "pcb_issue", '
            'COUNT(*) AS "RecordCount" '
            'FROM "dbo_repair_logs" '
            'GROUP BY "dbo_repair_logs"."product_line", '
            '"dbo_repair_logs"."pcb_issue"'
        ),
        [
            """
            CREATE TABLE dbo_repair_logs (
              product_line VARCHAR,
              pcb_issue VARCHAR
            );
            """
        ],
        "Create a visualization of recurring PCB issues by product line.",
    )

    assert result is not None


def test_build_validated_ask_result_rejects_unqualified_invalid_columns():
    service = AskService.__new__(AskService)
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          created_at TIMESTAMP,
          updated_at TIMESTAMP,
          status VARCHAR,
          name VARCHAR,
          occurrences INTEGER
        );
        """
    ]

    invalid_sqls = [
        'SELECT DATEPART(MONTH, execution_date) AS "month", COUNT(*) AS "RecordCount" FROM "dbo_repair_logs" GROUP BY DATEPART(MONTH, execution_date)',
        'SELECT created_by AS "created_by", COUNT(*) AS "RecordCount" FROM "dbo_repair_logs" GROUP BY created_by',
        'SELECT physical_name AS "physical_name", occurrences FROM "dbo_repair_logs" ORDER BY occurrences DESC',
        'SELECT name AS "created_by" FROM "dbo_repair_logs" ORDER BY created_by',
    ]

    for sql in invalid_sqls:
        assert (
            service._build_validated_ask_result_from_sql(
                sql,
                table_ddls,
                "Show top 10 failure pattern names by occurrences.",
            )
            is None
        )


def test_build_validated_ask_result_accepts_unqualified_valid_columns():
    service = AskService.__new__(AskService)

    result = service._build_validated_ask_result_from_sql(
        (
            'SELECT name AS "name", occurrences AS "occurrences" '
            'FROM "dbo_repair_logs" '
            'ORDER BY occurrences DESC'
        ),
        [
            """
            CREATE TABLE dbo_repair_logs (
              name VARCHAR,
              occurrences INTEGER
            );
            """
        ],
        "Show top 10 failure pattern names by occurrences.",
    )

    assert result is not None
