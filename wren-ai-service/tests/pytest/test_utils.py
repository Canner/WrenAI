import asyncio
import os
from dataclasses import asdict

import pytest
from pytest_mock import MockFixture

import src.utils as utils
from src.core.pipeline import PipelineComponent
from src.globals import ServiceMetadata, create_service_metadata


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
        "src.core.provider.EmbedderProvider.get_model_dimension",
        return_value=768,
    )

    return llm_provider, embedder_provider


@pytest.fixture
def service_metadata(mocker: MockFixture):
    current_path = os.path.dirname(__file__)

    return create_service_metadata(
        pipe_components={"mock": PipelineComponent(*_mock(mocker))},
        pyproject_path=os.path.join(current_path, "../data/mock_pyproject.toml"),
    )


def test_service_metadata(service_metadata: ServiceMetadata):
    assert service_metadata.pipes_metadata == {
        "mock": {
            "llm_model": "mock-llm-model",
            "llm_model_kwargs": {},
            "embedding_model": "mock-embedding-model",
        },
    }

    assert service_metadata.service_version == "0.8.0-mock"


def test_trace_metadata(service_metadata: ServiceMetadata, mocker: MockFixture):
    function = mocker.patch(
        "src.utils.langfuse_context.update_current_trace", return_value=None
    )

    class Request:
        project_id = "mock-project-id"
        thread_id = "mock-thread-id"
        mdl_hash = "mock-mdl-hash"
        query = "mock-user-query"

    @utils.trace_metadata
    async def my_function(_: str, b: Request, **kwargs):
        return "Hello, World!"

    asyncio.run(my_function("", Request(), service_metadata=asdict(service_metadata)))

    function.assert_called_once_with(
        user_id=None,
        session_id="mock-thread-id",
        release=service_metadata.service_version,
        metadata={
            "mdl_hash": "mock-mdl-hash",
            "project_id": "mock-project-id",
            "query": "mock-user-query",
            **service_metadata.pipes_metadata,
        },
    )
