import asyncio
from unittest.mock import AsyncMock

import pytest

from src.pipelines.generation.relationship_recommendation import cleaned_models
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
async def test_recommend_preserves_llm_relationship_reason(
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
        "view.project_id references project.id."
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
async def test_recommend_timeout_fails_without_fallback_relationships(
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
    assert response.error is None
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
                    "Records in view can be analyzed with related records in "
                    "project through project_id."
                ),
            }
        ]
    }


@pytest.mark.asyncio
async def test_recommend_empty_llm_result_stays_empty(
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
    assert response.response == {"relationships": []}


@pytest.mark.asyncio
async def test_recommend_missing_validated_response_fails(
    relationship_recommendation_service,
    mock_pipeline,
):
    request = RelationshipRecommendation.Input(id="test_id", mdl='{"relationships": []}')
    mock_pipeline.run.return_value = {}

    await relationship_recommendation_service.recommend(request)
    response = relationship_recommendation_service[request.id]

    assert response.status == "finished"
    assert response.error is None
    assert response.response == {"relationships": []}


@pytest.mark.asyncio
async def test_recommend_does_not_create_prefixed_model_relationships(
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
    assert response.response == {"relationships": []}


@pytest.mark.asyncio
async def test_recommend_does_not_infer_one_to_one_relationships(
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
    assert response.response == {"relationships": []}


@pytest.mark.asyncio
async def test_recommend_does_not_infer_shared_key_relationships(
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
    assert response.response == {"relationships": []}


def test_setitem(relationship_recommendation_service):
    id = "test_id"
    value = RelationshipRecommendation.Resource(id="test_id", status="finished")

    relationship_recommendation_service[id] = value

    assert relationship_recommendation_service._cache["test_id"] == value


@pytest.mark.asyncio
async def test_timeout_finishes_with_empty_relationships_when_metadata_has_no_candidate(
    mock_pipeline,
):
    service = RelationshipRecommendation(
        {"relationship_recommendation": mock_pipeline},
        generation_timeout_seconds=0.01,
    )
    request = RelationshipRecommendation.Input(
        id="test_id",
        mdl="""
        {
          "models": [
            {
              "name": "alpha",
              "primaryKey": "id",
              "columns": [{"name": "id"}, {"name": "label"}]
            },
            {
              "name": "beta",
              "primaryKey": "id",
              "columns": [{"name": "id"}, {"name": "amount"}]
            }
          ],
          "relationships": []
        }
        """,
    )

    async def never_finishes(**_kwargs):
        await asyncio.sleep(1)

    mock_pipeline.run.side_effect = never_finishes

    await service.recommend(request)
    response = service[request.id]

    assert response.status == "finished"
    assert response.response == {"relationships": []}


@pytest.mark.asyncio
async def test_fallback_recommends_foreign_key_style_relationship(mock_pipeline):
    service = RelationshipRecommendation(
        {"relationship_recommendation": mock_pipeline},
        max_llm_models=1,
    )
    request = RelationshipRecommendation.Input(
        id="test_id",
        mdl="""
        {
          "models": [
            {
              "name": "customer",
              "primaryKey": "customer_key",
              "columns": [{"name": "customer_key"}, {"name": "name"}]
            },
            {
              "name": "order_header",
              "primaryKey": "order_key",
              "columns": [{"name": "order_key"}, {"name": "customer_key"}]
            }
          ],
          "relationships": []
        }
        """,
    )

    await service.recommend(request)
    response = service[request.id]

    assert response.status == "finished"
    assert response.response["relationships"] == [
        {
            "name": "order_header_customer",
            "fromModel": "order_header",
            "fromColumn": "customer_key",
            "type": "MANY_TO_ONE",
            "toModel": "customer",
            "toColumn": "customer_key",
            "reason": (
                "Records in order_header can be analyzed with related records "
                "in customer through customer_key."
            ),
        }
    ]


@pytest.mark.asyncio
async def test_fallback_recommends_shared_key_bridge_relationships(mock_pipeline):
    service = RelationshipRecommendation(
        {"relationship_recommendation": mock_pipeline},
        max_llm_models=1,
    )
    request = RelationshipRecommendation.Input(
        id="test_id",
        mdl="""
        {
          "models": [
            {
              "name": "employee",
              "primaryKey": "emp_no",
              "columns": [{"name": "emp_no"}, {"name": "name"}]
            },
            {
              "name": "department",
              "primaryKey": "dept_no",
              "columns": [{"name": "dept_no"}, {"name": "name"}]
            },
            {
              "name": "department_employee",
              "columns": [{"name": "emp_no"}, {"name": "dept_no"}]
            }
          ],
          "relationships": []
        }
        """,
    )

    await service.recommend(request)
    response = service[request.id]
    pairs = {
        (
            relationship["fromModel"],
            relationship["fromColumn"],
            relationship["toModel"],
            relationship["toColumn"],
        )
        for relationship in response.response["relationships"]
    }

    assert response.status == "finished"
    assert (
        "department_employee",
        "emp_no",
        "employee",
        "emp_no",
    ) in pairs
    assert (
        "department_employee",
        "dept_no",
        "department",
        "dept_no",
    ) in pairs


def test_relationship_timeout_scales_with_model_count(mock_pipeline):
    service = RelationshipRecommendation(
        {"relationship_recommendation": mock_pipeline},
        generation_timeout_seconds=45,
        max_generation_timeout_seconds=90,
    )

    assert service._request_timeout_seconds({"models": [{}] * 1}) == 45
    assert service._request_timeout_seconds({"models": [{}] * 20}) == 45
    assert service._request_timeout_seconds({"models": [{}] * 21}) == 90
    assert service._request_timeout_seconds({"models": [{}] * 200}) == 90


@pytest.mark.asyncio
async def test_large_mdl_skips_llm_and_finishes_with_metadata_fallback(mock_pipeline):
    service = RelationshipRecommendation(
        {"relationship_recommendation": mock_pipeline},
        max_llm_models=1,
    )
    request = RelationshipRecommendation.Input(
        id="test_id",
        mdl="""
        {
          "models": [
            {
              "name": "parent",
              "primaryKey": "id",
              "columns": [{"name": "id"}, {"name": "label"}]
            },
            {
              "name": "child",
              "primaryKey": "id",
              "columns": [{"name": "id"}, {"name": "parent_id"}]
            }
          ],
          "relationships": []
        }
        """,
    )

    await service.recommend(request)
    response = service[request.id]

    assert response.status == "finished"
    assert response.response["relationships"][0]["fromModel"] == "child"
    assert response.response["relationships"][0]["toModel"] == "parent"
    mock_pipeline.run.assert_not_called()


def test_cleaned_models_uses_compact_relationship_relevant_payload():
    result = cleaned_models(
        {
            "models": [
                {
                    "name": "model_alpha",
                    "primaryKey": "id",
                    "baseObject": "physical_source",
                    "properties": {
                        "displayName": "Alpha",
                        "description": "Business alpha records",
                        "unused": "omitted",
                    },
                    "columns": [
                        {
                            "name": "id",
                            "type": "INTEGER",
                            "expression": "complex expression",
                            "properties": {
                                "description": "Primary identifier",
                                "unused": "omitted",
                            },
                        },
                        {
                            "name": "model_beta_id",
                            "type": "INTEGER",
                            "relationship": "existing",
                        },
                    ],
                }
            ]
        }
    )

    assert result == [
        {
            "name": "model_alpha",
            "primaryKey": "id",
            "columns": [
                {
                    "name": "id",
                    "type": "INTEGER",
                    "properties": {"description": "Primary identifier"},
                }
            ],
            "properties": {
                "displayName": "Alpha",
                "description": "Business alpha records",
            },
        }
    ]
