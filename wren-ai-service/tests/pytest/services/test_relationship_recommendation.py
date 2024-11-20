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
    request = RelationshipRecommendation.Input(id="test_id", mdl='{"key": "value"}')
    mock_pipeline.run.return_value = {"validated": {"test": "data"}}

    await relationship_recommendation_service.recommend(request)
    response = relationship_recommendation_service[request.id]

    assert response.id == "test_id"
    assert response.status == "finished"
    assert response.response == {"test": "data"}
    mock_pipeline.run.assert_called_once_with(mdl={"key": "value"}, language="English")


@pytest.mark.asyncio
async def test_recommend_invalid_mdl(relationship_recommendation_service):
    request = RelationshipRecommendation.Input(id="test_id", mdl="invalid_json")

    await relationship_recommendation_service.recommend(request)
    response = relationship_recommendation_service[request.id]

    assert response.id == "test_id"
    assert response.status == "failed"
    assert response.error.code == "MDL_PARSE_ERROR"
    assert "Failed to parse MDL" in response.error.message


@pytest.mark.asyncio
async def test_recommend_pipeline_error(
    relationship_recommendation_service, mock_pipeline
):
    request = RelationshipRecommendation.Input(id="test_id", mdl='{"key": "value"}')
    mock_pipeline.run.side_effect = Exception("Pipeline error")

    await relationship_recommendation_service.recommend(request)
    response = relationship_recommendation_service[request.id]

    assert response.id == "test_id"
    assert response.status == "failed"
    assert response.error.code == "OTHERS"
    assert (
        "An error occurred during relationship recommendation generation"
        in response.error.message
    )


def test_getitem_existing(relationship_recommendation_service):
    test_id = "test_id"
    expected_response = RelationshipRecommendation.Resource(
        id=test_id, status="finished"
    )
    relationship_recommendation_service._cache[test_id] = expected_response

    response = relationship_recommendation_service[test_id]

    assert response == expected_response
    assert response.id == test_id
    assert response.status == "finished"


def test_getitem_not_found(relationship_recommendation_service):
    id = "non_existent_id"

    response = relationship_recommendation_service[id]

    assert response.id == "non_existent_id"
    assert response.status == "failed"
    assert response.error.code == "RESOURCE_NOT_FOUND"
    assert "not found" in response.error.message


def test_setitem(relationship_recommendation_service):
    id = "test_id"
    value = RelationshipRecommendation.Resource(id="test_id", status="finished")

    relationship_recommendation_service[id] = value

    assert relationship_recommendation_service._cache["test_id"] == value
