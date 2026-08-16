import pytest

from src.pipelines.generation.semantics_description import normalize, output


def test_without_hallucination():
    test_normalize = {
        "model1": {
            "name": "model1",
            "columns": [{"name": "column1"}],
        }
    }
    test_picked_models = [
        {
            "name": "model1",
            "columns": [{"name": "column1"}],
        }
    ]

    result = output(test_normalize, test_picked_models)

    assert "model1" in result
    assert result["model1"]["name"] == "model1"
    assert len(result["model1"]["columns"]) == 1
    assert result["model1"]["columns"][0]["name"] == "column1"


def test_with_hallucination():
    test_normalize = {
        "model1": {
            "name": "model1",
            "columns": [{"name": "column1"}, {"name": "$column2$"}],
        }
    }
    test_picked_models = [
        {
            "name": "model1",
            "columns": [{"name": "column1"}, {"name": "column2"}],
        }
    ]

    result = output(test_normalize, test_picked_models)

    assert "model1" in result
    assert result["model1"]["name"] == "model1"
    assert len(result["model1"]["columns"]) == 1
    assert result["model1"]["columns"][0]["name"] == "column1"


def test_with_hallucination_and_no_columns():
    test_normalize = {
        "model1": {
            "name": "model1",
            "columns": [{"name": "$column2$"}],
        }
    }
    test_picked_models = [
        {
            "name": "model1",
            "columns": [{"name": "column1"}],
        }
    ]

    result = output(test_normalize, test_picked_models)

    assert "model1" in result
    assert result["model1"]["name"] == "model1"
    assert len(result["model1"]["columns"]) == 0


def test_single_model_output_is_bound_to_picked_model_name():
    test_normalize = {
        "source table": {
            "name": "source table",
            "columns": [{"name": "entity_code"}],
            "properties": {
                "description": "Business records for source-table activity.",
                "displayName": "source records, source activity",
            },
        }
    }
    test_picked_models = [
        {
            "name": "schema_source_table",
            "columns": [{"name": "entity_code"}],
        }
    ]

    result = output(test_normalize, test_picked_models)

    assert list(result) == ["schema_source_table"]
    assert result["schema_source_table"]["name"] == "schema_source_table"
    assert result["schema_source_table"]["columns"][0]["name"] == "entity_code"


def test_single_column_output_is_bound_to_picked_column_name():
    test_normalize = {
        "users": {
            "name": "users",
            "columns": [
                {
                    "name": "created at",
                    "properties": {
                        "description": "Timestamp when the user account was created.",
                        "displayName": "created date, signup date",
                    },
                }
            ],
        }
    }
    test_picked_models = [
        {
            "name": "users",
            "columns": [{"name": "created_at"}],
        }
    ]

    result = output(test_normalize, test_picked_models)

    assert result["users"]["columns"][0]["name"] == "created_at"
    assert result["users"]["columns"][0]["properties"]["displayName"] == (
        "created date, signup date"
    )


def test_malformed_json_fails_instead_of_returning_empty_output():
    with pytest.raises(ValueError, match="malformed JSON"):
        normalize({"replies": ['{"models": [']})


def test_normalize_requires_generated_aliases():
    with pytest.raises(ValueError, match="incomplete semantic metadata"):
        normalize(
            {
                "replies": [
                    """
                    {
                      "models": [
                        {
                          "name": "orders",
                          "properties": {
                            "description": "Customer order transactions.",
                            "displayName": "orders"
                          },
                          "columns": [
                            {
                              "name": "order_id",
                              "properties": {
                                "description": "Unique order identifier.",
                                "displayName": ""
                              }
                            }
                          ]
                        }
                      ]
                    }
                    """
                ]
            }
        )


def test_normalize_preserves_generated_aliases():
    result = normalize(
        {
            "replies": [
                """
                {
                  "models": [
                    {
                      "name": "orders",
                      "properties": {
                        "description": "Customer order transactions.",
                        "displayName": "orders, sales orders"
                      },
                      "columns": [
                        {
                          "name": "order_id",
                          "type": "VARCHAR",
                          "properties": {
                            "description": "Unique order identifier.",
                            "displayName": "order id, order number"
                          }
                        }
                      ]
                    }
                  ]
                }
                """
            ]
        }
    )

    assert result["orders"]["properties"]["displayName"] == "orders, sales orders"
    assert result["orders"]["columns"][0]["properties"]["displayName"] == (
        "order id, order number"
    )
    assert result["orders"]["columns"][0]["type"] == "VARCHAR"


def test_normalize_ignores_extra_llm_fields_but_keeps_semantics():
    result = normalize(
        {
            "replies": [
                """
                {
                  "models": [
                    {
                      "name": "orders",
                      "entity": "transaction",
                      "properties": {
                        "description": "Customer order transactions.",
                        "displayName": "orders, sales orders",
                        "businessUse": "reporting"
                      },
                      "columns": [
                        {
                          "name": "order_id",
                          "type": "VARCHAR",
                          "role": "identifier",
                          "nullable": false,
                          "properties": {
                            "description": "Unique order identifier.",
                            "displayName": "order id, order number",
                            "examples": ["1001"]
                          }
                        }
                      ]
                    }
                  ]
                }
                """
            ]
        }
    )

    assert result == {
        "orders": {
            "name": "orders",
            "columns": [
                {
                    "name": "order_id",
                    "type": "VARCHAR",
                    "properties": {
                        "description": "Unique order identifier.",
                        "displayName": "order id, order number",
                    },
                }
            ],
            "properties": {
                "description": "Customer order transactions.",
                "displayName": "orders, sales orders",
            },
        }
    }
