import asyncio
from unittest.mock import AsyncMock

import orjson
import pytest

from src.web.v1.services import SemanticsDescription


@pytest.fixture
def service():
    mock_pipeline = AsyncMock()
    mock_pipeline.run.return_value = {
        "output": {
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
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the model",
        selected_models=["model1"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
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
    request = SemanticsDescription.GenerateRequest(
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
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the model",
        selected_models=["model1"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
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


@pytest.mark.asyncio
async def test_generate_semantics_description_with_llm_timeout_returns_fallback():
    mock_pipeline = AsyncMock()

    async def never_returns(**_):
        await asyncio.sleep(1)

    mock_pipeline.run.side_effect = never_returns
    service = SemanticsDescription(
        pipelines={"semantics_description": mock_pipeline},
        generation_timeout_seconds=0.01,
    )
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the model",
        selected_models=["model1"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
    )

    await service.generate(request)
    response = service[request.id]

    assert response.status == "finished"
    assert response.response["model1"]["properties"]["description"]
    assert response.response["model1"]["columns"][0]["properties"]["description"]


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


@pytest.mark.asyncio
async def test_batch_processing_with_multiple_models(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the models",
        selected_models=["model1", "model2", "model3"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model2", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model3", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
    )

    service._pipelines["semantics_description"].run.return_value = {
        "output": {
            "model1": {"description": "Description 1"},
            "model2": {"description": "Description 2"},
            "model3": {"description": "Description 3"},
        }
    }

    await service.generate(request)
    response = service[request.id]

    assert response.id == "test_id"
    assert response.status == "finished"
    assert response.response == {
        "model1": {"description": "Description 1"},
        "model2": {"description": "Description 2"},
        "model3": {"description": "Description 3"},
    }

    chunks = service._chunking(orjson.loads(request.mdl), request)
    assert len(chunks) == 1
    assert all("user_prompt" in chunk for chunk in chunks)
    assert all("mdl" in chunk for chunk in chunks)
    assert [len(chunk["selected_models"]) for chunk in chunks] == [3]


def test_batch_processing_with_custom_chunk_size(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the models",
        selected_models=["model1", "model2", "model3", "model4"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model2", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model3", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model4", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
    )

    # Test chunking with custom chunk size
    chunks = service._chunking(orjson.loads(request.mdl), request, chunk_size=2)

    assert len(chunks) == 2
    assert [len(chunk["selected_models"]) for chunk in chunks] == [2, 2]
    assert chunks[0]["selected_models"] == ["model1", "model2"]
    assert chunks[1]["selected_models"] == ["model3", "model4"]


@pytest.mark.asyncio
async def test_batch_processing_partial_failure(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the models",
        selected_models=["model1", "model2"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model2", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
    )

    service._pipelines["semantics_description"].run.side_effect = Exception(
        "Failed processing selected models"
    )

    await service.generate(request)
    response = service[request.id]

    assert response.id == "test_id"
    assert response.status == "failed"
    assert response.error.code == "OTHERS"
    assert "Failed processing selected models" in response.error.message


@pytest.mark.asyncio
async def test_concurrent_updates_no_race_condition(
    service: SemanticsDescription,
):
    test_id = "concurrent_test"
    service[test_id] = SemanticsDescription.Resource(id=test_id)

    request = SemanticsDescription.GenerateRequest(
        id=test_id,
        user_prompt="Test concurrent updates",
        selected_models=["model1", "model2", "model3", "model4", "model5"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model2", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model3", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model4", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model5", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
    )

    service._pipelines["semantics_description"].run.return_value = {
        "output": {
            f"model{i}": {"description": f"Description {i}"}
            for i in range(1, 6)
        }
    }

    await service.generate(request)
    response = service[request.id]

    assert response.status == "finished"
    assert response.response is not None
    assert len(response.response) == 5
    assert all(f"model{i}" in response.response for i in range(1, 6))
    assert all(
        response.response[f"model{i}"]["description"] == f"Description {i}"
        for i in range(1, 6)
    )
