import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.providers.llm.minimax import (
    MINIMAX_API_BASE,
    MiniMaxLLMProvider,
    _clamp_temperature,
)


class TestClampTemperature:
    def test_zero_becomes_positive(self):
        assert _clamp_temperature(0) == 0.01

    def test_negative_becomes_positive(self):
        assert _clamp_temperature(-1.0) == 0.01

    def test_value_above_one_clamped(self):
        assert _clamp_temperature(1.5) == 1.0

    def test_valid_value_unchanged(self):
        assert _clamp_temperature(0.7) == 0.7

    def test_one_unchanged(self):
        assert _clamp_temperature(1.0) == 1.0

    def test_small_positive_unchanged(self):
        assert _clamp_temperature(0.01) == 0.01


class TestMiniMaxLLMProviderInit:
    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    def test_default_initialization(self):
        provider = MiniMaxLLMProvider()
        assert provider._model == "MiniMax-M2.5"
        assert provider._api_base == MINIMAX_API_BASE
        assert provider._timeout == 120.0
        assert provider._context_window_size == 204800
        assert provider._model_kwargs == {}

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    def test_custom_model(self):
        provider = MiniMaxLLMProvider(model="MiniMax-M2.5-highspeed")
        assert provider._model == "MiniMax-M2.5-highspeed"

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    def test_custom_api_base(self):
        provider = MiniMaxLLMProvider(api_base="https://api.minimaxi.com/v1")
        assert provider._api_base == "https://api.minimaxi.com/v1"

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    def test_custom_kwargs(self):
        kwargs = {"max_tokens": 4096, "temperature": 0.5}
        provider = MiniMaxLLMProvider(kwargs=kwargs)
        assert provider._model_kwargs == kwargs

    @patch.dict(os.environ, {"MY_KEY": "custom-key"})
    def test_custom_api_key_name(self):
        provider = MiniMaxLLMProvider(api_key_name="MY_KEY")
        assert provider._client.api_key == "custom-key"

    def test_no_api_key(self):
        provider = MiniMaxLLMProvider(api_key_name=None)
        # When no key is provided, a placeholder is used so the client can be created
        assert provider._client.api_key == "placeholder"

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    def test_get_model(self):
        provider = MiniMaxLLMProvider(model="MiniMax-M2.5")
        assert provider.get_model() == "MiniMax-M2.5"

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    def test_get_context_window_size(self):
        provider = MiniMaxLLMProvider(context_window_size=100000)
        assert provider.get_context_window_size() == 100000

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    def test_get_model_kwargs(self):
        kwargs = {"temperature": 0.8}
        provider = MiniMaxLLMProvider(kwargs=kwargs)
        assert provider.get_model_kwargs() == kwargs


class TestMiniMaxLLMProviderGenerator:
    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    def test_get_generator_returns_callable(self):
        provider = MiniMaxLLMProvider()
        gen = provider.get_generator()
        assert callable(gen)

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    def test_response_format_removed_from_kwargs(self):
        provider = MiniMaxLLMProvider(
            kwargs={"temperature": 0.5, "response_format": {"type": "json_object"}}
        )
        # The generator is created; response_format should be stripped internally.
        gen = provider.get_generator()
        assert callable(gen)

    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    def test_temperature_clamped_in_kwargs(self):
        provider = MiniMaxLLMProvider(kwargs={"temperature": 0})
        gen = provider.get_generator()
        assert callable(gen)

    @pytest.mark.asyncio
    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    async def test_run_non_streaming(self):
        provider = MiniMaxLLMProvider(kwargs={"temperature": 0.5})

        mock_choice = MagicMock()
        mock_choice.message.content = '{"sql": "SELECT 1"}'
        mock_choice.index = 0
        mock_choice.finish_reason = "stop"

        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        mock_completion.model = "MiniMax-M2.5"
        mock_completion.usage = MagicMock()
        mock_completion.usage.__iter__ = MagicMock(
            return_value=iter([("prompt_tokens", 10), ("completion_tokens", 5)])
        )

        provider._client.chat.completions.create = AsyncMock(
            return_value=mock_completion
        )

        gen = provider.get_generator(system_prompt="You are a SQL expert.")
        result = await gen(prompt="Generate SQL for counting users")

        assert "replies" in result
        assert "meta" in result
        assert len(result["replies"]) == 1

        # Verify the API was called with correct parameters
        call_kwargs = provider._client.chat.completions.create.call_args
        assert call_kwargs.kwargs["model"] == "MiniMax-M2.5"
        assert call_kwargs.kwargs["stream"] is False
        assert call_kwargs.kwargs["temperature"] == 0.5
        # response_format should NOT be in the call
        assert "response_format" not in call_kwargs.kwargs

    @pytest.mark.asyncio
    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    async def test_run_with_zero_temperature_clamped(self):
        provider = MiniMaxLLMProvider(kwargs={"temperature": 0})

        mock_choice = MagicMock()
        mock_choice.message.content = "Hello"
        mock_choice.index = 0
        mock_choice.finish_reason = "stop"

        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        mock_completion.model = "MiniMax-M2.5"
        mock_completion.usage = MagicMock()
        mock_completion.usage.__iter__ = MagicMock(
            return_value=iter([("prompt_tokens", 5), ("completion_tokens", 3)])
        )

        provider._client.chat.completions.create = AsyncMock(
            return_value=mock_completion
        )

        gen = provider.get_generator()
        await gen(prompt="Hello")

        call_kwargs = provider._client.chat.completions.create.call_args
        assert call_kwargs.kwargs["temperature"] == 0.01

    @pytest.mark.asyncio
    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    async def test_run_response_format_stripped(self):
        provider = MiniMaxLLMProvider(
            kwargs={"response_format": {"type": "json_object"}, "temperature": 0.8}
        )

        mock_choice = MagicMock()
        mock_choice.message.content = '{"result": "ok"}'
        mock_choice.index = 0
        mock_choice.finish_reason = "stop"

        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        mock_completion.model = "MiniMax-M2.5"
        mock_completion.usage = MagicMock()
        mock_completion.usage.__iter__ = MagicMock(
            return_value=iter([("prompt_tokens", 5), ("completion_tokens", 3)])
        )

        provider._client.chat.completions.create = AsyncMock(
            return_value=mock_completion
        )

        gen = provider.get_generator()
        await gen(prompt="Test")

        call_kwargs = provider._client.chat.completions.create.call_args
        assert "response_format" not in call_kwargs.kwargs

    @pytest.mark.asyncio
    @patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key-123"})
    async def test_run_with_history_messages(self):
        from src.providers.llm import ChatMessage

        provider = MiniMaxLLMProvider()

        mock_choice = MagicMock()
        mock_choice.message.content = "Response"
        mock_choice.index = 0
        mock_choice.finish_reason = "stop"

        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        mock_completion.model = "MiniMax-M2.5"
        mock_completion.usage = MagicMock()
        mock_completion.usage.__iter__ = MagicMock(
            return_value=iter([("prompt_tokens", 10), ("completion_tokens", 5)])
        )

        provider._client.chat.completions.create = AsyncMock(
            return_value=mock_completion
        )

        history = [
            ChatMessage.from_user("Previous question"),
            ChatMessage.from_assistant("Previous answer"),
        ]

        gen = provider.get_generator(system_prompt="System prompt")
        result = await gen(prompt="Follow-up", history_messages=history)

        call_kwargs = provider._client.chat.completions.create.call_args
        messages = call_kwargs.kwargs["messages"]
        # system + 2 history + 1 new user message
        assert len(messages) == 4
        assert messages[0]["role"] == "system"


class TestProviderRegistration:
    def test_minimax_registered(self):
        from src.providers.loader import PROVIDERS

        # The @provider decorator registers at import time
        assert "minimax_llm" in PROVIDERS
        assert PROVIDERS["minimax_llm"].__name__ == "MiniMaxLLMProvider"
