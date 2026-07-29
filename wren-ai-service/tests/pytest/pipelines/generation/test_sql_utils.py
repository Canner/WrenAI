from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.utils.sql import (
    construct_instructions,
    get_json_field_instructions,
    get_metric_instructions,
    get_sql_generation_system_prompt,
    get_text_to_sql_rules,
    sql_generation_reasoning_system_prompt,
)
from src.pipelines.generation.followup_sql_generation import (
    text_to_sql_with_followup_user_prompt_template,
)
from src.pipelines.generation.sql_correction import (
    get_sql_correction_system_prompt,
    sql_correction_user_prompt_template,
)
from src.pipelines.generation.sql_generation import sql_generation_user_prompt_template
from src.pipelines.generation.sql_regeneration import get_sql_regeneration_system_prompt
from src.pipelines.generation.sql_regeneration import sql_regeneration_user_prompt_template


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

    assert "Generate Wren SQL that can be parsed by the Wren engine" in rules
    assert "ORDER BY comes before LIMIT" in rules
    assert "Datasource-specific SQL syntax is execution-target context only" in rules
    assert "ONLY USE the tables and columns mentioned in the database schema" in rules
    assert 'ONLY USE "*" if the user query asks for all the columns' in rules
    assert "They are never source table or source column identifiers" in rules
    assert "do not invent a field" in rules
    assert "join only through the FOREIGN KEY relationships shown" in rules
    assert "Never generate SQL from assumptions" in rules
    assert "Do not derive executable identifiers" in rules
    assert "Do not query INFORMATION_SCHEMA" in rules
    assert "SQL samples and query history are examples of intent and style only" in rules
    assert "order by that alias" in rules
    assert "Interpret the user's intent" in rules
    assert "schema descriptions, aliases, display labels" in rules
    assert "use all required related tables" in rules
    assert "silently check that each identifier and function" in rules
    assert "instead of inventing a replacement" in rules
    assert "exact date/time schema column and required SQL FUNCTIONS-supported operation" in rules
    assert (
        "Treat reasoning plans, correction notes, and error messages as non-executable context"
        in rules
    )
    assert "first locate the exact declared source column" in rules
    assert "Physical datasource names, source database names" in rules
    assert "Do not replace an invalid identifier with a similar-looking physical" in rules
    assert "source/lineage names from metadata may guide meaning" in rules


def test_get_text_to_sql_rules_keeps_mandatory_rules_with_sql_knowledge():
    rules = get_text_to_sql_rules(_SqlKnowledge())

    assert "ONLY USE the tables and columns mentioned in the database schema" in rules
    assert "For top, bottom, highest, lowest, first, or last requests" in rules
    assert _SqlKnowledge.text_to_sql_rule in rules
    assert "Use this section only when it is compatible with Wren SQL" in rules
    assert "MANDATORY SQL GROUNDING RULES" in rules
    assert "Generate Wren SQL that can be parsed by the Wren engine" in rules
    assert "Every table and column referenced" in rules
    assert "Do not query INFORMATION_SCHEMA" in rules


def test_get_metric_instructions_uses_sql_knowledge_override():
    assert get_metric_instructions(_SqlKnowledge()) == _SqlKnowledge.metric_instructions


def test_get_json_field_instructions_uses_sql_knowledge_override():
    assert (
        get_json_field_instructions(_SqlKnowledge())
        == _SqlKnowledge.json_field_instructions
    )


def test_sql_generation_system_prompt_grounding_contract():
    prompt = get_sql_generation_system_prompt()

    assert "Output aliases are labels for result columns only" in prompt
    assert "must not be copied into FROM, JOIN, WHERE, GROUP BY, HAVING, or ORDER BY" in prompt
    assert "source of executable table and column identifiers" in prompt
    assert "Never generate SQL from assumptions" in prompt
    assert "ignore those parts" in prompt
    assert "answer the user's intent" in prompt
    assert "Wren SQL query" in prompt
    assert "use a normal equality or LIKE comparison" in prompt
    assert "unless the user explicitly asks for rank values" in prompt
    assert "perform a silent grounding check" in prompt
    assert "closest grounded expression" in prompt
    assert "DATABASE SCHEMA is the only source of executable identifiers" in prompt
    assert "reasoning plan only as non-executable context" in prompt
    assert "include those objects only when DATABASE SCHEMA shows" in prompt
    assert "Use the exact supported syntax shown there" in prompt
    assert "source database/schema/table names" in prompt
    assert "appears only in SQL samples, reasoning, failed SQL" in prompt


def test_json_field_instructions_do_not_include_placeholder_identifiers():
    prompt = get_json_field_instructions()

    assert "json_fields metadata" in prompt
    assert "Do not copy JSON examples" in prompt
    assert "CREATE TABLE users" not in prompt
    assert "my_table" not in prompt
    assert "parent_table" not in prompt


def test_sql_regeneration_system_prompt_uses_question_as_intent_source():
    prompt = get_sql_regeneration_system_prompt()

    assert "Wren SQL query" in prompt
    assert "ANSI SQL" not in prompt
    assert "regenerate from the user's question" in prompt
    assert "unsupported identifiers" in prompt
    assert "original SQL query and UI planning text are intentionally omitted" in prompt
    assert (
        "database schema as the only source of executable table and column identifiers"
        in prompt
    )
    assert "Treat physical/source/lineage names from the original SQL" in prompt


def test_sql_correction_system_prompt_discards_invalid_identifier_context():
    prompt = get_sql_correction_system_prompt()

    assert "Wren SQL query" in prompt
    assert "ANSI SQL" not in prompt
    assert "fix the syntactically incorrect Wren SQL query" in prompt
    assert "generate the syntactically correct Wren SQL query" in prompt
    assert "Keep executable table and column identifiers grounded" in prompt


def test_sql_reasoning_prompt_forbids_executable_sql_context():
    prompt = sql_generation_reasoning_system_prompt

    assert "Do not write SQL, possible SQL, sample SQL, assumed SQL" in prompt
    assert "SQL clauses, SQL functions, code blocks, or executable expressions" in prompt
    assert "The reasoning plan is non-executable context" in prompt
    assert "Only cite exact declared names from DATABASE SCHEMA" in prompt
    assert "source metadata, physical datasource names, or lineage names" in prompt


def test_user_prompt_templates_keep_source_metadata_non_executable():
    for prompt in (
        sql_generation_user_prompt_template,
        text_to_sql_with_followup_user_prompt_template,
        sql_regeneration_user_prompt_template,
    ):
        assert "source/physical/lineage names" in prompt
        assert "omit that unsupported part instead of inventing" in prompt
        assert "exact declared table and column names from DATABASE SCHEMA" in prompt


def test_executable_prompt_templates_omit_planning_and_original_sql_context():
    marker = "UNTRUSTED_CONTEXT_MARKER"

    generation_prompt = PromptBuilder(template=sql_generation_user_prompt_template).run(
        query="Question",
        documents=["SCHEMA_CONTEXT"],
        sql_generation_reasoning=marker,
        instructions=[],
        calculated_field_instructions="",
        metric_instructions="",
        json_field_instructions="",
        sql_samples=[],
        sql_functions=[],
    )["prompt"]

    followup_prompt = PromptBuilder(
        template=text_to_sql_with_followup_user_prompt_template
    ).run(
        query="Question",
        documents=["SCHEMA_CONTEXT"],
        sql_generation_reasoning=marker,
        instructions=[],
        calculated_field_instructions="",
        metric_instructions="",
        json_field_instructions="",
        sql_samples=[],
        sql_functions=[],
    )["prompt"]

    regeneration_prompt = PromptBuilder(
        template=sql_regeneration_user_prompt_template
    ).run(
        query="Question",
        sql=marker,
        documents=["SCHEMA_CONTEXT"],
        sql_generation_reasoning=marker,
        instructions=[],
        calculated_field_instructions="",
        metric_instructions="",
        json_field_instructions="",
        sql_samples=[],
        sql_functions=[],
    )["prompt"]

    for prompt in (
        generation_prompt,
        followup_prompt,
        regeneration_prompt,
    ):
        assert marker not in prompt
        assert "intentionally omitted" in prompt


def test_sql_correction_user_prompt_follows_legacy_failed_sql_flow():
    assert "SQL: {{ invalid_generation_result.sql }}" in sql_correction_user_prompt_template
    assert "Error Message: {{ invalid_generation_result.error }}" in sql_correction_user_prompt_template
    assert "Let's think step by step." in sql_correction_user_prompt_template
