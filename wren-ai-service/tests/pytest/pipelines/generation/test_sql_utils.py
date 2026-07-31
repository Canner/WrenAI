import pytest
from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.utils.sql import (
    SQL_GENERATION_MODEL_KWARGS,
    SQLGenPostProcessor,
    construct_ask_history_messages,
    construct_executable_identifier_catalog,
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
from src.pipelines.generation.sql_answer import sql_to_answer_system_prompt
from src.pipelines.generation.sql_generation import sql_generation_user_prompt_template
from src.pipelines.generation.sql_regeneration import get_sql_regeneration_system_prompt
from src.pipelines.generation.sql_regeneration import sql_regeneration_user_prompt_template


class _SqlKnowledge:
    text_to_sql_rule = "Use the supplied model context only."
    metric_instructions = "Use the supplied metric definitions only."
    json_field_instructions = "Use the supplied JSON field definitions only."


class _DryPlanEngine:
    def __init__(self):
        self.dry_plan_calls = []
        self.execute_sql_calls = []

    async def dry_plan(self, *args, **kwargs):
        self.dry_plan_calls.append((args, kwargs))
        return True, ""

    async def execute_sql(self, *args, **kwargs):
        self.execute_sql_calls.append((args, kwargs))
        return True, {}, {"correlation_id": "correlation-id"}


@pytest.mark.asyncio
async def test_sql_postprocessor_validates_with_dry_plan_then_dry_run():
    engine = _DryPlanEngine()

    result = await SQLGenPostProcessor(engine).run(
        replies=["SELECT 1"],
        project_id="project-id",
        use_dry_plan=True,
        allow_dry_plan_fallback=False,
        data_source="source",
    )

    assert result["valid_generation_result"]["sql"] == "SELECT 1"
    assert result["valid_generation_result"]["correlation_id"] == "correlation-id"
    assert engine.dry_plan_calls[0][1]["project_id"] == "project-id"
    assert engine.dry_plan_calls[0][1]["allow_fallback"] is False
    assert engine.execute_sql_calls[0][1]["project_id"] == "project-id"
    assert engine.execute_sql_calls[0][1]["dry_run"] is True


class _FailingDryPlanEngine:
    async def dry_plan(self, *args, **kwargs):
        return False, "planner failed"


class _FailingDryRunAfterDryPlanEngine:
    async def dry_plan(self, *args, **kwargs):
        return True, ""

    async def execute_sql(self, *args, **kwargs):
        return False, {}, {"error_message": "dry run failed"}


@pytest.mark.asyncio
async def test_sql_postprocessor_returns_original_sql_when_dry_plan_fails():
    result = await SQLGenPostProcessor(_FailingDryPlanEngine()).run(
        replies=["SELECT 1"],
        use_dry_plan=True,
        data_source="source",
    )

    assert result["invalid_generation_result"]["sql"] == "SELECT 1"
    assert result["invalid_generation_result"]["original_sql"] == "SELECT 1"
    assert result["invalid_generation_result"]["type"] == "DRY_PLAN"


@pytest.mark.asyncio
async def test_sql_postprocessor_does_not_keep_valid_result_when_dry_run_fails():
    result = await SQLGenPostProcessor(_FailingDryRunAfterDryPlanEngine()).run(
        replies=["SELECT 1"],
        use_dry_plan=True,
        data_source="source",
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["sql"] == "SELECT 1"
    assert result["invalid_generation_result"]["original_sql"] == "SELECT 1"
    assert result["invalid_generation_result"]["type"] == "DRY_RUN"


@pytest.mark.asyncio
async def test_sql_postprocessor_rejects_null_sql_generation_result():
    result = await SQLGenPostProcessor(_DryPlanEngine()).run(
        replies=['{"sql": null}'],
        use_dry_plan=True,
        data_source="source",
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "NO_RELEVANT_SQL"
    assert result["invalid_generation_result"]["sql"] == ""


@pytest.mark.asyncio
async def test_sql_postprocessor_rejects_table_outside_retrieved_manifest():
    engine = _DryPlanEngine()

    result = await SQLGenPostProcessor(engine).run(
        replies=['{"sql": "SELECT \\"AvailableField\\" FROM \\"UnretrievedObject\\""}'],
        use_dry_plan=True,
        data_source="source",
        schema_manifest={"RetrievedObject": ["AvailableField"]},
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "MANIFEST_GROUNDING"
    assert "UnretrievedObject" in result["invalid_generation_result"]["error"]
    assert engine.dry_plan_calls == []
    assert engine.execute_sql_calls == []


@pytest.mark.asyncio
async def test_sql_postprocessor_rejects_column_outside_retrieved_manifest():
    engine = _DryPlanEngine()

    result = await SQLGenPostProcessor(engine).run(
        replies=['{"sql": "SELECT \\"UnretrievedField\\" FROM \\"RetrievedObject\\""}'],
        use_dry_plan=True,
        data_source="source",
        schema_manifest={"RetrievedObject": ["AvailableField"]},
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "MANIFEST_GROUNDING"
    assert "UnretrievedField" in result["invalid_generation_result"]["error"]
    assert "RetrievedObject" in result["invalid_generation_result"]["error"]
    assert engine.dry_plan_calls == []
    assert engine.execute_sql_calls == []


@pytest.mark.asyncio
async def test_sql_postprocessor_rejects_filter_column_outside_retrieved_manifest():
    engine = _DryPlanEngine()

    result = await SQLGenPostProcessor(engine).run(
        replies=[
            (
                '{"sql": "SELECT * FROM \\"RetrievedObject\\" '
                'WHERE \\"UnretrievedDate\\" >= CURRENT_DATE"}'
            )
        ],
        use_dry_plan=True,
        data_source="source",
        schema_manifest={"RetrievedObject": ["AvailableField"]},
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "MANIFEST_GROUNDING"
    assert engine.dry_plan_calls == []
    assert engine.execute_sql_calls == []


@pytest.mark.asyncio
async def test_sql_postprocessor_rejects_function_argument_column_outside_manifest():
    engine = _DryPlanEngine()

    result = await SQLGenPostProcessor(engine).run(
        replies=[
            (
                '{"sql": "SELECT * FROM \\"RetrievedObject\\" '
                "WHERE DATE_TRUNC('month', \\\"UnretrievedDate\\\") = CURRENT_DATE\"}"
            )
        ],
        use_dry_plan=True,
        data_source="source",
        schema_manifest={"RetrievedObject": ["AvailableField"]},
    )

    assert result["valid_generation_result"] == {}
    assert result["invalid_generation_result"]["type"] == "MANIFEST_GROUNDING"
    assert engine.dry_plan_calls == []
    assert engine.execute_sql_calls == []


@pytest.mark.asyncio
async def test_sql_postprocessor_allows_exact_retrieved_manifest_identifiers():
    engine = _DryPlanEngine()

    result = await SQLGenPostProcessor(engine).run(
        replies=[
            (
                '{"sql": "SELECT SUM(\\"AvailableField\\") AS \\"TotalField\\" '
                'FROM \\"RetrievedObject\\""}'
            )
        ],
        use_dry_plan=True,
        data_source="source",
        schema_manifest={"RetrievedObject": ["AvailableField"]},
    )

    assert result["valid_generation_result"]["sql"] == (
        'SELECT SUM("AvailableField") AS "TotalField" FROM "RetrievedObject"'
    )
    assert len(engine.dry_plan_calls) == 1
    assert len(engine.execute_sql_calls) == 1


@pytest.mark.asyncio
async def test_sql_postprocessor_validates_join_predicate_columns():
    engine = _DryPlanEngine()

    result = await SQLGenPostProcessor(engine).run(
        replies=[
            (
                '{"sql": "SELECT a.\\"AvailableField\\" FROM \\"RetrievedObject\\" a '
                'JOIN \\"RelatedObject\\" b ON a.\\"JoinField\\" = b.\\"JoinField\\""}'
            )
        ],
        use_dry_plan=True,
        data_source="source",
        schema_manifest={
            "RetrievedObject": ["AvailableField", "JoinField"],
            "RelatedObject": ["JoinField"],
        },
    )

    assert result["valid_generation_result"]["sql"] == (
        'SELECT a."AvailableField" FROM "RetrievedObject" a JOIN '
        '"RelatedObject" b ON a."JoinField" = b."JoinField"'
    )
    assert len(engine.dry_plan_calls) == 1
    assert len(engine.execute_sql_calls) == 1


def test_construct_instructions_uses_instruction_text():
    assert construct_instructions(
        [{"instruction": "First rule."}, {"instruction": "Second rule."}]
    ) == ["First rule.", "Second rule."]


def test_construct_ask_history_messages_omits_executable_history_context():
    histories = [
        {
            "question": "previous natural language request",
            "sql": "SELECT * FROM previous_model",
        }
    ]

    assert construct_ask_history_messages(histories) == []


def test_get_text_to_sql_rules_uses_default_metadata_grounding_rules():
    rules = get_text_to_sql_rules()

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
    assert "WREN RETRIEVED SEMANTIC CONTEXT" in rules
    assert "WREN SQL IDENTIFIER CONTRACT" in rules
    assert "compact authoritative list of executable identifiers" in rules
    assert "sql_table_name_use_exactly" in rules
    assert "sql_column_name_use_exactly" in rules
    assert "semantic_context_not_sql_identifier" in rules
    assert "Do not combine words, labels, ordinals" in rules
    assert "Never generate placeholder identifiers" in rules
    assert "Never create an identifier from user question wording" in rules
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
    assert "combining separate result rows with UNION ALL" in rules
    assert "independently valid from DATABASE SCHEMA" in rules
    assert "do not translate it into a generic object name" in rules
    assert "return null for sql instead of producing an approximate query" in rules
    assert "If that field is required to answer the request, return null for sql" in rules
    assert "A retrieved object is usable only when" in rules
    assert "Generate Wren SQL syntax only" in rules
    assert "Never use SELECT TOP" in rules
    assert "square-bracket identifiers" in rules
    assert "Preserve every deployed table and column identifier exactly" in rules
    assert "Do not convert deployed identifiers into display-friendly variants" in rules


def test_get_text_to_sql_rules_keeps_mandatory_rules_with_sql_knowledge():
    rules = get_text_to_sql_rules(_SqlKnowledge())

    assert _SqlKnowledge.text_to_sql_rule in rules
    assert "MANDATORY SQL GROUNDING RULES" in rules
    assert "Every table and column referenced" in rules
    assert "Do not query INFORMATION_SCHEMA" in rules


def test_sql_generation_schema_allows_null_when_sql_cannot_be_grounded():
    schema = SQL_GENERATION_MODEL_KWARGS["response_format"]["json_schema"]["schema"]

    assert {"type": "null"} in schema["properties"]["sql"]["anyOf"]


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
    assert "return null for sql" in prompt
    assert "Do not create table or column identifiers from the user's wording" in prompt
    assert "DATABASE SCHEMA is the only source of executable identifiers" in prompt
    assert "reasoning plan as semantic context for intent only" in prompt
    assert "Do not copy identifiers, functions, literal values" in prompt
    assert "include those objects only when DATABASE SCHEMA shows" in prompt
    assert "Use the exact supported syntax shown there" in prompt
    assert "WREN SQL IDENTIFIER CONTRACT" in prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" in prompt
    assert "first and clearest list of allowed executable identifiers" in prompt
    assert "Use sql_table_name_use_exactly" in prompt
    assert "sql_column_names_use_exactly" in prompt
    assert "semantic_context_not_sql_identifiers" in prompt
    assert "Use Wren SQL identifier quoting with double quotes only" in prompt
    assert "source database/schema/table names" in prompt
    assert "appears only in SQL samples, failed SQL" in prompt
    assert "retrieved schema does not ground the requested subject" in prompt
    assert "If any planned SQL identifier cannot be copied exactly" in prompt
    assert "Never create a table or column from the user's wording" in prompt
    assert "<SQL_QUERY_STRING>" not in prompt


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
    assert "original SQL query" in prompt
    assert "intentionally omitted" in prompt
    assert (
        "database schema as the only source of executable table and column identifiers"
        in prompt
    )
    assert "Treat physical/source/lineage names from the original SQL" in prompt


def test_sql_correction_system_prompt_discards_invalid_identifier_context():
    prompt = get_sql_correction_system_prompt()

    assert "treat it as the source of intent" in prompt
    assert "Do not copy placeholders" in prompt
    assert "Regenerate a grounded Wren SQL query" in prompt
    assert "Wren SQL expert" in prompt
    assert "syntactically correct Wren SQL query" in prompt
    assert (
        "Do not preserve a table, column, join, filter, grouping, ordering, or function"
        in prompt
    )
    assert "Treat physical/source/lineage names from the failed SQL" in prompt
    assert "do not try a similar replacement from source metadata" in prompt
    assert "connector-specific syntax" in prompt
    assert "return null for sql instead of substituting non-schema identifiers" in prompt


def test_sql_generation_prompt_requires_schema_object_selection_before_sql():
    prompt = get_sql_generation_system_prompt()

    assert "Read every retrieved DATABASE SCHEMA object before choosing" in prompt
    assert "Retrieval rank only lists candidates" in prompt
    assert "Do not default to the first retrieved object" in prompt
    assert "declared fields support the user's requested subject" in prompt


def test_sql_generation_prompt_treats_identifiers_as_indivisible_strings():
    prompt = get_sql_generation_system_prompt()

    assert "Treat every declared table and column identifier as an indivisible string" in prompt
    assert "Never splice, recombine, or transfer prefixes" in prompt
    assert "copy the entire identifier exactly as declared" in prompt
    assert "Do not rebuild it from the business meaning" in prompt


def test_construct_executable_identifier_catalog_lists_manifest_identifiers():
    catalog = construct_executable_identifier_catalog(
        {"ObjectA": ["FieldA", "FieldB"], "ObjectB": ["FieldC"]}
    )

    assert "EXECUTABLE WREN IDENTIFIER CATALOG" in catalog
    assert 'Table: "ObjectA"' in catalog
    assert '- "FieldA"' in catalog
    assert 'Table: "ObjectB"' in catalog
    assert "Copy identifiers exactly as written here" in catalog


def test_sql_generation_prompt_can_include_executable_identifier_catalog():
    catalog = construct_executable_identifier_catalog({"ObjectA": ["FieldA"]})
    prompt = PromptBuilder(template=sql_generation_user_prompt_template).run(
        query="Question",
        documents=["SCHEMA_CONTEXT"],
        executable_identifier_catalog=catalog,
        sql_generation_reasoning=None,
        instructions=[],
        calculated_field_instructions="",
        metric_instructions="",
        json_field_instructions="",
        sql_samples=[],
        sql_functions=[],
    )["prompt"]

    assert "SCHEMA_CONTEXT" in prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" in prompt
    assert 'Table: "ObjectA"' in prompt
    assert '- "FieldA"' in prompt


def test_sql_correction_prompt_includes_manifest_grounding_failure():
    prompt = PromptBuilder(template=sql_correction_user_prompt_template).run(
        query="Question",
        documents=["SCHEMA_CONTEXT"],
        invalid_generation_result={
            "type": "MANIFEST_GROUNDING",
            "error": (
                "Generated SQL references column `RejectedField` outside the "
                "retrieved Wren schema for table `RetrievedObject`."
            ),
        },
        sql_generation_reasoning=None,
        instructions=[],
        sql_functions=[],
    )["prompt"]

    assert "MANIFEST GROUNDING FAILURE" in prompt
    assert "RejectedField" in prompt
    assert "RetrievedObject" in prompt
    assert "Do not reuse rejected identifiers" in prompt


def test_sql_reasoning_prompt_keeps_reasoning_non_executable():
    prompt = sql_generation_reasoning_system_prompt

    assert "Do not write SQL, possible SQL, sample SQL, assumed SQL" in prompt
    assert "SQL clauses, SQL functions, code blocks, or executable expressions" in prompt
    assert "literal prefix `table:`" in prompt
    assert "literal prefix `column:`" in prompt
    assert "reasoning plan is semantic context for intent only" in prompt
    assert "declared in DATABASE SCHEMA or WREN SQL IDENTIFIER CONTRACT" in prompt
    assert "source names, physical names, lineage names" in prompt
    assert 'Do not use the words "assume", "assuming", "likely"' in prompt
    assert "retrieved metadata does not support that part" in prompt
    assert "Do not propose a replacement name" in prompt
    assert "Do not write table names or column names from the user's wording" in prompt
    assert "Do not include code blocks, inline SQL fragments" in prompt
    assert "<table_name>" not in prompt
    assert "<column_name>" not in prompt


def test_user_prompt_templates_keep_source_metadata_non_executable():
    for prompt in (
        sql_generation_user_prompt_template,
        text_to_sql_with_followup_user_prompt_template,
        sql_regeneration_user_prompt_template,
        sql_correction_user_prompt_template,
    ):
        assert "source/physical/lineage names" in prompt
        assert "return null for sql instead of inventing" in prompt
        assert "exact declared table and column names from DATABASE SCHEMA" in prompt
        assert "user question words" in prompt
        assert "return null for sql instead of querying an unrelated object" in prompt


def test_followup_sql_prompt_does_not_expect_previous_sql_context():
    assert "previous SQL query" not in text_to_sql_with_followup_user_prompt_template
    assert "current retrieved DATABASE SCHEMA" in (
        text_to_sql_with_followup_user_prompt_template
    )


def test_sql_answer_prompt_uses_only_returned_data_rows():
    assert "Use only the columns and rows provided in Data" in sql_to_answer_system_prompt
    assert "Do not invent, duplicate, reorder, aggregate, rank, or label rows" in (
        sql_to_answer_system_prompt
    )
    assert "summarize those exact aggregate rows" in sql_to_answer_system_prompt
    assert "If the Data is empty" in sql_to_answer_system_prompt


def test_executable_prompt_templates_omit_untrusted_reasoning_and_sql_context():
    reasoning_marker = "UNTRUSTED_REASONING_CONTEXT_MARKER"
    diagnostic_marker = "UNTRUSTED_DIAGNOSTIC_CONTEXT_MARKER"
    original_sql_marker = "UNTRUSTED_ORIGINAL_SQL_MARKER"

    generation_prompt = PromptBuilder(template=sql_generation_user_prompt_template).run(
        query="Question",
        documents=["SCHEMA_CONTEXT"],
        sql_generation_reasoning=reasoning_marker,
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
        sql_generation_reasoning=reasoning_marker,
        instructions=[],
        calculated_field_instructions="",
        metric_instructions="",
        json_field_instructions="",
        sql_samples=[],
        sql_functions=[],
    )["prompt"]

    correction_prompt = PromptBuilder(template=sql_correction_user_prompt_template).run(
        query="Question",
        documents=["SCHEMA_CONTEXT"],
        invalid_generation_result={"error": diagnostic_marker},
        sql_generation_reasoning=reasoning_marker,
        instructions=[],
        sql_functions=[],
    )["prompt"]

    regeneration_prompt = PromptBuilder(
        template=sql_regeneration_user_prompt_template
    ).run(
        query="Question",
        sql=original_sql_marker,
        documents=["SCHEMA_CONTEXT"],
        sql_generation_reasoning=reasoning_marker,
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
        correction_prompt,
        regeneration_prompt,
    ):
        assert reasoning_marker not in prompt
        assert "REASONING PLAN" not in prompt
        assert "<SQL_QUERY_STRING>" not in prompt
        assert "<CORRECTED_SQL_QUERY_STRING>" not in prompt

    assert original_sql_marker not in regeneration_prompt
    assert "original SQL is intentionally omitted" in regeneration_prompt
    assert diagnostic_marker not in correction_prompt
    assert "dry-run diagnostic text is intentionally omitted" in (
        correction_prompt
    )
    assert (
        "Regenerate from the user question and current DATABASE SCHEMA or "
        "EXECUTABLE WREN IDENTIFIER CATALOG only"
    ) in correction_prompt
