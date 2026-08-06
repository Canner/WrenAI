from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.sql_answer import prompt, sql_to_answer_user_prompt_template


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
