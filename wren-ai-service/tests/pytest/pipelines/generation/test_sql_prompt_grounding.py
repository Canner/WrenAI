import pytest
from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.sql_correction import (
    generate_sql_correction,
    get_sql_correction_system_prompt,
    prompt as build_sql_correction_prompt,
    sql_correction_user_prompt_template,
)
from src.pipelines.generation.followup_sql_generation import (
    generate_sql_in_followup,
    prompt as build_followup_sql_generation_prompt,
    text_to_sql_with_followup_user_prompt_template,
)
from src.pipelines.generation.sql_generation import (
    generate_sql,
    get_sql_generation_system_prompt,
    prompt as build_sql_generation_prompt,
    sql_generation_user_prompt_template,
)
from src.pipelines.generation.sql_generation_reasoning import (
    prompt as build_sql_generation_reasoning_prompt,
    sql_generation_reasoning_user_prompt_template,
)
from src.pipelines.generation.followup_sql_generation_reasoning import (
    prompt as build_followup_sql_generation_reasoning_prompt,
    sql_generation_reasoning_user_prompt_template as followup_reasoning_prompt_template,
)
from src.pipelines.generation.sql_regeneration import (
    regenerate_sql,
    get_sql_regeneration_system_prompt,
    prompt as build_sql_regeneration_prompt,
    sql_regeneration_user_prompt_template,
)
from src.pipelines.generation.utils.sql import (
    SQL_GENERATION_MODEL_KWARGS,
    add_schema_grounding_to_system_prompt,
)
from src.pipelines.generation.utils.sql import sql_generation_reasoning_system_prompt
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge


def test_sql_generation_system_prompt_uses_schema_without_extra_catalog_layer():
    prompt = get_sql_generation_system_prompt()

    assert "generate one grounded Wren SQL query" in prompt
    assert "reasoning plan as non-executable intent context" in prompt
    assert "FOLLOW the reasoning plan step by step strictly" not in prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in prompt
    assert "WREN RETRIEVED SEMANTIC CONTEXT" not in prompt
    assert "return null for sql" not in prompt
    assert 'ONLY USE "*" if the user query asks' in prompt
    assert 'exactly one key named "sql"' in prompt
    assert '"query"' in prompt
    assert "DON'T USE INTERVAL" not in prompt
    assert "Never invent unquoted interval forms such as INTERVAL 7 DAY" in prompt


def test_sql_generation_system_prompt_includes_engine_date_time_knowledge():
    sql_knowledge = SqlKnowledge(
        {
            "text_to_sql_rule": "Use Wren SQL from the engine.",
            "instructions": {
                "date_and_time_functionality": (
                    "Use `CURRENT_DATE` to get the current date.\n"
                    "Use `DATE_TRUNC('<part>', <timestamp>)` to truncate a timestamp.\n"
                    "Use `<date_column> + INTERVAL '7' days` for intervals."
                ),
                "calculated_field_instructions": "calculated field text",
            },
        }
    )

    prompt = get_sql_generation_system_prompt(sql_knowledge)

    assert "### SQL KNOWLEDGE ###" in prompt
    assert "Date And Time Functionality" in prompt
    assert "CURRENT_DATE" in prompt
    assert "DATE_TRUNC" in prompt
    assert "INTERVAL '7' days" in prompt
    assert "calculated field text" not in prompt


def test_schema_grounding_can_be_added_to_system_prompt():
    prompt = add_schema_grounding_to_system_prompt(
        "system prompt",
        '- model/table: "model_1"\n  columns:\n    - "attribute_1"',
    )

    assert "### RETRIEVED SCHEMA CONTRACT ###" in prompt
    assert '- model/table: "model_1"' in prompt
    assert '- "attribute_1"' in prompt
    assert "only executable identifiers retrieved" in prompt


def test_sql_correction_system_prompt_uses_current_schema_for_repair():
    prompt = get_sql_correction_system_prompt()

    assert "fix the syntactically incorrect Wren SQL query" in prompt
    assert "DATABASE SCHEMA" in prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in prompt
    assert 'ONLY USE "*" if the user query asks' in prompt
    assert "return null for sql" not in prompt
    assert 'exactly one key named "sql"' in prompt
    assert '"sql_function"' in prompt


def test_sql_correction_system_prompt_includes_engine_date_time_knowledge():
    sql_knowledge = SqlKnowledge(
        {
            "text_to_sql_rule": "Use Wren SQL from the engine.",
            "instructions": {
                "date_and_time_functionality": "Use CAST(<expr> AS DATE) for date casts.",
            },
        }
    )

    prompt = get_sql_correction_system_prompt(sql_knowledge)

    assert "### SQL KNOWLEDGE ###" in prompt
    assert "CAST(<expr> AS DATE)" in prompt


def test_sql_regeneration_system_prompt_allows_standard_aggregates_without_sql_functions():
    prompt = get_sql_regeneration_system_prompt()

    assert "SQL generation reasoning and an original SQL query" in prompt
    assert 'exactly one key named "sql"' in prompt
    assert "return null for sql" not in prompt


def test_sql_generation_model_kwargs_preserve_structured_output_only():
    assert "max_tokens" not in SQL_GENERATION_MODEL_KWARGS
    assert SQL_GENERATION_MODEL_KWARGS["response_format"]["type"] == "json_schema"


def test_sql_generation_reasoning_maps_business_terms_to_schema_identifiers():
    prompt = sql_generation_reasoning_system_prompt

    assert "copy the exact identifier from the CREATE TABLE or CREATE VIEW statements" in prompt
    assert "Do not convert business terms from the user's wording" in prompt
    assert "explicitly map it to the exact DATABASE SCHEMA identifier" in prompt


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "generate_fn,extra_kwargs",
    [
        (generate_sql, {}),
        (generate_sql_in_followup, {"histories": []}),
        (generate_sql_correction, {}),
        (regenerate_sql, {}),
    ],
)
async def test_sql_generation_calls_do_not_inject_runtime_output_budget(
    generate_fn,
    extra_kwargs,
):
    captured_kwargs = {}

    async def fake_generator(**kwargs):
        captured_kwargs.update(kwargs)
        return {"replies": ['{"sql": "SELECT 1"}'], "meta": [{"finish_reason": "stop"}]}

    await generate_fn(
        prompt={"prompt": "Return SQL"},
        generator=fake_generator,
        generator_name="test-model",
        **extra_kwargs,
    )

    assert "generation_kwargs" not in captured_kwargs


def test_sql_generation_prompt_omits_sample_sql_body():
    result = build_sql_generation_prompt(
        query="show orders from India",
        documents=['CREATE TABLE dbo_xStageNewOrders (ShipCountry VARCHAR)'],
        schema_grounding='- model/table: "dbo_xStageNewOrders"\n  columns:\n    - "ShipCountry"',
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_samples=[
            {
                "question": "show orders from Taiwan",
                "sql": "SELECT * FROM orders WHERE country = 'Taiwan'",
            }
        ],
    )

    built_prompt = result["prompt"]

    assert "show orders from Taiwan" in built_prompt
    assert "SELECT * FROM orders" not in built_prompt
    assert "WHERE country" not in built_prompt
    assert "confirmed question examples for this project deployment" in built_prompt
    assert "RETRIEVED EXECUTABLE SCHEMA" in built_prompt
    assert '- model/table: "dbo_xStageNewOrders"' in built_prompt
    assert '- "ShipCountry"' in built_prompt
    assert "Use DATABASE SCHEMA and RETRIEVED EXECUTABLE SCHEMA" in built_prompt
    assert "Return only the final JSON SQL response" in built_prompt
    assert "Let's think step by step" not in built_prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in built_prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in built_prompt


def test_sql_generation_prompt_includes_configured_dialect_and_functions():
    result = build_sql_generation_prompt(
        query="show orders from last week",
        documents=['CREATE TABLE dbo_xStageNewOrders (OrderDate TIMESTAMP)'],
        schema_grounding=(
            '- model/table: "dbo_xStageNewOrders"\n'
            "  columns:\n"
            '    - "OrderDate"'
        ),
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_functions=[
            SqlFunction(
                {
                    "name": "date_trunc",
                    "param_types": ["varchar", "timestamp"],
                    "return_type": "timestamp",
                }
            ),
            SqlFunction(
                {
                    "name": "current_date",
                    "param_types": [],
                    "return_type": "date",
                }
            ),
        ],
        data_source="trino",
    )

    built_prompt = result["prompt"]

    assert "### SQL DIALECT ###" in built_prompt
    assert "Configured data source: trino" in built_prompt
    assert "date_trunc($0: varchar, $1: timestamp) -> timestamp" in built_prompt
    assert "current_date(any) -> date" in built_prompt
    assert "Do not use a function, cast style, interval literal" in built_prompt


def test_sql_generation_reasoning_prompt_omits_sample_sql_body():
    result = build_sql_generation_reasoning_prompt(
        query="show orders from India",
        documents=['CREATE TABLE dbo_xStageNewOrders (ShipCountry VARCHAR)'],
        schema_grounding='- model/table: "dbo_xStageNewOrders"\n  columns:\n    - "ShipCountry"',
        sql_samples=[
            {
                "question": "show orders from Taiwan",
                "sql": "SELECT * FROM orders WHERE country = 'Taiwan'",
            }
        ],
        instructions=[],
        prompt_builder=PromptBuilder(
            template=sql_generation_reasoning_user_prompt_template
        ),
    )

    built_prompt = result["prompt"]

    assert "show orders from Taiwan" in built_prompt
    assert "SELECT * FROM orders" not in built_prompt
    assert "WHERE country" not in built_prompt
    assert "confirmed question examples for this project deployment" in built_prompt
    assert "dbo_xStageNewOrders" in built_prompt
    assert "ShipCountry" in built_prompt


def test_followup_sql_generation_reasoning_prompt_omits_sample_and_history_sql():
    result = build_followup_sql_generation_reasoning_prompt(
        query="from India",
        documents=['CREATE TABLE dbo_xStageNewOrders (ShipCountry VARCHAR)'],
        schema_grounding='- model/table: "dbo_xStageNewOrders"\n  columns:\n    - "ShipCountry"',
        histories=[
            {
                "question": "show orders",
                "sql": "SELECT * FROM orders",
            }
        ],
        sql_samples=[
            {
                "question": "show orders from Taiwan",
                "sql": "SELECT * FROM orders WHERE country = 'Taiwan'",
            }
        ],
        instructions=[],
        prompt_builder=PromptBuilder(template=followup_reasoning_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "show orders" in built_prompt
    assert "show orders from Taiwan" in built_prompt
    assert "SELECT * FROM orders" not in built_prompt
    assert "WHERE country" not in built_prompt
    assert "dbo_xStageNewOrders" in built_prompt
    assert "ShipCountry" in built_prompt


def test_followup_sql_generation_prompt_uses_retrieved_schema_context():
    result = build_followup_sql_generation_prompt(
        query="show related orders",
        documents=["CREATE TABLE dbo_xStageNewOrders (ShipCountry VARCHAR)"],
        schema_grounding='- model/table: "dbo_xStageNewOrders"\n  columns:\n    - "ShipCountry"',
        sql_generation_reasoning="",
        sql_samples=[
            {
                "summary": "show orders from Taiwan",
                "sql": "SELECT * FROM orders WHERE country = 'Taiwan'",
            }
        ],
        prompt_builder=PromptBuilder(
            template=text_to_sql_with_followup_user_prompt_template
        ),
    )

    built_prompt = result["prompt"]

    assert "CREATE TABLE dbo_xStageNewOrders" in built_prompt
    assert "RETRIEVED EXECUTABLE SCHEMA" in built_prompt
    assert '- model/table: "dbo_xStageNewOrders"' in built_prompt
    assert "SELECT * FROM orders" not in built_prompt
    assert "WHERE country" not in built_prompt
    assert "confirmed question examples for this project deployment" in built_prompt
    assert "Return only the final JSON SQL response" in built_prompt
    assert "Let's think step by step" not in built_prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in built_prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in built_prompt


def test_sql_correction_prompt_uses_failed_sql_with_user_question():
    result = build_sql_correction_prompt(
        documents=[],
        schema_grounding='- model/table: "model_1"\n  columns:\n    - "attribute_1"',
        invalid_generation_result={
            "sql": "SELECT 1",
            "error": "dry run failed",
        },
        query="summarize model records",
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "User's Question: summarize model records" in built_prompt
    assert "SQL: SELECT 1" in built_prompt
    assert "Error Message: dry run failed" in built_prompt
    assert "RETRIEVED EXECUTABLE SCHEMA" in built_prompt
    assert '- model/table: "model_1"' in built_prompt
    assert "Use DATABASE SCHEMA and RETRIEVED EXECUTABLE SCHEMA" in built_prompt
    assert "Return only the final JSON SQL response" in built_prompt
    assert "Let's think step by step" not in built_prompt
    assert "DIAGNOSTIC CONTEXT" not in built_prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in built_prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in built_prompt


def test_sql_correction_prompt_includes_configured_dialect_for_date_repair():
    result = build_sql_correction_prompt(
        documents=["CREATE TABLE dbo_xStageNewOrders (OrderDate TIMESTAMP)"],
        schema_grounding=(
            '- model/table: "dbo_xStageNewOrders"\n'
            "  columns:\n"
            '    - "OrderDate"'
        ),
        invalid_generation_result={
            "sql": (
                'SELECT * FROM "dbo_xStageNewOrders" '
                'WHERE "OrderDate" >= DATE(NOW()) - INTERVAL 7 DAY'
            ),
            "error": "mismatched input '7'",
        },
        query="show orders from last week",
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
        sql_functions=[
            SqlFunction(
                {
                    "name": "date_trunc",
                    "param_types": ["varchar", "timestamp"],
                    "return_type": "timestamp",
                }
            )
        ],
        data_source="trino",
    )

    built_prompt = result["prompt"]

    assert "Configured data source: trino" in built_prompt
    assert "DATE(NOW()) - INTERVAL 7 DAY" in built_prompt
    assert "Do not preserve unsupported functions" in built_prompt


def test_sql_correction_prompt_omits_rejected_sql_for_schema_grounding():
    result = build_sql_correction_prompt(
        documents=["CREATE TABLE model_1 (attribute_1 VARCHAR)"],
        schema_grounding='- model/table: "model_1"\n  columns:\n    - "attribute_1"',
        invalid_generation_result={
            "sql": "SELECT * FROM hallucinated_table",
            "type": "SCHEMA_GROUNDING",
            "error": (
                "Generated SQL references model/table identifiers that are not in "
                "the retrieved Wren schema."
            ),
        },
        query="show records",
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "Validation Type: SCHEMA_GROUNDING" in built_prompt
    assert "Rejected SQL: omitted" in built_prompt
    assert "SELECT * FROM hallucinated_table" not in built_prompt
    assert "regenerate the SQL from the user's question and retrieved schema" in built_prompt


def test_sql_regeneration_prompt_omits_sample_sql_body():
    result = build_sql_regeneration_prompt(
        query="summarize model records",
        documents=["CREATE TABLE model_1 (attribute_1 VARCHAR)"],
        sql_generation_reasoning="",
        sql="SELECT 1",
        sql_samples=[
            {
                "question": "show orders from Taiwan",
                "sql": "SELECT * FROM orders WHERE country = 'Taiwan'",
            }
        ],
        data_source="trino",
        prompt_builder=PromptBuilder(template=sql_regeneration_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "CREATE TABLE model_1" in built_prompt
    assert "User's Question: summarize model records" in built_prompt
    assert "Original SQL query: SELECT 1" in built_prompt
    assert "SELECT * FROM orders" not in built_prompt
    assert "WHERE country" not in built_prompt
    assert "confirmed question examples for this project deployment" in built_prompt
    assert "Configured data source: trino" in built_prompt
    assert "dry-plans and dry-runs successfully" in built_prompt
    assert "Use DATABASE SCHEMA and RETRIEVED EXECUTABLE SCHEMA" in built_prompt
    assert "Return only the final JSON SQL response" in built_prompt
    assert "Let's think step by step" not in built_prompt
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" not in built_prompt
    assert "WREN SQL IDENTIFIER CONTRACT" not in built_prompt
