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
