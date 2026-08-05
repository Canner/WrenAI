from haystack.components.builders.prompt_builder import PromptBuilder

import pytest

from src.pipelines.generation.sql_answer import (
    SQLAnswer,
    prompt,
    sql_to_answer_user_prompt_template,
)


def test_sql_answer_prompt_uses_column_mapped_result_rows():
    result = prompt(
        query="What is the cost per unit of production volumes for each supplier?",
        sql="SELECT supplier_name, manufacturing_cost_per_unit FROM SupplierManufacturing",
        sql_data={
            "columns": [
                {"name": "supplier_name", "type": "varchar"},
                {"name": "manufacturing_cost_per_unit", "type": "double"},
            ],
            "data": [["Supplier 1", 0.06]],
            "row_records": [
                {
                    "supplier_name": "Supplier 1",
                    "manufacturing_cost_per_unit": 0.06,
                }
            ],
        },
        language="English",
        current_time="2026-08-03T00:00:00",
        custom_instruction="",
        prompt_builder=PromptBuilder(template=sql_to_answer_user_prompt_template),
    )

    generated_prompt = result["prompt"]

    assert "result rows:" in generated_prompt
    assert "supplier_name" in generated_prompt
    assert "Supplier 1" in generated_prompt
    assert "rows: [[" not in generated_prompt


@pytest.mark.asyncio
async def test_sql_answer_streams_deterministic_empty_result_without_llm():
    class FailingProvider:
        def get_generator(self, **_):
            async def _generator(**__):
                raise AssertionError("LLM generator should not be needed")

            return _generator

        def get_model(self):
            return "test-model"

    pipeline = SQLAnswer(FailingProvider())
    result = await pipeline.run(
        query="Find invoices linked to purchase order PO1001.",
        sql="SELECT invoice_number FROM invoices WHERE po = 'PO1001'",
        sql_data={
            "columns": [{"name": "invoice_number", "type": "varchar"}],
            "data": [],
            "row_records": [],
        },
        language="English",
        query_id="answer-task",
    )

    chunks = []
    async for chunk in pipeline.get_streaming_results("answer-task"):
        chunks.append(chunk)

    assert "No matching records were returned" in "".join(chunks)
    assert "No matching records were returned" in result["generate_answer"][0]["replies"][0]


@pytest.mark.asyncio
async def test_sql_answer_streams_deterministic_table_result_without_llm():
    class FailingProvider:
        def get_generator(self, **_):
            async def _generator(**__):
                raise AssertionError("LLM generator should not be needed")

            return _generator

        def get_model(self):
            return "test-model"

    pipeline = SQLAnswer(FailingProvider())
    await pipeline.run(
        query="show all the active users",
        sql="SELECT username, name FROM users WHERE status = 'active'",
        sql_data={
            "columns": [
                {"name": "username", "type": "varchar"},
                {"name": "name", "type": "varchar"},
            ],
            "data": [["jdoe", "Jane Doe"]],
            "row_records": [{"username": "jdoe", "name": "Jane Doe"}],
        },
        language="English",
        query_id="answer-table-task",
    )

    chunks = []
    async for chunk in pipeline.get_streaming_results("answer-table-task"):
        chunks.append(chunk)

    answer = "".join(chunks)
    assert "The data returned 1 matching result" in answer
    assert "Jane Doe" in answer
    assert "username is jdoe" in answer
    assert "| username | name |" not in answer
