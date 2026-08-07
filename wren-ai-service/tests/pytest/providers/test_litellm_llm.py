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
async def test_local_openai_compatible_endpoint_converts_component_json_schema_to_json_object(
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

    await generator(prompt="Return SQL", generation_kwargs={"max_tokens": 4096})

    assert captured_kwargs["response_format"] == {"type": "json_object"}
    assert captured_kwargs["max_tokens"] == 4096
    assert "speed" not in captured_kwargs


@pytest.mark.asyncio
async def test_litellm_provider_uses_configured_model_name_without_rewriting(mocker):
    captured_kwargs = {}

    async def fake_acompletion(**kwargs):
        captured_kwargs.update(kwargs)
        return SimpleNamespace(
            model="configured-model",
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
        model="configured-model",
        api_base="http://localhost/v1",
        kwargs={},
    )

    generator = provider.get_generator()

    await generator(prompt="Return SQL")

    assert captured_kwargs["model"] == "configured-model"


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


@pytest.mark.asyncio
async def test_litellm_provider_does_not_infer_num_predict(mocker):
    captured_kwargs = {}

    async def fake_acompletion(**kwargs):
        captured_kwargs.update(kwargs)
        return SimpleNamespace(
            model="configured-model",
            choices=[
                SimpleNamespace(
                    index=0,
                    finish_reason="stop",
                    message=SimpleNamespace(content='{"sql": "SELECT 1"}'),
                )
            ],
        )

    mocker.patch("src.providers.llm.litellm.acompletion", side_effect=fake_acompletion)

    provider = LitellmLLMProvider(
        model="configured-model",
        api_base="http://localhost:11434",
    )

    generator = provider.get_generator()

    await generator(prompt="Return SQL", generation_kwargs={"max_tokens": 4096})

    assert captured_kwargs["max_tokens"] == 4096
    assert "num_predict" not in captured_kwargs


@pytest.mark.asyncio
async def test_litellm_provider_preserves_configured_num_predict(mocker):
    captured_kwargs = {}

    async def fake_acompletion(**kwargs):
        captured_kwargs.update(kwargs)
        return SimpleNamespace(
            model="configured-model",
            choices=[
                SimpleNamespace(
                    index=0,
                    finish_reason="stop",
                    message=SimpleNamespace(content='{"sql": "SELECT 1"}'),
                )
            ],
        )

    mocker.patch("src.providers.llm.litellm.acompletion", side_effect=fake_acompletion)

    provider = LitellmLLMProvider(
        model="configured-model",
        api_base="http://localhost:11434",
        kwargs={"num_predict": 2048},
    )

    generator = provider.get_generator()

    await generator(prompt="Return SQL", generation_kwargs={"max_tokens": 4096})

    assert captured_kwargs["max_tokens"] == 4096
    assert captured_kwargs["num_predict"] == 2048
