from src.web.v1.services.ask import AskService


def test_manufacturing_throughput_trend_uses_debug_entry_business_unit():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_DebugEntries (
          DebugEntryId VARCHAR,
          BusinessUnit VARCHAR,
          DateIn TIMESTAMP
        );
        """,
        """
        CREATE TABLE dbo_batch_records (
          id VARCHAR,
          board_model VARCHAR,
          production_date TIMESTAMP
        );
        """,
    ]

    sql = service._build_manufacturing_throughput_sql(
        "Show throughput trends across different manufacturing units.",
        table_ddls,
        table_names=["dbo_DebugEntries", "dbo_batch_records"],
    )

    assert sql
    assert '"dbo_DebugEntries"."BusinessUnit"' in sql
    assert '"dbo_DebugEntries"."DateIn"' in sql
    assert "dbo_batch_records" not in sql
    assert 'COUNT(*) AS "throughput"' in sql
    assert "DATEPART(MONTH" in sql


def test_manufacturing_throughput_fallback_requires_business_unit_column():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_batch_records (
          id VARCHAR,
          board_model VARCHAR,
          production_date TIMESTAMP
        );
        """
    ]

    assert (
        service._build_manufacturing_throughput_sql(
            "Show throughput trends across different manufacturing units.",
            table_ddls,
            table_names=["dbo_batch_records"],
        )
        is None
    )


def test_repair_failure_count_uses_repair_log_failure_code():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          board_model VARCHAR,
          failure_code VARCHAR,
          status VARCHAR,
          created_at TIMESTAMP
        );
        """,
        """
        CREATE TABLE dbo_reports (
          id VARCHAR,
          name VARCHAR
        );
        """,
    ]

    sql = service._build_repair_failure_count_sql(
        "Create a bar chart of repair counts grouped by failure category.",
        table_ddls,
        table_names=["dbo_repair_logs", "dbo_reports"],
    )

    assert sql
    assert '"dbo_repair_logs"."failure_code" AS "failure_category"' in sql
    assert 'COUNT(*) AS "repair_count"' in sql
    assert "Failure Category" not in sql
    assert "dbo_reports" not in sql


def test_common_pcb_failures_uses_repair_log_failure_code():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          board_model VARCHAR,
          failure_code VARCHAR,
          status VARCHAR,
          created_at TIMESTAMP
        );
        """,
        """
        CREATE TABLE dbo_DebugEntries (
          DebugEntryId VARCHAR,
          FailureSys VARCHAR
        );
        """,
    ]

    sql = service._build_repair_failure_count_sql(
        "Show top 10 most common PCB failures in a bar chart.",
        table_ddls,
        table_names=["dbo_repair_logs", "dbo_DebugEntries"],
    )

    assert sql
    assert sql.startswith('SELECT "dbo_repair_logs"."failure_code"')
    assert '"dbo_repair_logs"."failure_code" AS "failure_category"' in sql
    assert 'COUNT(*) AS "repair_count"' in sql
    assert "FailureSys" not in sql
    assert "TOP 10" not in sql
    assert sql.endswith("LIMIT 10")


def test_common_pcb_failures_uses_direct_heuristic_route():
    service = AskService(pipelines={})

    assert service._is_direct_heuristic_sql_query(
        "Show top 10 most common PCB failures in a bar chart."
    )


def test_repair_failure_count_requires_schema_backed_failure_dimension():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          board_model VARCHAR,
          status VARCHAR,
          created_at TIMESTAMP
        );
        """
    ]

    assert (
        service._build_repair_failure_count_sql(
            "Create a bar chart of repair counts grouped by failure category.",
            table_ddls,
            table_names=["dbo_repair_logs"],
        )
        is None
    )
