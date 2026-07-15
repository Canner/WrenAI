import asyncio
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


@pytest.fixture
def mdl_with_project_relationship_candidate():
    return """
    {
      "models": [
        {
          "name": "project",
          "primaryKey": "id",
          "columns": [{"name": "id"}, {"name": "name"}]
        },
        {
          "name": "view",
          "columns": [{"name": "id"}, {"name": "project_id"}]
        }
      ],
      "relationships": []
    }
    """


@pytest.fixture
def mdl_with_prefixed_project_model():
    return """
    {
      "models": [
        {
          "name": "dbo_project",
          "primaryKey": "id",
          "tableReference": {"schema": "dbo", "table": "project"},
          "columns": [{"name": "id"}, {"name": "name"}]
        },
        {
          "name": "dbo_view",
          "columns": [{"name": "id"}, {"name": "project_id"}]
        }
      ],
      "relationships": []
    }
    """


@pytest.fixture
def mdl_with_one_to_one_profile_candidate():
    return """
    {
      "models": [
        {
          "name": "user",
          "primaryKey": "id",
          "columns": [{"name": "id"}, {"name": "email"}]
        },
        {
          "name": "profile",
          "primaryKey": "user_id",
          "columns": [{"name": "user_id"}, {"name": "display_name"}]
        }
      ],
      "relationships": []
    }
    """


@pytest.fixture
def mdl_with_shared_key_candidates():
    return """
    {
      "models": [
        {
          "name": "employees",
          "primaryKey": "emp_no",
          "columns": [{"name": "emp_no"}, {"name": "first_name"}]
        },
        {
          "name": "titles",
          "columns": [{"name": "emp_no"}, {"name": "title"}]
        },
        {
          "name": "departments",
          "primaryKey": "dept_no",
          "columns": [{"name": "dept_no"}, {"name": "dept_name"}]
        },
        {
          "name": "dept_emp",
          "columns": [{"name": "emp_no"}, {"name": "dept_no"}]
        }
      ],
      "relationships": []
    }
    """


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
async def test_recommend_replaces_technical_llm_relationship_reason(
    relationship_recommendation_service,
    mock_pipeline,
    mdl_with_project_relationship_candidate,
):
    request = RelationshipRecommendation.Input(
        id="test_id", mdl=mdl_with_project_relationship_candidate
    )
    mock_pipeline.run.return_value = {
        "validated": {
            "relationships": [
                {
                    "name": "view_project",
                    "fromModel": "view",
                    "fromColumn": "project_id",
                    "type": "MANY_TO_ONE",
                    "toModel": "project",
                    "toColumn": "id",
                    "reason": "view.project_id references project.id.",
                }
            ]
        }
    }

    await relationship_recommendation_service.recommend(request)
    response = relationship_recommendation_service[request.id]

    assert response.status == "finished"
    assert response.response["relationships"][0]["reason"] == (
        "Each view belongs to one project, so views can be grouped and analyzed "
        "by project."
    )


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


@pytest.mark.asyncio
async def test_recommend_timeout_returns_fallback_relationships(
    mock_pipeline, mdl_with_project_relationship_candidate
):
    service = RelationshipRecommendation(
        {"relationship_recommendation": mock_pipeline},
        generation_timeout_seconds=0.01,
    )
    request = RelationshipRecommendation.Input(
        id="test_id", mdl=mdl_with_project_relationship_candidate
    )

    async def never_finishes(**_kwargs):
        await asyncio.sleep(1)

    mock_pipeline.run.side_effect = never_finishes

    await service.recommend(request)
    response = service[request.id]

    assert response.status == "finished"
    assert response.response == {
        "relationships": [
            {
                "name": "view_project",
                "fromModel": "view",
                "fromColumn": "project_id",
                "type": "MANY_TO_ONE",
                "toModel": "project",
                "toColumn": "id",
                "reason": (
                    "Each view belongs to one project, so views can be grouped "
                    "and analyzed by project."
                ),
            }
        ]
    }


@pytest.mark.asyncio
async def test_recommend_empty_llm_result_returns_fallback_relationships(
    relationship_recommendation_service,
    mock_pipeline,
    mdl_with_project_relationship_candidate,
):
    request = RelationshipRecommendation.Input(
        id="test_id", mdl=mdl_with_project_relationship_candidate
    )
    mock_pipeline.run.return_value = {"validated": {"relationships": []}}

    await relationship_recommendation_service.recommend(request)
    response = relationship_recommendation_service[request.id]

    assert response.status == "finished"
    assert response.response["relationships"][0]["fromModel"] == "view"
    assert response.response["relationships"][0]["toModel"] == "project"
    assert response.response["relationships"][0]["type"] == "MANY_TO_ONE"


@pytest.mark.asyncio
async def test_recommend_fallback_matches_prefixed_model_name(
    relationship_recommendation_service,
    mock_pipeline,
    mdl_with_prefixed_project_model,
):
    request = RelationshipRecommendation.Input(
        id="test_id", mdl=mdl_with_prefixed_project_model
    )
    mock_pipeline.run.return_value = {"validated": {"relationships": []}}

    await relationship_recommendation_service.recommend(request)
    response = relationship_recommendation_service[request.id]

    assert response.status == "finished"
    assert response.response["relationships"] == [
        {
            "name": "dbo_view_dbo_project",
            "fromModel": "dbo_view",
            "fromColumn": "project_id",
            "type": "MANY_TO_ONE",
            "toModel": "dbo_project",
            "toColumn": "id",
            "reason": (
                "Each view belongs to one project, so views can be grouped "
                "and analyzed by project."
            ),
        }
    ]


@pytest.mark.asyncio
async def test_recommend_fallback_identifies_one_to_one_relationships(
    relationship_recommendation_service,
    mock_pipeline,
    mdl_with_one_to_one_profile_candidate,
):
    request = RelationshipRecommendation.Input(
        id="test_id", mdl=mdl_with_one_to_one_profile_candidate
    )
    mock_pipeline.run.return_value = {"validated": {"relationships": []}}

    await relationship_recommendation_service.recommend(request)
    response = relationship_recommendation_service[request.id]

    assert response.status == "finished"
    assert response.response["relationships"] == [
        {
            "name": "profile_user",
            "fromModel": "profile",
            "fromColumn": "user_id",
            "type": "ONE_TO_ONE",
            "toModel": "user",
            "toColumn": "id",
            "reason": (
                "Each profile is linked to one matching user, connecting details "
                "that describe the same business record."
            ),
        }
    ]


@pytest.mark.asyncio
async def test_recommend_fallback_scans_all_models_and_identifies_one_to_many(
    relationship_recommendation_service,
    mock_pipeline,
    mdl_with_shared_key_candidates,
):
    request = RelationshipRecommendation.Input(
        id="test_id", mdl=mdl_with_shared_key_candidates
    )
    mock_pipeline.run.return_value = {"validated": {"relationships": []}}

    await relationship_recommendation_service.recommend(request)
    response = relationship_recommendation_service[request.id]

    assert response.status == "finished"
    assert response.response["relationships"] == [
        {
            "name": "employees_titles",
            "fromModel": "employees",
            "fromColumn": "emp_no",
            "type": "ONE_TO_MANY",
            "toModel": "titles",
            "toColumn": "emp_no",
            "reason": (
                "Each employee can be associated with multiple titles, supporting "
                "analysis of titles by employee."
            ),
        },
        {
            "name": "employees_dept_emp",
            "fromModel": "employees",
            "fromColumn": "emp_no",
            "type": "ONE_TO_MANY",
            "toModel": "dept_emp",
            "toColumn": "emp_no",
            "reason": (
                "Each employee can be associated with multiple department employees, "
                "supporting analysis of department employees by employee."
            ),
        },
        {
            "name": "departments_dept_emp",
            "fromModel": "departments",
            "fromColumn": "dept_no",
            "type": "ONE_TO_MANY",
            "toModel": "dept_emp",
            "toColumn": "dept_no",
            "reason": (
                "Each department can be associated with multiple department employees, "
                "supporting analysis of department employees by department."
            ),
        },
    ]


def test_setitem(relationship_recommendation_service):
    id = "test_id"
    value = RelationshipRecommendation.Resource(id="test_id", status="finished")

    relationship_recommendation_service[id] = value

    assert relationship_recommendation_service._cache["test_id"] == value
