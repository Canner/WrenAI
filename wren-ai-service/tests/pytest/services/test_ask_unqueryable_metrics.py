from src.web.v1.services.ask import AskService


def test_first_pass_yield_requires_queryable_attempt_fields():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          org_id VARCHAR,
          id VARCHAR,
          board_model VARCHAR,
          failure_code VARCHAR,
          status VARCHAR,
          priority VARCHAR,
          created_at TIMESTAMP,
          updated_at TIMESTAMP,
          data JSON
        );
        """
    ]

    message = service._get_unqueryable_metric_message(
        "Show First Pass Yield percentage trend over time.",
        table_ddls,
    )

    assert message
    assert "first-pass yield" in message.lower()
    assert "first-class columns" in message


def test_first_pass_yield_guard_allows_queryable_attempt_fields():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          created_at TIMESTAMP,
          attempt_number INTEGER,
          pass_fail VARCHAR
        );
        """
    ]

    assert (
        service._get_unqueryable_metric_message(
            "Show FPY trend over time.",
            table_ddls,
        )
        is None
    )


def test_repair_cost_requires_queryable_cost_field():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          org_id VARCHAR,
          id VARCHAR,
          board_model VARCHAR,
          failure_code VARCHAR,
          status VARCHAR,
          priority VARCHAR,
          created_at TIMESTAMP,
          updated_at TIMESTAMP,
          data JSON
        );
        """
    ]

    message = service._get_unqueryable_metric_message(
        "Create a line chart comparing repair cost and turnaround time.",
        table_ddls,
    )

    assert message
    assert "repair cost" in message.lower()
    assert "first-class column" in message
    assert "JSON/text" in message


def test_repair_cost_guard_allows_queryable_cost_field():
    service = AskService(pipelines={})
    table_ddls = [
        """
        CREATE TABLE dbo_repair_logs (
          id VARCHAR,
          repair_cost DOUBLE,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        );
        """
    ]

    assert (
        service._get_unqueryable_metric_message(
            "Create a line chart comparing repair cost and turnaround time.",
            table_ddls,
        )
        is None
    )
