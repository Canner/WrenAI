from src.pipelines.generation.utils.sql import (
    construct_instructions,
    get_json_field_instructions,
    get_metric_instructions,
    get_sql_generation_system_prompt,
    get_text_to_sql_rules,
    sql_generation_reasoning_system_prompt,
)
from src.pipelines.generation.sql_correction import get_sql_correction_system_prompt
from src.pipelines.generation.sql_regeneration import get_sql_regeneration_system_prompt


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
    assert "Do not use them as executable table or column identifiers" in rules
    assert "do not invent a field" in rules
    assert "join only through the FOREIGN KEY relationships shown" in rules
    assert "Never generate SQL from assumptions" in rules
    assert "Do not query INFORMATION_SCHEMA" in rules
    assert "SQL samples and query history are examples of intent and style only" in rules
    assert "order by that alias" in rules
    assert "Interpret the user's intent" in rules
    assert "schema descriptions, aliases, display labels" in rules
    assert "use all required related tables" in rules
    assert "silently check that each identifier and function" in rules
    assert "instead of inventing a replacement" in rules
    assert (
        "Treat reasoning plans, correction notes, and error messages as non-executable context"
        in rules
    )
    assert "first locate the exact declared column" in rules


def test_get_text_to_sql_rules_keeps_mandatory_rules_with_sql_knowledge():
    rules = get_text_to_sql_rules(_SqlKnowledge())

    assert _SqlKnowledge.text_to_sql_rule in rules
    assert "MANDATORY SQL GROUNDING RULES" in rules
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

    assert "ONLY USE table/column alias in the final SELECT clause" in prompt
    assert "Refer to the value of alias from the comment section" in prompt
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


def test_json_field_instructions_do_not_include_placeholder_identifiers():
    prompt = get_json_field_instructions()

    assert "json_fields metadata" in prompt
    assert "Do not copy JSON examples" in prompt
    assert "CREATE TABLE users" not in prompt
    assert "my_table" not in prompt
    assert "parent_table" not in prompt


def test_sql_regeneration_system_prompt_uses_question_as_intent_source():
    prompt = get_sql_regeneration_system_prompt()

    assert "regenerate from the user's question" in prompt
    assert "unsupported identifiers" in prompt
    assert "Use the original SQL query only as non-executable intent context" in prompt
    assert (
        "database schema as the only source of executable table and column identifiers"
        in prompt
    )


def test_sql_correction_system_prompt_discards_invalid_identifier_context():
    prompt = get_sql_correction_system_prompt()

    assert "treat it as the source of intent" in prompt
    assert "Do not copy placeholders" in prompt
    assert "Regenerate a grounded Wren SQL query" in prompt
    assert (
        "Do not preserve a table, column, join, filter, grouping, ordering, or function"
        in prompt
    )


def test_sql_reasoning_prompt_forbids_executable_sql_context():
    prompt = sql_generation_reasoning_system_prompt

    assert "Do not write SQL, possible SQL, sample SQL, assumed SQL" in prompt
    assert "SQL clauses, SQL functions, code blocks, or executable expressions" in prompt
    assert "The reasoning plan is non-executable context" in prompt
