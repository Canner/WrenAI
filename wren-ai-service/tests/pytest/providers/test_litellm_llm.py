from types import SimpleNamespace

import pytest

from src.providers.llm.litellm import LitellmLLMProvider


@pytest.mark.asyncio
async def test_component_generation_kwargs_override_model_defaults(mocker):
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
        api_base="http://localhost/v1",
        kwargs={
            "temperature": 1,
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

    assert captured_kwargs["temperature"] == 0
    assert captured_kwargs["response_format"]["type"] == "json_schema"

