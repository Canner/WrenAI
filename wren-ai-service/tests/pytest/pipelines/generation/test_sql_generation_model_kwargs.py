from types import SimpleNamespace

from src.pipelines.generation.utils.sql import (
    SQL_GENERATION_MODEL_KWARGS,
    get_sql_generation_model_kwargs,
)


def test_sql_generation_model_kwargs_preserves_schema_mode_when_text_configured():
    provider = SimpleNamespace(
        get_model_kwargs=lambda: {"response_format": {"type": "text"}}
    )

    assert get_sql_generation_model_kwargs(provider) == SQL_GENERATION_MODEL_KWARGS


def test_sql_generation_model_kwargs_keeps_schema_mode_by_default():
    provider = SimpleNamespace(get_model_kwargs=lambda: {})

    assert get_sql_generation_model_kwargs(provider) == SQL_GENERATION_MODEL_KWARGS
    assert SQL_GENERATION_MODEL_KWARGS["preserve_json_schema"] is True
    json_schema = SQL_GENERATION_MODEL_KWARGS["response_format"]["json_schema"]
    assert json_schema["strict"] is True
    assert json_schema["schema"]["properties"]["sql"]["type"] == "string"
    assert json_schema["schema"]["additionalProperties"] is False
