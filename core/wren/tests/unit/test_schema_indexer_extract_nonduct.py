"""extract_schema_items / describe_schema must skip non-dict MDL rows."""

import pytest

from wren.memory.schema_indexer import describe_schema, extract_schema_items


def test_extract_skips_non_dict_models_columns_rels_views_without_raise() -> None:
    items = extract_schema_items(
        {
            "models": [
                None,
                "bad",
                {
                    "name": "orders",
                    "columns": [
                        None,
                        "x",
                        {"name": "id", "type": "int"},
                    ],
                },
            ],
            "relationships": [None, {"name": "r1", "models": ["a", "b"]}],
            "views": ["nope", {"name": "v1", "statement": "SELECT 1"}],
        }
    )
    assert isinstance(items, list)
    assert len(items) == 4
    by_type = {i["item_type"]: i for i in items}
    assert set(by_type) == {"model", "column", "relationship", "view"}
    assert by_type["model"]["item_name"] == "orders"
    assert by_type["column"]["item_name"] == "id"
    assert by_type["column"]["model_name"] == "orders"
    assert by_type["relationship"]["item_name"] == "r1"
    assert by_type["view"]["item_name"] == "v1"
    assert extract_schema_items({"models": [1, 2, 3]}) == []


def test_extract_handles_truthy_scalar_nested_collections_without_raise() -> None:
    items = extract_schema_items({"models": [{"name": "m", "columns": 42}]})
    assert [i["item_type"] for i in items] == ["model"]
    items = extract_schema_items(
        {
            "cubes": [
                {
                    "name": "c",
                    "measures": 3,
                    "dimensions": {"x": 1},
                    "timeDimensions": "nope",
                }
            ]
        }
    )
    assert any(i["item_type"] == "cube" for i in items)


def test_top_level_non_list_section_raises() -> None:
    with pytest.raises(ValueError, match="must be a list"):
        extract_schema_items({"models": 5})
    with pytest.raises(ValueError, match="must be a list"):
        describe_schema({"models": 1})


def test_describe_skips_non_dict_rows() -> None:
    text = describe_schema(
        {
            "models": [None, {"name": "t", "columns": [{"name": "a", "type": "int"}]}],
            "relationships": ["x"],
            "views": [1],
        }
    )
    assert "t" in text
