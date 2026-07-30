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
    with pytest.raises(
        ValueError, match=r"model 'm': 'columns' must be a list, got int"
    ):
        extract_schema_items({"models": [{"name": "m", "columns": 42}]})
    with pytest.raises(
        ValueError, match=r"cube 'c': 'measures' must be a list, got int"
    ):
        extract_schema_items({"cubes": [{"name": "c", "measures": 3}]})
    with pytest.raises(
        ValueError, match=r"cube 'c': 'dimensions' must be a list, got dict"
    ):
        extract_schema_items({"cubes": [{"name": "c", "dimensions": {"x": 1}}]})
    with pytest.raises(
        ValueError, match=r"cube 'c': 'timeDimensions' must be a list, got str"
    ):
        extract_schema_items({"cubes": [{"name": "c", "timeDimensions": "nope"}]})
    # Falsy non-list values — the gap goldmedal flagged — also raise.
    with pytest.raises(
        ValueError, match=r"model 'm': 'columns' must be a list, got dict"
    ):
        extract_schema_items({"models": [{"name": "m", "columns": {}}]})
    with pytest.raises(
        ValueError, match=r"model 'm': 'columns' must be a list, got int"
    ):
        extract_schema_items({"models": [{"name": "m", "columns": 0}]})
    with pytest.raises(
        ValueError, match=r"model 'm': 'columns' must be a list, got str"
    ):
        extract_schema_items({"models": [{"name": "m", "columns": ""}]})


def test_extract_unnamed_cube_falls_back_to_unnamed_form() -> None:
    # Cubes are not required to have a name; a nameless cube with a non-list
    # collection must not emit a bare ``cube '':``. ``measures`` is never a
    # top-level manifest key, so we say ``cube (unnamed):`` rather than
    # ``manifest['measures']`` — truthful about where the field lives while
    # signalling the entity could not be identified (goldmedal's edge case).
    with pytest.raises(
        ValueError, match=r"cube \(unnamed\): 'measures' must be a list, got int"
    ):
        extract_schema_items({"cubes": [{"measures": 3}]})


def test_extract_skips_columns_missing_name() -> None:
    # Dict columns without a usable name are skipped, not indexed with ''.
    items = extract_schema_items(
        {
            "models": [
                {
                    "name": "orders",
                    "columns": [
                        {"type": "int"},
                        {"name": "", "type": "int"},
                        {"name": "id", "type": "int"},
                    ],
                }
            ]
        }
    )
    cols = [i for i in items if i["item_type"] == "column"]
    assert [c["item_name"] for c in cols] == ["id"]


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
            "relationships": ["REL_SENTINEL_ZZZ"],
            "views": ["VIEW_SENTINEL_ZZZ"],
        }
    )
    assert "t" in text
    # Malformed non-dict rows contribute nothing to the rendered text.
    assert "REL_SENTINEL_ZZZ" not in text
    assert "VIEW_SENTINEL_ZZZ" not in text
