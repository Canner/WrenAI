from src.pipelines.generation.followup_sql_generation import generate_sql_in_followup
from src.pipelines.generation.intent_classification import post_process
from src.pipelines.generation.sql_answer import sql_to_answer_system_prompt
from src.pipelines.generation.utils.sql import get_sql_generation_system_prompt
from src.web.v1.services.ask import AskService


def test_build_validated_ask_result_keeps_legacy_select_flow():
    service = AskService.__new__(AskService)
    result = service._build_validated_ask_result_from_sql(
        'SELECT "dbo_orders"."CustomerName" FROM "dbo_orders"',
        [],
        "show customers",
    )

    assert result is not None
    assert result.sql == 'SELECT "dbo_orders"."CustomerName" FROM "dbo_orders"'


def test_build_validated_ask_result_rejects_non_select_sql():
    service = AskService.__new__(AskService)
    result = service._build_validated_ask_result_from_sql(
        'DELETE FROM "dbo_orders"',
        [],
        "delete customers",
    )

    assert result is None


def test_prompts_enforce_metadata_grounding_and_result_grounded_answers():
    sql_prompt = get_sql_generation_system_prompt()

    assert "exact identifier allowlist" in sql_prompt
    assert "Select columns by business meaning" in sql_prompt
    assert "Do not SUM or AVG string columns" in sql_prompt
    assert "Never say you do not have access" in sql_to_answer_system_prompt
    assert "If Data rows are empty" in sql_to_answer_system_prompt


async def test_followup_sql_generation_uses_current_system_prompt_signature():
    calls = {}

    class Generator:
        async def __call__(self, **kwargs):
            calls.update(kwargs)
            return {"replies": ['{"sql": "SELECT 1"}']}

    result = await generate_sql_in_followup(
        prompt={"prompt": "prompt"},
        generator=Generator(),
        histories=[],
        generator_name="test",
        data_source="mssql",
        sql_knowledge=None,
    )

    assert result[1] == "test"
    assert "current_system_prompt" in calls


def test_analytic_question_with_schema_stays_text_to_sql_without_table_name():
    result = post_process(
        classify_intent={
            "replies": [
                '{"rephrased_question":"What is the average length of emails?",'
                '"reasoning":"Misclassified as guide.",'
                '"results":"USER_GUIDE"}'
            ]
        },
        construct_db_schemas=["CREATE TABLE users (email VARCHAR);"],
        query="What is the average length of emails?",
    )

    assert result["intent"] == "TEXT_TO_SQL"


def test_user_guide_question_stays_user_guide():
    result = post_process(
        classify_intent={
            "replies": [
                '{"rephrased_question":"How can I connect to a database?",'
                '"reasoning":"Wren setup question.",'
                '"results":"USER_GUIDE"}'
            ]
        },
        construct_db_schemas=["CREATE TABLE users (email VARCHAR);"],
        query="How can I connect to a database?",
    )

    assert result["intent"] == "USER_GUIDE"
