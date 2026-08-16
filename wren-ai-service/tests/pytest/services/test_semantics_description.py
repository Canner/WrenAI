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
                "name": "model1",
                "columns": [
                    {
                        "name": "column1",
                        "properties": {
                            "description": "Customer segment for reporting."
                        },
                    }
                ],
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
            "name": "model1",
            "columns": [
                {
                    "name": "column1",
                    "type": "varchar",
                    "properties": {
                        "description": "Customer segment for reporting."
                    },
                }
            ],
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
async def test_generate_semantics_description_with_llm_timeout_fails():
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

    assert response.status == "failed"
    assert response.response is None
    assert "timed out" in response.error.message


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


def test_semantics_description_uses_configured_timeout():
    service = SemanticsDescription(
        pipelines={"semantics_description": AsyncMock()},
        generation_timeout_seconds=123,
    )

    assert service._generation_timeout_seconds == 123


def test_semantics_description_uses_timeout_without_rewriting_ttl():
    service = SemanticsDescription(
        pipelines={"semantics_description": AsyncMock()},
        ttl=120,
        generation_timeout_seconds=600,
    )

    assert service._generation_timeout_seconds == 600
    assert service._cache.ttl == 120


def test_semantics_description_uses_configured_batch_and_concurrency_limits():
    service = SemanticsDescription(
        pipelines={"semantics_description": AsyncMock()},
        max_models_per_batch=2,
        max_concurrent_tasks=3,
    )

    assert service._max_models_per_batch == 2
    assert service._max_columns_per_batch == 50
    assert service._max_concurrent_tasks == 3


def test_semantics_description_scales_request_timeout_by_concurrency_waves():
    service = SemanticsDescription(
        pipelines={"semantics_description": AsyncMock()},
        generation_timeout_seconds=120,
        max_concurrent_tasks=4,
    )

    assert service._request_timeout_seconds(1) == 120
    assert service._request_timeout_seconds(4) == 120
    assert service._request_timeout_seconds(5) == 240


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
            "model1": {
                "description": "Description 1",
                "columns": [
                    {
                        "name": "column1",
                        "properties": {"description": "Column description 1"},
                    }
                ],
            },
            "model2": {
                "description": "Description 2",
                "columns": [
                    {
                        "name": "column1",
                        "properties": {"description": "Column description 2"},
                    }
                ],
            },
            "model3": {
                "description": "Description 3",
                "columns": [
                    {
                        "name": "column1",
                        "properties": {"description": "Column description 3"},
                    }
                ],
            },
        }
    }

    await service.generate(request)
    response = service[request.id]

    assert response.id == "test_id"
    assert response.status == "finished"
    assert response.response["model1"]["properties"]["description"] == "Description 1"
    assert response.response["model2"]["properties"]["description"] == "Description 2"
    assert response.response["model3"]["properties"]["description"] == "Description 3"
    assert len(response.response["model1"]["columns"]) == 1
    assert len(response.response["model2"]["columns"]) == 1
    assert len(response.response["model3"]["columns"]) == 1

    chunks = service._chunking(orjson.loads(request.mdl), request)
    assert len(chunks) == 3
    assert all("user_prompt" in chunk for chunk in chunks)
    assert all("mdl" in chunk for chunk in chunks)
    assert [chunk["selected_models"] for chunk in chunks] == [
        ["model1"],
        ["model2"],
        ["model3"],
    ]


def test_batch_processing_groups_small_models_by_prompt(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the models",
        selected_models=["model1", "model2", "model3", "model4"],
        mdl='{"models": [{"name": "model1", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model2", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model3", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}, {"name": "model4", "columns": [{"name": "column1", "type": "varchar", "notNull": false}]}]}',
    )

    chunks = service._chunking(orjson.loads(request.mdl), request, chunk_size=2)

    assert len(chunks) == 2
    assert [chunk["selected_models"] for chunk in chunks] == [
        ["model1", "model2"],
        ["model3", "model4"],
    ]


def test_default_batch_splits_large_column_groups_by_model(
    service: SemanticsDescription,
):
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the models",
        selected_models=["model1", "model2"],
        mdl=orjson.dumps(
            {
                "models": [
                    {
                        "name": "model1",
                        "columns": [
                            {"name": f"column_{index}", "type": "varchar"}
                            for index in range(500)
                        ],
                    },
                    {
                        "name": "model2",
                        "columns": [
                            {"name": f"field_{index}", "type": "varchar"}
                            for index in range(400)
                        ],
                    },
                ]
            }
        ).decode(),
    )

    chunks = service._chunking(orjson.loads(request.mdl), request)

    assert len(chunks) == 18
    assert chunks[0]["selected_models"] == ["model1"]
    assert chunks[9]["selected_models"] == ["model1"]
    assert chunks[10]["selected_models"] == ["model2"]
    assert len(chunks[0]["mdl"]["models"][0]["columns"]) == 50
    assert len(chunks[9]["mdl"]["models"][0]["columns"]) == 50
    assert len(chunks[10]["mdl"]["models"][0]["columns"]) == 50


@pytest.mark.asyncio
async def test_column_chunk_outputs_merge_into_single_model(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the model",
        selected_models=["orders"],
        mdl=orjson.dumps(
            {
                "models": [
                    {
                        "name": "orders",
                        "columns": [
                            {"name": f"column_{index}", "type": "varchar"}
                            for index in range(41)
                        ],
                    }
                ]
            }
        ).decode(),
    )

    def response_for_chunk(**kwargs):
        model = kwargs["mdl"]["models"][0]
        return {
            "output": {
                "orders": {
                    "description": "Customer order transactions.",
                    "columns": [
                        {
                            "name": column["name"],
                            "properties": {
                                "description": f"Description for {column['name']}",
                            },
                        }
                        for column in model["columns"]
                    ],
                }
            }
        }

    service._pipelines["semantics_description"].run.side_effect = response_for_chunk

    await service.generate(request)
    response = service[request.id]

    assert response.status == "finished"
    assert response.response["orders"]["properties"]["description"] == (
        "Customer order transactions."
    )
    assert len(response.response["orders"]["columns"]) == 41
    assert service._pipelines["semantics_description"].run.call_count == 1


@pytest.mark.asyncio
async def test_malformed_chunk_retries_with_smaller_column_groups(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    service._max_columns_per_batch = 3
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the model",
        selected_models=["orders"],
        mdl=orjson.dumps(
            {
                "models": [
                    {
                        "name": "orders",
                        "columns": [
                            {"name": f"column_{index}", "type": "varchar"}
                            for index in range(3)
                        ],
                    }
                ]
            }
        ).decode(),
    )

    async def response_for_chunk(**kwargs):
        model = kwargs["mdl"]["models"][0]
        if len(model["columns"]) > 1:
            raise ValueError("Semantics description LLM returned malformed JSON.")
        column = model["columns"][0]
        return {
            "output": {
                "orders": {
                    "description": "Customer order transactions.",
                    "columns": [
                        {
                            "name": column["name"],
                            "properties": {
                                "description": f"Description for {column['name']}",
                            },
                        }
                    ],
                }
            }
        }

    service._pipelines["semantics_description"].run.side_effect = response_for_chunk

    await service.generate(request)
    response = service[request.id]

    assert response.status == "finished"
    assert len(response.response["orders"]["columns"]) == 3
    assert service._pipelines["semantics_description"].run.call_count == 5


@pytest.mark.asyncio
async def test_incomplete_llm_output_uses_available_descriptions(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the models",
        selected_models=["orders", "customers"],
        mdl=orjson.dumps(
            {
                "models": [
                    {
                        "name": "orders",
                        "columns": [
                            {"name": "order_id", "type": "varchar"},
                            {"name": "order_date", "type": "date"},
                        ],
                    },
                    {
                        "name": "customers",
                        "columns": [
                            {"name": "customer_id", "type": "varchar"},
                        ],
                    },
                ]
            }
        ).decode(),
    )
    service._pipelines["semantics_description"].run.return_value = {
        "output": {
            "orders": {
                "name": "orders",
                "columns": [
                    {
                        "name": "order_id",
                        "properties": {"description": "Unique order identifier."},
                    }
                ],
                "properties": {"description": "Customer purchase transactions."},
            }
        }
    }

    await service.generate(request)
    response = service[request.id]

    assert response.status == "finished"
    assert response.error is None
    assert list(response.response.keys()) == ["orders", "customers"]
    assert response.response["orders"]["properties"]["description"] == (
        "Customer purchase transactions."
    )
    assert response.response["orders"]["columns"] == [
        {
            "name": "order_id",
            "type": "varchar",
            "properties": {"description": "Unique order identifier."},
        },
        {
            "name": "order_date",
            "type": "date",
            "properties": {"description": ""},
        },
    ]
    assert response.response["customers"] == {
        "name": "customers",
        "columns": [
            {
                "name": "customer_id",
                "type": "varchar",
                "properties": {"description": ""},
            }
        ],
        "properties": {"description": ""},
    }


@pytest.mark.asyncio
async def test_llm_descriptions_are_not_rewritten_by_service(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Sales and operations reporting dataset",
        selected_models=["dbo_xStageLoad2"],
        mdl=orjson.dumps(
            {
                "models": [
                    {
                        "name": "dbo_xStageLoad2",
                        "columns": [
                            {"name": "Division", "type": "varchar"},
                            {"name": "SalesPerson", "type": "varchar"},
                            {"name": "SalesAmount", "type": "float"},
                        ],
                    }
                ]
            }
        ).decode(),
    )
    service._pipelines["semantics_description"].run.return_value = {
        "output": {
            "dbo_xStageLoad2": {
                "name": "dbo_xStageLoad2",
                "columns": [
                    {
                        "name": "Division",
                        "properties": {
                            "description": "Stores the Division value used to describe or analyze xStage records."
                        },
                    },
                    {
                        "name": "SalesPerson",
                        "properties": {"description": "SalesPerson"},
                    },
                    {
                        "name": "SalesAmount",
                        "properties": {
                            "description": "Stores the SalesAmount value."
                        },
                    },
                ],
                "properties": {
                    "description": "Contains business records for xStageLoad2."
                },
            }
        }
    }

    await service.generate(request)
    response = service[request.id]

    assert response.status == "finished"
    assert response.response["dbo_xStageLoad2"]["properties"]["description"] == (
        "Contains business records for xStageLoad2."
    )
    assert [
        column["properties"]["description"]
        for column in response.response["dbo_xStageLoad2"]["columns"]
    ] == [
        "Stores the Division value used to describe or analyze xStage records.",
        "SalesPerson",
        "Stores the SalesAmount value.",
    ]


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
            f"model{i}": {
                "description": f"Description {i}",
                "columns": [
                    {
                        "name": "column1",
                        "properties": {"description": f"Column description {i}"},
                    }
                ],
            }
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
        response.response[f"model{i}"]["properties"]["description"]
        == f"Description {i}"
        for i in range(1, 6)
    )


@pytest.mark.asyncio
async def test_repeated_llm_column_descriptions_are_tolerated(
    service: SemanticsDescription,
):
    service["test_id"] = SemanticsDescription.Resource(id="test_id")
    request = SemanticsDescription.GenerateRequest(
        id="test_id",
        user_prompt="Describe the model",
        selected_models=["orders"],
        mdl=orjson.dumps(
            {
                "models": [
                    {
                        "name": "orders",
                        "columns": [
                            {"name": "order_id", "type": "varchar"},
                            {"name": "customer_id", "type": "varchar"},
                        ],
                    }
                ]
            }
        ).decode(),
    )
    service._pipelines["semantics_description"].run.return_value = {
        "output": {
            "orders": {
                "description": "Customer order transactions.",
                "columns": [
                    {
                        "name": "order_id",
                        "properties": {"description": "Identifier for reporting."},
                    },
                    {
                        "name": "customer_id",
                        "properties": {"description": "Identifier for reporting."},
                    },
                ],
            }
        }
    }

    await service.generate(request)
    response = service[request.id]

    assert response.status == "finished"
    assert response.error is None
    assert response.response["orders"]["properties"]["description"] == (
        "Customer order transactions."
    )
    assert response.response["orders"]["columns"] == [
        {
            "name": "order_id",
            "type": "varchar",
            "properties": {"description": "Identifier for reporting."},
        },
        {
            "name": "customer_id",
            "type": "varchar",
            "properties": {"description": "Identifier for reporting."},
        },
    ]
