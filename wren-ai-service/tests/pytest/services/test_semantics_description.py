import asyncio
from unittest.mock import AsyncMock

import orjson
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
    request = SemanticsDescription.Input(
        id="test_id",
        user_prompt="Describe the models",
        selected_models=["model1", "model2", "model3"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model2", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model3", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
    )

    # Mock pipeline responses for each chunk
    service._pipelines["semantics_description"].run.side_effect = [
        {"normalize": {"model1": {"description": "Description 1"}}},
        {"normalize": {"model2": {"description": "Description 2"}}},
        {"normalize": {"model3": {"description": "Description 3"}}},
    ]

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
    assert len(chunks) == 3  # Default chunk_size=1
    assert all("user_prompt" in chunk for chunk in chunks)
    assert all("mdl" in chunk for chunk in chunks)
    assert [len(chunk["selected_models"]) for chunk in chunks] == [1, 1, 1]


def test_batch_processing_with_custom_chunk_size(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.Input(
        id="test_id",
        user_prompt="Describe the models",
        selected_models=["model1", "model2", "model3", "model4"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model2", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model3", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model4", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
    )

    # Test chunking with custom chunk size
    chunks = service._chunking(orjson.loads(request.mdl), request, chunk_size=2)

    assert len(chunks) == 4
    assert [len(chunk["selected_models"]) for chunk in chunks] == [1, 1, 1, 1]
    assert chunks[0]["selected_models"] == ["model1"]
    assert chunks[1]["selected_models"] == ["model2"]
    assert chunks[2]["selected_models"] == ["model3"]
    assert chunks[3]["selected_models"] == ["model4"]


@pytest.mark.asyncio
async def test_batch_processing_partial_failure(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.Input(
        id="test_id",
        user_prompt="Describe the models",
        selected_models=["model1", "model2"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model2", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
    )

    # Mock first chunk succeeds, second chunk fails
    service._pipelines["semantics_description"].run.side_effect = [
        {"normalize": {"model1": {"description": "Description 1"}}},
        Exception("Failed processing model2"),
    ]

    await service.generate(request)
    response = service[request.id]

    assert response.id == "test_id"
    assert response.status == "failed"
    assert response.error.code == "OTHERS"
    assert "Failed processing model2" in response.error.message


@pytest.mark.asyncio
async def test_concurrent_updates_no_race_condition(
    service: SemanticsDescription,
):
    test_id = "concurrent_test"
    service[test_id] = SemanticsDescription.Resource(id=test_id)

    request = SemanticsDescription.Input(
        id=test_id,
        user_prompt="Test concurrent updates",
        selected_models=["model1", "model2", "model3", "model4", "model5"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model2", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model3", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model4", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model5", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
    )

    # Mock pipeline responses with delays to simulate concurrent execution
    async def delayed_response(model_num, delay=0.1):
        await asyncio.sleep(delay)  # Add delay to increase chance of race condition
        return {
            "normalize": {
                f"model{model_num}": {"description": f"Description {model_num}"}
            }
        }

    service._pipelines["semantics_description"].run.side_effect = [
        await delayed_response(1),
        await delayed_response(2),
        await delayed_response(3),
        await delayed_response(4),
        await delayed_response(5),
    ]

    # Generate response which will process chunks concurrently
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
