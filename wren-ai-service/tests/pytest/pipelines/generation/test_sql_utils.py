from src.pipelines.generation.utils.sql import (
    construct_instructions,
    get_json_field_instructions,
    get_metric_instructions,
    get_sql_generation_system_prompt,
    get_text_to_sql_rules,
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


def test_sql_regeneration_system_prompt_uses_question_as_intent_source():
    prompt = get_sql_regeneration_system_prompt()

    assert "regenerate from the user's question" in prompt
    assert "unsupported identifiers" in prompt


def test_sql_correction_system_prompt_discards_invalid_identifier_context():
    prompt = get_sql_correction_system_prompt()

    assert "treat it as the source of intent" in prompt
    assert "Do not copy placeholders" in prompt
