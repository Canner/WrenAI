from src.pipelines.generation.utils.sql import (
    construct_instructions,
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

    assert "ONLY USE table/column alias in the final SELECT clause" in prompt
    assert "Refer to the value of alias from the comment section" in prompt
    assert 'SELECT "_orders"."ApprovedTimestamp" AS "_timestamp"' in prompt
