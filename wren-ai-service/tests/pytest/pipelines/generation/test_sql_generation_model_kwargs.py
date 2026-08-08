from src.pipelines.generation.utils.sql import SQL_GENERATION_MODEL_KWARGS


def test_sql_generation_model_kwargs_keep_legacy_sql_string_contract():
    assert SQL_GENERATION_MODEL_KWARGS["preserve_json_schema"] is True
    json_schema = SQL_GENERATION_MODEL_KWARGS["response_format"]["json_schema"]
    assert json_schema["strict"] is True
    assert json_schema["schema"]["properties"]["sql"]["type"] == "string"
    assert json_schema["schema"]["additionalProperties"] is False
