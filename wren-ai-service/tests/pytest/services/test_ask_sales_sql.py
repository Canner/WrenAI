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
