from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.sql_correction import (
    get_sql_correction_system_prompt,
    prompt as build_sql_correction_prompt,
    sql_correction_user_prompt_template,
)
from src.pipelines.generation.followup_sql_generation import (
    prompt as build_followup_sql_generation_prompt,
    text_to_sql_with_followup_user_prompt_template,
)
from src.pipelines.generation.sql_generation import (
    get_sql_generation_system_prompt,
    prompt as build_sql_generation_prompt,
    sql_generation_user_prompt_template,
)
from src.pipelines.generation.sql_regeneration import (
    prompt as build_sql_regeneration_prompt,
    sql_regeneration_user_prompt_template,
)
from src.pipelines.generation.utils.sql import build_executable_schema_contract


def test_sql_generation_system_prompt_requires_retrieved_semantic_authority():
    prompt = get_sql_generation_system_prompt()

    assert "retrieved semantic context as the only authoritative source" in prompt
    assert "Do not use pretrained knowledge" in prompt
    assert "Before generating SQL, silently validate" in prompt
    assert "return null for sql instead of choosing one" in prompt
    assert "Never use \"*\" in the SELECT list" in prompt
    assert "For metric-style requests" in prompt
    assert "Do not join tables just because they were retrieved together" in prompt
    assert "Do not invent join predicates from similar column names" in prompt
    assert "retrieved schema objects as ranked candidates" in prompt
    assert "Use set operations only when the user explicitly requests" in prompt
    assert "role-hint metadata only as semantic hints" in prompt
    assert "Metadata role labels are never SQL identifiers" in prompt
    assert "Do not answer a timeframe request with an unfiltered table scan" in prompt
    assert "produce an analytical query shape" in prompt
    assert "contributed" in prompt
    assert "aggregate the exact requested measure with SUM" in prompt
    assert "Do not use AVG, subtraction, margin" in prompt
    assert "Never output template SQL" in prompt
    assert "contains no placeholders or template parts" in prompt
    assert "complete executable SQL query string" in prompt


def test_sql_correction_system_prompt_allows_null_when_ungrounded():
    prompt = get_sql_correction_system_prompt()

    assert "repair the query only when the repair can be verified" in prompt
    assert "Never introduce a new schema object during repair" in prompt
    assert "or null" in prompt
    assert "Never use \"*\" in the SELECT list" in prompt


def test_build_executable_schema_contract_lists_retrieved_identifiers():
    contract = build_executable_schema_contract(
        [
            {
                "table_name": "retrieved_model",
                "column_names": ["grouping_attribute", "numeric_measure"],
                "relationship_constraints": [
                    "FOREIGN KEY (related_id) REFERENCES related_model(id)"
                ],
            }
        ]
    )

    assert "EXECUTABLE WREN IDENTIFIER CATALOG" in contract
    assert "TABLE: retrieved_model" in contract
    assert "- grouping_attribute" in contract
    assert "- numeric_measure" in contract
    assert "RELATIONSHIPS:" in contract
    assert "- FOREIGN KEY (related_id) REFERENCES related_model(id)" in contract


def test_sql_generation_prompt_omits_sample_sql_body():
    result = build_sql_generation_prompt(
        query="summarize the records",
        documents=[],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_samples=[
            {
                "question": "sample intent",
                "sql": "SELECT 1",
            }
        ],
    )

    built_prompt = result["prompt"]

    assert "sample intent" in built_prompt
    assert "SELECT 1" not in built_prompt


def test_sql_generation_prompt_includes_executable_schema_contract():
    result = build_sql_generation_prompt(
        query="summarize the records",
        documents=[],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        schema_contracts=[
            {
                "table_name": "retrieved_model",
                "column_names": ["grouping_attribute", "numeric_measure"],
            }
        ],
    )

    built_prompt = result["prompt"]

    assert "ALLOWED EXECUTABLE IDENTIFIERS FOR THIS REQUEST" in built_prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" in built_prompt
    assert "TABLE: retrieved_model" in built_prompt
    assert "- grouping_attribute" in built_prompt
    assert "- numeric_measure" in built_prompt
    assert "Generate an intent-shaped query, not a table preview" in built_prompt
    assert "filter an actual declared column" in built_prompt
    assert "aggregate actual declared measure columns" in built_prompt
    assert "aggregate the exact requested measure with SUM" in built_prompt
    assert "Metadata role labels are not executable column names" in built_prompt
    assert "Never return template SQL" in built_prompt
    assert "Copy user-provided filter values exactly" in built_prompt
    assert "not automatic datasets to merge" in built_prompt
    assert "Do not use UNION, UNION ALL, INTERSECT, or EXCEPT" in built_prompt


def test_followup_sql_generation_prompt_requires_intent_shaped_query():
    result = build_followup_sql_generation_prompt(
        query="show recent refunds",
        documents=[],
        sql_generation_reasoning="",
        prompt_builder=PromptBuilder(
            template=text_to_sql_with_followup_user_prompt_template
        ),
    )

    assert "Generate an intent-shaped query, not a table preview" in result["prompt"]
    assert "Never return template SQL" in result["prompt"]
    assert "aggregate the exact requested measure with SUM" in result["prompt"]
    assert "not automatic datasets to merge" in result["prompt"]
    assert "Do not use UNION, UNION ALL, INTERSECT, or EXCEPT" in result["prompt"]


def test_sql_correction_prompt_keeps_failed_sql_diagnostic_and_question():
    result = build_sql_correction_prompt(
        documents=[],
        invalid_generation_result={
            "sql": "SELECT 1",
            "error": "dry run failed",
        },
        query="summarize the records",
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "User's Question: summarize the records" in built_prompt
    assert "Failed SQL: SELECT 1" in built_prompt
    assert "DIAGNOSTIC CONTEXT" in built_prompt
    assert "Correct into an intent-shaped query, not a table preview" in built_prompt
    assert "rebuild the query shape from the user's question" in built_prompt
    assert "Do not preserve AVG, subtraction, margin" in built_prompt
    assert "Never return template SQL" in built_prompt
    assert "not automatic datasets to merge" in built_prompt
    assert "Do not use UNION, UNION ALL, INTERSECT, or EXCEPT" in built_prompt


def test_sql_correction_prompt_includes_executable_schema_contract():
    result = build_sql_correction_prompt(
        documents=[],
        invalid_generation_result={
            "sql": "",
            "error": "Generated SQL references identifiers outside retrieved schema.",
        },
        query="summarize the records",
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
        schema_contracts=[
            {
                "table_name": "retrieved_model",
                "column_names": ["grouping_attribute", "numeric_measure"],
            }
        ],
    )

    built_prompt = result["prompt"]

    assert "ALLOWED EXECUTABLE IDENTIFIERS FOR THIS CORRECTION" in built_prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" in built_prompt
    assert "TABLE: retrieved_model" in built_prompt
    assert "Failed SQL:" in built_prompt


def test_sql_regeneration_prompt_includes_executable_schema_contract():
    result = build_sql_regeneration_prompt(
        query="summarize the records",
        documents=[],
        sql_generation_reasoning="",
        sql="",
        prompt_builder=PromptBuilder(template=sql_regeneration_user_prompt_template),
        schema_contracts=[
            {
                "table_name": "retrieved_model",
                "column_names": ["grouping_attribute", "numeric_measure"],
            }
        ],
    )

    built_prompt = result["prompt"]

    assert "ALLOWED EXECUTABLE IDENTIFIERS FOR THIS REGENERATION" in built_prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" in built_prompt
    assert "TABLE: retrieved_model" in built_prompt
    assert "Regenerate an intent-shaped query, not a table preview" in built_prompt
    assert "filter an actual declared time/date column" in built_prompt
    assert "Do not write role labels" in built_prompt
    assert "aggregate the exact requested measure with SUM" in built_prompt
    assert "Never return template SQL" in built_prompt
    assert "not automatic datasets to merge" in built_prompt
    assert "Do not use UNION, UNION ALL, INTERSECT, or EXCEPT" in built_prompt
