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
    by_type = {i["item_type"]: i for i in items}
    assert set(by_type) == {"model", "column", "relationship", "view"}
    assert by_type["model"]["item_name"] == "orders"
    assert by_type["column"]["item_name"] == "id"
    assert by_type["column"]["model_name"] == "orders"
    assert by_type["relationship"]["item_name"] == "r1"
    assert by_type["view"]["item_name"] == "v1"
    assert extract_schema_items({"models": [1, 2, 3]}) == []


def test_extract_raises_on_non_list_nested_collections() -> None:
    # Policy: any non-list, non-null nested collection is a structural
    # manifest error and must raise (one rule with _iter_section / #2605's
    # _relationship_models), not silently index an empty collection. This
    # covers both truthy (42, 3, {"x": 1}, "nope") and falsy ({}, 0, "")
    # non-list values — only None/missing passes through.
    with pytest.raises(ValueError, match=r"model 'm': 'columns' must be a list"):
        extract_schema_items({"models": [{"name": "m", "columns": 42}]})
    with pytest.raises(ValueError, match=r"cube 'c': 'measures' must be a list"):
        extract_schema_items({"cubes": [{"name": "c", "measures": 3}]})
    with pytest.raises(ValueError, match=r"cube 'c': 'dimensions' must be a list"):
        extract_schema_items({"cubes": [{"name": "c", "dimensions": {"x": 1}}]})
    with pytest.raises(ValueError, match=r"cube 'c': 'timeDimensions' must be a list"):
        extract_schema_items({"cubes": [{"name": "c", "timeDimensions": "nope"}]})
    # Falsy non-list values — the gap goldmedal flagged — also raise.
    with pytest.raises(ValueError, match=r"model 'm': 'columns' must be a list"):
        extract_schema_items({"models": [{"name": "m", "columns": {}}]})
    with pytest.raises(ValueError, match=r"model 'm': 'columns' must be a list"):
        extract_schema_items({"models": [{"name": "m", "columns": 0}]})
    with pytest.raises(ValueError, match=r"model 'm': 'columns' must be a list"):
        extract_schema_items({"models": [{"name": "m", "columns": ""}]})


def test_extract_allows_none_or_empty_nested_collections() -> None:
    # None / missing / empty-list stays a no-op (no raise): the passthrough
    # case. Note {} / 0 / "" are NOT passthrough — see the raise test above.
    items = extract_schema_items(
        {"models": [{"name": "m", "columns": None}, {"name": "n"}]}
    )
    assert [i["item_type"] for i in items] == ["model", "model"]
    assert extract_schema_items({"models": [{"name": "m", "columns": []}]})


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
