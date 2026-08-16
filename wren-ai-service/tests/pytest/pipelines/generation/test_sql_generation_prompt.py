from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.followup_sql_generation import (
    prompt as followup_sql_generation_prompt,
)
from src.pipelines.generation.followup_sql_generation import (
    text_to_sql_with_followup_user_prompt_template,
)
from src.pipelines.generation.sql_generation import (
    prompt as sql_generation_prompt,
)
from src.pipelines.generation.sql_generation import sql_generation_user_prompt_template


def test_sql_generation_prompt_does_not_include_reasoning_identifiers():
    result = sql_generation_prompt(
        query="Show invoices",
        documents=['CREATE TABLE "deployed_invoice_model" ("invoice_id" VARCHAR);'],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_generation_reasoning="SELECT * FROM invoices",
    )

    assert "deployed_invoice_model" in result["prompt"]
    assert "SELECT * FROM invoices" not in result["prompt"]
    assert "### REASONING PLAN ###" not in result["prompt"]


def test_followup_sql_generation_prompt_does_not_include_reasoning_identifiers():
    result = followup_sql_generation_prompt(
        query="Show invoices",
        documents=['CREATE TABLE "deployed_invoice_model" ("invoice_id" VARCHAR);'],
        sql_generation_reasoning="SELECT * FROM invoices",
        prompt_builder=PromptBuilder(
            template=text_to_sql_with_followup_user_prompt_template
        ),
    )

    assert "deployed_invoice_model" in result["prompt"]
    assert "SELECT * FROM invoices" not in result["prompt"]
    assert "### REASONING PLAN ###" not in result["prompt"]
