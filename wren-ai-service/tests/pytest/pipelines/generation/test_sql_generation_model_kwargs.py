from types import SimpleNamespace

from src.pipelines.generation.utils.sql import (
    SQL_GENERATION_MODEL_KWARGS,
    get_sql_generation_model_kwargs,
)


def test_sql_generation_model_kwargs_uses_text_mode_when_configured():
    provider = SimpleNamespace(
        get_model_kwargs=lambda: {"response_format": {"type": "text"}}
    )

    assert get_sql_generation_model_kwargs(provider) == {}


def test_sql_generation_model_kwargs_keeps_schema_mode_by_default():
    provider = SimpleNamespace(get_model_kwargs=lambda: {})

    assert get_sql_generation_model_kwargs(provider) == SQL_GENERATION_MODEL_KWARGS
