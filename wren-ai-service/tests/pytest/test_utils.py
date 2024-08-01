import os

from pytest_mock import MockFixture

import src.utils as utils


def _mock(mocker: MockFixture) -> tuple:
    llm_provider = mocker.patch("src.core.provider.LLMProvider")
    mocker.patch(
        "src.core.provider.LLMProvider.get_model", return_value="mock-llm-model"
    )
    mocker.patch(
        "src.core.provider.LLMProvider.get_model_kwargs",
        return_value={},
    )

    embedder_provider = mocker.patch("src.core.provider.EmbedderProvider")
    mocker.patch(
        "src.core.provider.EmbedderProvider.get_model",
        return_value="mock-embedding-model",
    )
    mocker.patch(
        "src.core.provider.EmbedderProvider.get_dimensions",
        return_value=768,
    )

    return llm_provider, embedder_provider


def test_service_metadata(mocker: MockFixture):
    current_path = os.path.dirname(__file__)
    utils.service_metadata(
        *_mock(mocker),
        pyproject_path=os.path.join(current_path, "../data/mock_pyproject.toml"),
    )

    assert utils.MODELS_METADATA == {
        "generation_model": "mock-llm-model",
        "generation_model_kwargs": {},
        "embedding_model": "mock-embedding-model",
        "embedding_model_dim": 768,
    }

    assert utils.SERVICE_VERSION == "0.8.0-mock"
