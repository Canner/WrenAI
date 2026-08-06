from types import SimpleNamespace

import pytest

from src.providers.llm.litellm import LitellmLLMProvider


@pytest.mark.asyncio
async def test_model_kwargs_override_component_generation_defaults(mocker):
    captured_kwargs = {}

    async def fake_acompletion(**kwargs):
        captured_kwargs.update(kwargs)
        return SimpleNamespace(
            model="test-model",
            choices=[
                SimpleNamespace(
                    index=0,
                    finish_reason="stop",
                    message=SimpleNamespace(content='{"sql": null}'),
                )
            ],
        )

    mocker.patch("src.providers.llm.litellm.acompletion", side_effect=fake_acompletion)

    provider = LitellmLLMProvider(
        model="test-model",
        api_base="https://api.openai.com/v1",
        kwargs={
            "temperature": 1,
            "max_tokens": 2048,
            "response_format": {"type": "text"},
        },
    )

    generator = provider.get_generator(
        generation_kwargs={
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "result", "schema": {}},
            },
        }
    )

    await generator(prompt="Return SQL")

    assert captured_kwargs["temperature"] == 1
    assert captured_kwargs["max_tokens"] == 2048
    assert "response_format" not in captured_kwargs


@pytest.mark.asyncio
async def test_runtime_generation_kwargs_override_model_defaults(mocker):
    captured_kwargs = {}

    async def fake_acompletion(**kwargs):
        captured_kwargs.update(kwargs)
        return SimpleNamespace(
            model="test-model",
            choices=[
                SimpleNamespace(
                    index=0,
                    finish_reason="stop",
                    message=SimpleNamespace(content='{"sql": null}'),
                )
            ],
        )

    mocker.patch("src.providers.llm.litellm.acompletion", side_effect=fake_acompletion)

    provider = LitellmLLMProvider(
        model="test-model",
        api_base="https://api.openai.com/v1",
        kwargs={"temperature": 1},
    )

    generator = provider.get_generator(generation_kwargs={"temperature": 0.5})

    await generator(prompt="Return SQL", generation_kwargs={"temperature": 0})

    assert captured_kwargs["temperature"] == 0


@pytest.mark.asyncio
async def test_local_openai_compatible_endpoint_drops_component_json_schema_by_default(
    mocker,
):
    captured_kwargs = {}

    async def fake_acompletion(**kwargs):
        captured_kwargs.update(kwargs)
        return SimpleNamespace(
            model="openai/local-model",
            choices=[
                SimpleNamespace(
                    index=0,
                    finish_reason="stop",
                    message=SimpleNamespace(content='{"sql": null}'),
                )
            ],
        )

    mocker.patch("src.providers.llm.litellm.acompletion", side_effect=fake_acompletion)

    provider = LitellmLLMProvider(
        model="openai/local-model",
        api_base="http://localhost/v1",
        kwargs={"speed": 0},
    )

    generator = provider.get_generator(
        generation_kwargs={
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "result", "schema": {}},
            },
        }
    )

    await generator(prompt="Return SQL")

    assert "response_format" not in captured_kwargs
    assert "speed" not in captured_kwargs


@pytest.mark.asyncio
async def test_local_openai_compatible_endpoint_preserves_configured_response_format(
    mocker,
):
    captured_kwargs = {}

    async def fake_acompletion(**kwargs):
        captured_kwargs.update(kwargs)
        return SimpleNamespace(
            model="openai/local-model",
            choices=[
                SimpleNamespace(
                    index=0,
                    finish_reason="stop",
                    message=SimpleNamespace(content='{"sql": null}'),
                )
            ],
        )

    mocker.patch("src.providers.llm.litellm.acompletion", side_effect=fake_acompletion)

    provider = LitellmLLMProvider(
        model="openai/local-model",
        api_base="http://localhost/v1",
        kwargs={"response_format": {"type": "json_object"}},
    )

    generator = provider.get_generator(
        generation_kwargs={
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "result", "schema": {}},
            },
        }
    )

    await generator(prompt="Return SQL")

    assert captured_kwargs["response_format"]["type"] == "json_object"
