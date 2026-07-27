import pytest

from src.pipelines.generation.utils.sql import (
    SQLGenPostProcessor,
    construct_instructions,
    find_unavailable_sql_tables,
    get_json_field_instructions,
    get_metric_instructions,
    get_sql_generation_system_prompt,
    get_text_to_sql_rules,
)


class _SqlKnowledge:
    text_to_sql_rule = "Use the supplied model context only."
    metric_instructions = "Use the supplied metric definitions only."
    json_field_instructions = "Use the supplied JSON field definitions only."


def test_construct_instructions_uses_instruction_text():
    assert construct_instructions(
        [{"instruction": "First rule."}, {"instruction": "Second rule."}]
    ) == ["First rule.", "Second rule."]


def test_get_text_to_sql_rules_uses_default_metadata_grounding_rules():
    rules = get_text_to_sql_rules()

    assert "ONLY USE the tables and columns mentioned in the database schema" in rules
    assert 'ONLY USE "*" if the user query asks for all the columns' in rules


def test_get_text_to_sql_rules_uses_sql_knowledge_override():
    assert get_text_to_sql_rules(_SqlKnowledge()) == _SqlKnowledge.text_to_sql_rule


def test_get_metric_instructions_uses_sql_knowledge_override():
    assert get_metric_instructions(_SqlKnowledge()) == _SqlKnowledge.metric_instructions


def test_get_json_field_instructions_uses_sql_knowledge_override():
    assert (
        get_json_field_instructions(_SqlKnowledge())
        == _SqlKnowledge.json_field_instructions
    )


def test_sql_generation_system_prompt_grounding_contract():
    prompt = get_sql_generation_system_prompt()

    assert "DATABASE SCHEMA section is the complete and only source" in prompt
    assert "MUST NOT introduce, infer, copy, or repair" in prompt
    assert "Do not copy identifiers" in prompt


def test_find_unavailable_sql_tables_rejects_non_retrieved_table():
    contexts = [
        """
        CREATE TABLE dbo_dimCustomers (
          CustomerID VARCHAR
        );
        """
    ]

    assert find_unavailable_sql_tables(
        "SELECT * FROM dbo_tblPayments ORDER BY PaymentDate DESC",
        contexts,
    ) == ["dbo_tblPayments"]


def test_find_unavailable_sql_tables_allows_retrieved_table_and_cte():
    contexts = [
        """
        CREATE TABLE "dbo_tblPayments" (
          PaymentDate TIMESTAMP
        );
        """
    ]

    assert (
        find_unavailable_sql_tables(
            """
            WITH recent_payments AS (
              SELECT * FROM "dbo_tblPayments"
            )
            SELECT * FROM recent_payments
            """,
            contexts,
        )
        == []
    )


@pytest.mark.asyncio
async def test_sql_post_processor_blocks_sql_using_non_retrieved_table():
    class Engine:
        async def execute_sql(self, *_args, **_kwargs):
            raise AssertionError("engine should not be called")

    post_processor = SQLGenPostProcessor(Engine())

    result = await post_processor.run(
        ['{"sql": "SELECT * FROM dbo_tblPayments"}'],
        contexts=[
            """
            CREATE TABLE dbo_dimCustomers (
              CustomerID VARCHAR
            );
            """
        ],
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "SCHEMA_GROUNDING"
    assert "dbo_tblPayments" in result["invalid_generation_result"]["error"]
