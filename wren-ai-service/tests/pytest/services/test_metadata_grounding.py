from src.pipelines.generation.sql_answer import sql_to_answer_system_prompt
from src.pipelines.generation.utils.sql import get_sql_generation_system_prompt
from src.web.v1.services.ask import AskService


def test_schema_grounding_rejects_unknown_column_after_table_match():
    service = AskService.__new__(AskService)
    result = service._build_validated_ask_result_from_sql(
        (
            'SELECT "dbo_orders"."CustomerName", '
            'SUM("dbo_orders"."HallucinatedValue") AS "TotalValue" '
            'FROM "dbo_orders" GROUP BY "dbo_orders"."CustomerName"'
        ),
        [
            """
            CREATE TABLE dbo_orders (
              CustomerName VARCHAR,
              OrderValue DOUBLE
            );
            """
        ],
        "compare order value by customer",
    )

    assert result is None


def test_schema_grounding_accepts_valid_columns():
    service = AskService.__new__(AskService)
    result = service._build_validated_ask_result_from_sql(
        (
            'SELECT "dbo_orders"."CustomerName", '
            'SUM("dbo_orders"."OrderValue") AS "TotalValue" '
            'FROM "dbo_orders" GROUP BY "dbo_orders"."CustomerName"'
        ),
        [
            """
            CREATE TABLE dbo_orders (
              CustomerName VARCHAR,
              OrderValue DOUBLE
            );
            """
        ],
        "compare order value by customer",
    )

    assert result is not None


def test_prompts_enforce_metadata_grounding_and_result_grounded_answers():
    sql_prompt = get_sql_generation_system_prompt()

    assert "exact identifier allowlist" in sql_prompt
    assert "Select columns by business meaning" in sql_prompt
    assert "Do not SUM or AVG string columns" in sql_prompt
    assert "Never say you do not have access" in sql_to_answer_system_prompt
    assert "If Data rows are empty" in sql_to_answer_system_prompt
