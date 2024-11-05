from unittest.mock import AsyncMock

import pytest

from src.web.v1.services.semantics_description import SemanticsDescription


@pytest.fixture
def service():
    mock_pipeline = AsyncMock()
    mock_pipeline.run.return_value = {
        "normalize": {
            "model1": {
                "columns": [],
                "properties": {"description": "Test description"},
            }
        }
    }

    pipelines = {"semantics_description": mock_pipeline}
    return SemanticsDescription(pipelines=pipelines)


@pytest.mark.asyncio
async def test_generate_semantics_description(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.Input(
        id="test_id",
        user_prompt="Describe the model",
        selected_models=["model1"],
        mdl='{"models": [{"name": "model1", "columns": []}]}',
    )

    await service.generate(request)
    response = service[request.id]

    assert response.id == "test_id"
    assert response.status == "finished"
    assert response.response == {
        "model1": {
            "columns": [],
            "properties": {"description": "Test description"},
        }
    }
    assert response.error is None


@pytest.mark.asyncio
async def test_generate_semantics_description_with_invalid_mdl(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.Input(
        id="test_id",
        user_prompt="Describe the model",
        selected_models=["model1"],
        mdl="invalid_json",
    )

    await service.generate(request)
    response = service[request.id]

    assert response.id == "test_id"
    assert response.status == "failed"
    assert response.response is None
    assert response.error.code == "MDL_PARSE_ERROR"
    assert "Failed to parse MDL" in response.error.message


@pytest.mark.asyncio
async def test_generate_semantics_description_with_exception(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.Input(
        id="test_id",
        user_prompt="Describe the model",
        selected_models=["model1"],
        mdl='{"models": [{"name": "model1", "columns": []}]}',
    )

    service._pipelines["semantics_description"].run.side_effect = Exception(
        "Test exception"
    )

    await service.generate(request)
    response = service[request.id]

    assert response.id == "test_id"
    assert response.status == "failed"
    assert response.response is None
    assert response.error.code == "OTHERS"
    assert (
        "An error occurred during semantics description generation"
        in response.error.message
    )


def test_get_semantics_description_result(
    service: SemanticsDescription,
):
    expected_response = SemanticsDescription.Resource(
        id="test_id",
        status="finished",
        response={"model1": {"description": "Test description"}},
    )
    service["test_id"] = expected_response

    result = service["test_id"]

    assert result == expected_response


def test_get_non_existent_semantics_description_result(
    service: SemanticsDescription,
):
    result = service["non_existent_id"]

    assert result.id == "non_existent_id"
    assert result.status == "failed"
    assert result.response is None
    assert result.error.code == "RESOURCE_NOT_FOUND"
    assert "not found" in result.error.message
