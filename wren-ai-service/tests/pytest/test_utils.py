import asyncio
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


def test_trace_metadata(mocker: MockFixture):
    metadata = mocker.patch("src.utils.MODELS_METADATA", {})
    version = mocker.patch("src.utils.SERVICE_VERSION", "0.8.0-mock")
    function = mocker.patch(
        "src.utils.langfuse_context.update_current_trace", return_value=None
    )

    class Request:
        project_id = "mock-project-id"
        thread_id = "mock-thread-id"
        mdl_hash = "mock-mdl-hash"
        user_id = "mock-user-id"

    @utils.trace_metadata
    async def my_function(_: str, b: Request):
        return "Hello, World!"

    asyncio.run(my_function("", Request()))

    function.assert_called_once_with(
        user_id="mock-user-id",
        session_id="mock-thread-id",
        release=version,
        metadata={
            "mdl_hash": "mock-mdl-hash",
            "project_id": "mock-project-id",
            **metadata,
        },
    )
