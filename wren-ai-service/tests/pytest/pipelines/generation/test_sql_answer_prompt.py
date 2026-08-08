from haystack.components.builders.prompt_builder import PromptBuilder

import pytest

from src.pipelines.generation.sql_answer import (
    SQLAnswer,
    prompt,
    sql_to_answer_user_prompt_template,
)


def test_sql_answer_prompt_uses_sql_data_rows():
    result = prompt(
        query="What is the cost per unit of production volumes for each supplier?",
        sql="SELECT supplier_name, manufacturing_cost_per_unit FROM SupplierManufacturing",
        sql_data={
            "columns": [
                {"name": "supplier_name", "type": "varchar"},
                {"name": "manufacturing_cost_per_unit", "type": "double"},
            ],
            "data": [["Supplier 1", 0.06]],
        },
        language="English",
        current_time="2026-08-03T00:00:00",
        custom_instruction="",
        prompt_builder=PromptBuilder(template=sql_to_answer_user_prompt_template),
    )

    generated_prompt = result["prompt"]

    assert "rows:" in generated_prompt
    assert "Supplier 1" in generated_prompt
    assert "result rows:" not in generated_prompt


@pytest.mark.asyncio
async def test_sql_answer_uses_llm_generation_with_query_id():
    class CapturingProvider:
        def __init__(self):
            self.calls = []

        def get_generator(self, **_):
            async def _generator(**kwargs):
                self.calls.append(kwargs)
                return {"replies": ["answer"], "metadata": []}

            return _generator

        def get_model(self):
            return "test-model"

    provider = CapturingProvider()
    pipeline = SQLAnswer(provider)
    result = await pipeline.run(
        query="show all the active users",
        sql="SELECT username, name FROM users WHERE status = 'active'",
        sql_data={
            "columns": [
                {"name": "username", "type": "varchar"},
                {"name": "name", "type": "varchar"},
            ],
            "data": [["jdoe", "Jane Doe"]],
        },
        language="English",
        query_id="answer-table-task",
    )

    assert provider.calls[0]["query_id"] == "answer-table-task"
    assert result["generate_answer"]["replies"] == ["answer"]
