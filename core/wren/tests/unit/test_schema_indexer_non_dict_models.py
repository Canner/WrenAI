"""describe_schema / extract_schema_items skip non-dict and unnamed entries."""

from __future__ import annotations

from wren.memory.schema_indexer import describe_schema, extract_schema_items


def test_describe_schema_skips_non_dict_models_rels_views():
    text = describe_schema(
        {
            "models": [None, "x", {"name": "orders", "columns": []}],
            "relationships": [None, {"name": "r1"}],
            "views": ["bad", {"name": "v1"}],
        }
    )
    # Valid records are rendered exactly once.
    assert "### Model: orders" in text
    assert text.count("### Model:") == 1
    assert "r1" in text
    assert "v1" in text
    # Malformed entries (None / bare strings) produce no rendered sections.
    assert "None" not in text
    assert text.count("### Relationship:") == 1
    assert text.count("### View:") == 1


def test_describe_schema_skips_null_and_unnamed_columns():
    # Regression: _describe_model must skip null / dict-without-name columns.
    text = describe_schema(
        {
            "models": [
                {
                    "name": "orders",
                    "columns": [
                        None,
                        "bad",
                        {"type": "int"},
                        {"name": "id", "type": "int"},
                    ],
                }
            ],
        }
    )
    assert "orders" in text
    assert "id" in text
    assert "None" not in text


def test_describe_schema_skips_unnamed_rels_and_views():
    # Regression: relationships / views without a name must not raise KeyError.
    text = describe_schema(
        {
            "relationships": [{"joinType": "one_to_many"}, {"name": "r1"}],
            "views": [{"statement": "SELECT 1"}, {"name": "v1"}],
        }
    )
    assert "r1" in text
    assert "v1" in text


def test_extract_schema_items_skips_non_dict_models():
    items = extract_schema_items(
        {
            "models": [
                None,
                {"name": "ok", "columns": [None, {"name": "id", "type": "int"}]},
            ],
            "relationships": [None],
            "views": [None],
        }
    )
    names = {i.get("item_name") for i in items}
    assert "ok" in names
    assert "id" in names
    assert None not in names


def test_extract_schema_items_skips_unnamed_rels_and_views():
    # Regression: relationship / view dicts without name must be skipped.
    items = extract_schema_items(
        {
            "relationships": [{"joinType": "one_to_many"}, {"name": "r1"}],
            "views": [{"statement": "SELECT 1"}, {"name": "v1"}],
        }
    )
    names = {i.get("item_name") for i in items}
    assert "r1" in names
    assert "v1" in names
    assert None not in names
