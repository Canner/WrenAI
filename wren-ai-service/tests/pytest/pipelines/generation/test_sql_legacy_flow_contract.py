import pytest
from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.followup_sql_generation import (
    generate_sql_in_followup,
    text_to_sql_with_followup_user_prompt_template,
)
from src.pipelines.generation.followup_sql_generation import (
    prompt as build_followup_sql_generation_prompt,
)
from src.pipelines.generation.followup_sql_generation_reasoning import (
    prompt as build_followup_sql_generation_reasoning_prompt,
)
from src.pipelines.generation.followup_sql_generation_reasoning import (
    sql_generation_reasoning_user_prompt_template as followup_reasoning_prompt_template,
)
from src.pipelines.generation.sql_correction import (
    generate_sql_correction,
    get_sql_correction_system_prompt,
    sql_correction_user_prompt_template,
)
from src.pipelines.generation.sql_correction import (
    prompt as build_sql_correction_prompt,
)
from src.pipelines.generation.sql_generation import (
    generate_sql,
    get_sql_generation_system_prompt,
    sql_generation_user_prompt_template,
)
from src.pipelines.generation.sql_generation import (
    prompt as build_sql_generation_prompt,
)
from src.pipelines.generation.sql_generation_reasoning import (
    prompt as build_sql_generation_reasoning_prompt,
)
from src.pipelines.generation.sql_generation_reasoning import (
    sql_generation_reasoning_user_prompt_template,
)
from src.pipelines.generation.sql_regeneration import (
    get_sql_regeneration_system_prompt,
    regenerate_sql,
    sql_regeneration_user_prompt_template,
)
from src.pipelines.generation.sql_regeneration import (
    post_process as sql_regeneration_post_process,
)
from src.pipelines.generation.sql_regeneration import (
    prompt as build_sql_regeneration_prompt,
)
from src.pipelines.generation.utils.sql import SQL_GENERATION_MODEL_KWARGS
from src.pipelines.retrieval.sql_functions import SqlFunction
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge


TEST_PROJECT_ID = "test-project-id"
TEST_MDL_HASH = "test-mdl-hash"
SCHEMA_TABLE_NAME = "dbo_xStageNewOrders"
COUNTRY_COLUMN_NAME = "ShipCountry"
DATE_COLUMN_NAME = "OrderDate"
SAMPLE_TABLE_NAME = "orders"
MODEL_TABLE_NAME = "model_1"
MODEL_COLUMN_NAME = "attribute_1"


def _deployment_scope_kwargs() -> dict[str, str]:
    return {
        "project_id": TEST_PROJECT_ID,
        "mdl_hash": TEST_MDL_HASH,
    }


def _assert_deployment_scope(prompt: str) -> None:
    assert f"Project ID: {TEST_PROJECT_ID}" in prompt
    assert f"MDL Hash: {TEST_MDL_HASH}" in prompt


def _assert_schema_binding_contract(prompt: str) -> None:
    assert "### REQUIRED SCHEMA BINDING BEFORE SQL ###" in prompt
    assert "bind every requested business concept" in prompt
    assert "Do not write SQL from business meaning alone" in prompt or (
        "Do not correct SQL from business meaning alone" in prompt
    ) or (
        "Do not regenerate SQL from business meaning alone" in prompt
    ) or (
        "Do not reason from business meaning alone" in prompt
    )
    assert "Business wording may appear only" in prompt
    assert "copied exactly from VERIFIED SCHEMA OBJECTS" in prompt


def _table_ddl(table_name: str, column_name: str, column_type: str = "VARCHAR") -> str:
    return f"CREATE TABLE {table_name} ({column_name} {column_type})"


def _select_all_sql(table_name: str) -> str:
    return f"SELECT * FROM {table_name}"


def _country_filter_sql(table_name: str) -> str:
    return f"{_select_all_sql(table_name)} WHERE country = 'Taiwan'"


def test_sql_generation_system_prompt_uses_legacy_json_sql_contract():
    prompt = get_sql_generation_system_prompt()

    assert "<SQL_QUERY_STRING>" in prompt
    assert "The final answer must be a ANSI SQL query in JSON format" in prompt
    assert "return null for sql" not in prompt
    assert "RETRIEVED SCHEMA CONTRACT" not in prompt
    assert "SQL samples are not schema authority" in prompt
    assert "non-executable planning context" in prompt


def test_sql_generation_model_kwargs_require_sql_string():
    json_schema = SQL_GENERATION_MODEL_KWARGS["response_format"]["json_schema"]

    assert SQL_GENERATION_MODEL_KWARGS["preserve_json_schema"] is True
    assert json_schema["strict"] is True
    assert json_schema["schema"]["properties"]["sql"]["type"] == "string"
    assert json_schema["schema"]["additionalProperties"] is False


def test_sql_generation_prompt_uses_database_schema_documents():
    result = build_sql_generation_prompt(
        query="show orders from India",
        documents=[_table_ddl(SCHEMA_TABLE_NAME, COUNTRY_COLUMN_NAME)],
        **_deployment_scope_kwargs(),
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_samples=[
            {
                "question": "show orders from Taiwan",
                "sql": _country_filter_sql(SAMPLE_TABLE_NAME),
            }
        ],
    )

    built_prompt = result["prompt"]

    assert f"CREATE TABLE {SCHEMA_TABLE_NAME}" in built_prompt
    assert COUNTRY_COLUMN_NAME in built_prompt
    _assert_deployment_scope(built_prompt)
    assert "Question:\nshow orders from Taiwan" in built_prompt
    assert _select_all_sql(SAMPLE_TABLE_NAME) not in built_prompt
    assert "### VERIFIED SCHEMA OBJECTS ###" in built_prompt
    assert f"- {SCHEMA_TABLE_NAME}: {COUNTRY_COLUMN_NAME}" in built_prompt
    assert "return an empty string for sql" in built_prompt


def test_sql_generation_prompt_preserves_exact_deployed_relation_names():
    result = build_sql_generation_prompt(
        query="show all records",
        documents=[_table_ddl(SCHEMA_TABLE_NAME, COUNTRY_COLUMN_NAME)],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert f"- {SCHEMA_TABLE_NAME}: {COUNTRY_COLUMN_NAME}" in built_prompt
    assert (
        "Do not shorten, singularize, pluralize, lowercase, remove prefixes/suffixes"
        in built_prompt
    )
    assert "plain business noun" in built_prompt


def test_sql_generation_prompt_does_not_inject_datasource_dialect_section():
    result = build_sql_generation_prompt(
        query="show orders from last week",
        documents=[_table_ddl(SCHEMA_TABLE_NAME, DATE_COLUMN_NAME, "TIMESTAMP")],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_functions=[
            SqlFunction(
                {
                    "name": "date_trunc",
                    "function_type": "scalar",
                    "description": "Truncates a timestamp to the specified precision.",
                }
            )
        ],
    )

    built_prompt = result["prompt"]

    assert "### SQL DIALECT ###" not in built_prompt
    assert "Configured data source: trino" not in built_prompt
    assert (
        "type: scalar, name: DATE_TRUNC, description: Truncates a timestamp to the specified precision."
        in built_prompt
    )


def test_reasoning_prompt_uses_schema_documents_only():
    result = build_sql_generation_reasoning_prompt(
        query="show orders from India",
        documents=[_table_ddl(SCHEMA_TABLE_NAME, COUNTRY_COLUMN_NAME)],
        **_deployment_scope_kwargs(),
        sql_samples=[
            {
                "question": "show orders from Taiwan",
                "sql": _country_filter_sql(SAMPLE_TABLE_NAME),
            }
        ],
        instructions=[],
        prompt_builder=PromptBuilder(
            template=sql_generation_reasoning_user_prompt_template
        ),
    )

    built_prompt = result["prompt"]

    assert f"CREATE TABLE {SCHEMA_TABLE_NAME}" in built_prompt
    _assert_deployment_scope(built_prompt)
    assert _select_all_sql(SAMPLE_TABLE_NAME) in built_prompt
    assert "### VERIFIED SCHEMA OBJECTS ###" in built_prompt
    assert f"- {SCHEMA_TABLE_NAME}: {COUNTRY_COLUMN_NAME}" in built_prompt
    _assert_schema_binding_contract(built_prompt)


def test_followup_reasoning_prompt_uses_history_and_schema_documents():
    result = build_followup_sql_generation_reasoning_prompt(
        query="from India",
        documents=[_table_ddl(SCHEMA_TABLE_NAME, COUNTRY_COLUMN_NAME)],
        histories=[
            {
                "question": "show orders",
                "sql": _select_all_sql(SAMPLE_TABLE_NAME),
            }
        ],
        sql_samples=[],
        instructions=[],
        prompt_builder=PromptBuilder(template=followup_reasoning_prompt_template),
    )

    built_prompt = result["prompt"]

    assert f"CREATE TABLE {SCHEMA_TABLE_NAME}" in built_prompt
    assert "Question:\nshow orders" in built_prompt
    assert f"SQL:\n{_select_all_sql(SAMPLE_TABLE_NAME)}" in built_prompt
    assert "### VERIFIED SCHEMA OBJECTS ###" in built_prompt
    assert f"- {SCHEMA_TABLE_NAME}: {COUNTRY_COLUMN_NAME}" in built_prompt


def test_followup_sql_generation_prompt_uses_database_schema_documents():
    result = build_followup_sql_generation_prompt(
        query="show related orders",
        documents=[_table_ddl(SCHEMA_TABLE_NAME, COUNTRY_COLUMN_NAME)],
        sql_generation_reasoning="",
        sql_samples=[
            {
                "summary": "show orders from Taiwan",
                "sql": _country_filter_sql(SAMPLE_TABLE_NAME),
            }
        ],
        prompt_builder=PromptBuilder(
            template=text_to_sql_with_followup_user_prompt_template
        ),
    )

    built_prompt = result["prompt"]

    assert f"CREATE TABLE {SCHEMA_TABLE_NAME}" in built_prompt
    assert "Summary:\nshow orders from Taiwan" in built_prompt
    assert _select_all_sql(SAMPLE_TABLE_NAME) not in built_prompt
    assert "### VERIFIED SCHEMA OBJECTS ###" in built_prompt
    assert f"- {SCHEMA_TABLE_NAME}: {COUNTRY_COLUMN_NAME}" in built_prompt
    _assert_schema_binding_contract(built_prompt)
    assert "return an empty string for sql" in built_prompt


def test_sql_correction_prompt_uses_failed_sql_and_error():
    result = build_sql_correction_prompt(
        documents=[_table_ddl(MODEL_TABLE_NAME, MODEL_COLUMN_NAME)],
        invalid_generation_result={"sql": "SELECT 1", "error": "dry run failed"},
        **_deployment_scope_kwargs(),
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert f"CREATE TABLE {MODEL_TABLE_NAME}" in built_prompt
    _assert_deployment_scope(built_prompt)
    assert "SQL: SELECT 1" in built_prompt
    assert "Error Message: dry run failed" in built_prompt
    assert "### VERIFIED SCHEMA OBJECTS ###" in built_prompt
    assert f"- {MODEL_TABLE_NAME}: {MODEL_COLUMN_NAME}" in built_prompt
    _assert_schema_binding_contract(built_prompt)


def test_sql_correction_prompt_can_include_active_question_and_reasoning():
    result = build_sql_correction_prompt(
        documents=["CREATE TABLE model_1 (attribute_1 VARCHAR)"],
        invalid_generation_result={
            "sql": "SELECT attribute_1 FROM model_1",
            "error": "diagnosed schema issue",
            "execution_error": "dry run failed",
            "question": "show the current request",
            "reasoning_plan": "1. Use table: model_1 and column: model_1.attribute_1",
        },
        prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert "### USER QUESTION ###" in built_prompt
    assert "show the current request" in built_prompt
    assert "### REASONING PLAN ###" in built_prompt
    assert "Execution Error: dry run failed" in built_prompt
    assert "Error Message: diagnosed schema issue" in built_prompt


def test_sql_correction_system_prompt_preserves_datasource_knowledge():
    sql_knowledge = SqlKnowledge(
        {
            "text_to_sql_rule": "Use Wren SQL from the engine.",
            "instructions": {
                "date_and_time_functionality": "Use CAST(<expr> AS DATE) for date casts.",
            },
        }
    )

    prompt = get_sql_correction_system_prompt(sql_knowledge)

    assert "Use Wren SQL from the engine." in prompt


def test_sql_regeneration_prompt_uses_legacy_inputs_without_datasource_dialect():
    result = build_sql_regeneration_prompt(
        documents=[_table_ddl(MODEL_TABLE_NAME, MODEL_COLUMN_NAME)],
        sql_generation_reasoning="reason about the schema",
        sql="SELECT 1",
        prompt_builder=PromptBuilder(template=sql_regeneration_user_prompt_template),
    )

    built_prompt = result["prompt"]

    assert f"CREATE TABLE {MODEL_TABLE_NAME}" in built_prompt
    assert "SQL generation reasoning: reason about the schema" in built_prompt
    assert "Original SQL query: SELECT 1" in built_prompt
    assert "Configured data source: trino" not in built_prompt
    assert "### VERIFIED SCHEMA OBJECTS ###" in built_prompt
    assert f"- {MODEL_TABLE_NAME}: {MODEL_COLUMN_NAME}" in built_prompt
    _assert_schema_binding_contract(built_prompt)


def test_sql_regeneration_system_prompt_uses_json_sql_contract():
    prompt = get_sql_regeneration_system_prompt()

    assert "<SQL_QUERY_STRING>" in prompt
    assert "The final answer must be a ANSI SQL query in JSON format" in prompt


@pytest.mark.asyncio
async def test_sql_regeneration_post_process_preserves_deployment_hash():
    captured = {}

    class CapturingPostProcessor:
        async def run(self, replies, **kwargs):
            captured["replies"] = replies
            captured.update(kwargs)
            return {
                "valid_generation_result": {"sql": "SELECT 1"},
                "invalid_generation_result": {},
            }

    await sql_regeneration_post_process(
        regenerate_sql={"replies": ['{"sql": "SELECT 1"}']},
        post_processor=CapturingPostProcessor(),
        project_id="project-id",
        mdl_hash="deployment-hash",
    )

    assert captured["replies"] == ['{"sql": "SELECT 1"}']
    assert captured["project_id"] == "project-id"
    assert captured["mdl_hash"] == "deployment-hash"


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
