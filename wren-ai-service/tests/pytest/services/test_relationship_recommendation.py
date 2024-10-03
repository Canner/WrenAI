from unittest.mock import AsyncMock

import pytest

from src.web.v1.services.relationship_recommendation import RelationshipRecommendation


@pytest.fixture
def mock_pipeline():
    return AsyncMock()


@pytest.fixture
def relationship_recommendation_service(mock_pipeline):
    pipelines = {"relationship_recommendation": mock_pipeline}
    return RelationshipRecommendation(pipelines)


@pytest.mark.asyncio
async def test_recommend_success(relationship_recommendation_service, mock_pipeline):
    # Arrange
    request = RelationshipRecommendation.Request(id="test_id", mdl='{"key": "value"}')
    mock_pipeline.run.return_value = {"recommendations": {"test": "data"}}

    # Act
    response = await relationship_recommendation_service.recommend(request)

    # Assert
    assert response.id == "test_id"
    assert response.status == "finished"
    assert response.response == {"test": "data"}
    mock_pipeline.run.assert_called_once_with(mdl={"key": "value"})


@pytest.mark.asyncio
async def test_recommend_invalid_mdl(relationship_recommendation_service):
    # Arrange
    request = RelationshipRecommendation.Request(id="test_id", mdl="invalid_json")

    # Act
    response = await relationship_recommendation_service.recommend(request)

    # Assert
    assert response.id == "test_id"
    assert response.status == "failed"
    assert response.error.code == "OTHERS"
    assert "Failed to parse MDL" in response.error.message


@pytest.mark.asyncio
async def test_recommend_missing_mdl(relationship_recommendation_service):
    # Arrange
    request = RelationshipRecommendation.Request(id="test_id")

    # Act
    response = await relationship_recommendation_service.recommend(request)

    # Assert
    assert response.id == "test_id"
    assert response.status == "failed"
    assert response.error.code == "OTHERS"
    assert "MDL must be provided" in response.error.message


@pytest.mark.asyncio
async def test_recommend_pipeline_error(
    relationship_recommendation_service, mock_pipeline
):
    # Arrange
    request = RelationshipRecommendation.Request(id="test_id", mdl='{"key": "value"}')
    mock_pipeline.run.side_effect = Exception("Pipeline error")

    # Act
    response = await relationship_recommendation_service.recommend(request)

    # Assert
    assert response.id == "test_id"
    assert response.status == "failed"
    assert response.error.code == "OTHERS"
    assert (
        "An error occurred during relationship recommendation generation"
        in response.error.message
    )


def test_getitem_existing(relationship_recommendation_service):
    # Arrange
    request = RelationshipRecommendation.Request(id="test_id")
    expected_response = RelationshipRecommendation.Response(
        id="test_id", status="finished"
    )
    relationship_recommendation_service._cache["test_id"] = expected_response

    # Act
    response = relationship_recommendation_service[request]

    # Assert
    assert response == expected_response


def test_getitem_not_found(relationship_recommendation_service):
    # Arrange
    request = RelationshipRecommendation.Request(id="non_existent_id")

    # Act
    response = relationship_recommendation_service[request]

    # Assert
    assert response.id == "non_existent_id"
    assert response.status == "failed"
    assert response.error.code == "OTHERS"
    assert "not found" in response.error.message


def test_setitem(relationship_recommendation_service):
    # Arrange
    request = RelationshipRecommendation.Request(id="test_id")
    value = RelationshipRecommendation.Response(id="test_id", status="finished")

    # Act
    relationship_recommendation_service[request] = value

    # Assert
    assert relationship_recommendation_service._cache["test_id"] == value
