"""Tests for the OrcaRouter gateway factory."""

import pytest

from wren_langchain.orcarouter import (
    DEFAULT_ORCAROUTER_BASE_URL,
    DEFAULT_ORCAROUTER_MODEL,
    create_orcarouter_chat_model,
)

pytest.importorskip("langchain_openai")


def test_requires_api_key(monkeypatch):
    monkeypatch.delenv("ORCAROUTER_API_KEY", raising=False)
    with pytest.raises(ValueError, match="ORCAROUTER_API_KEY"):
        create_orcarouter_chat_model()


def test_defaults(monkeypatch):
    monkeypatch.setenv("ORCAROUTER_API_KEY", "sk-orca-test")
    model = create_orcarouter_chat_model()
    assert model.model_name == DEFAULT_ORCAROUTER_MODEL
    assert model.openai_api_base == DEFAULT_ORCAROUTER_BASE_URL
    assert model.openai_api_key.get_secret_value() == "sk-orca-test"


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("ORCAROUTER_API_KEY", "sk-orca-test")
    monkeypatch.setenv("ORCAROUTER_MODEL", "anthropic/claude-sonnet-5")
    monkeypatch.setenv("ORCAROUTER_BASE_URL", "https://proxy.example.com/v1")
    model = create_orcarouter_chat_model()
    assert model.model_name == "anthropic/claude-sonnet-5"
    assert model.openai_api_base == "https://proxy.example.com/v1"
