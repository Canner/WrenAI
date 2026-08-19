"""Tests for the OrcaRouter gateway factory."""

import pytest

from wren_pydantic.orcarouter import (
    DEFAULT_ORCAROUTER_BASE_URL,
    DEFAULT_ORCAROUTER_MODEL,
    create_orcarouter_model,
)

pytest.importorskip("pydantic_ai")


def test_requires_api_key(monkeypatch):
    monkeypatch.delenv("ORCAROUTER_API_KEY", raising=False)
    with pytest.raises(ValueError, match="ORCAROUTER_API_KEY"):
        create_orcarouter_model()


def test_defaults(monkeypatch):
    monkeypatch.setenv("ORCAROUTER_API_KEY", "sk-orca-test")
    model = create_orcarouter_model()
    assert model.model_name == DEFAULT_ORCAROUTER_MODEL
    assert model.provider.name == "openai"
    assert model.provider.base_url == f"{DEFAULT_ORCAROUTER_BASE_URL}/"


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("ORCAROUTER_API_KEY", "sk-orca-test")
    monkeypatch.setenv("ORCAROUTER_MODEL", "anthropic/claude-sonnet-5")
    monkeypatch.setenv("ORCAROUTER_BASE_URL", "https://proxy.example.com/v1")
    model = create_orcarouter_model()
    assert model.model_name == "anthropic/claude-sonnet-5"
    assert model.provider.base_url == "https://proxy.example.com/v1/"
