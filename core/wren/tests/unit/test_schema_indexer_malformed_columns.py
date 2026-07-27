"""schema_indexer must skip non-dict / nameless columns."""

from __future__ import annotations

from wren.memory.schema_indexer import describe_schema, extract_schema_items


def test_describe_schema_skips_non_dict_columns():
    text = describe_schema(
        {
            "models": [
                {
                    "name": "orders",
                    "columns": [None, {"name": "amount", "type": "int"}, {"type": "x"}],
                }
            ]
        }
    )
    assert "amount" in text
    # Exactly one column entry rendered (the malformed ones are dropped).
    assert text.count("    - ") == 1


def test_describe_schema_omits_dangling_columns_header():
    # When every column is malformed, no dangling "  Columns:" header (589e0bb).
    text = describe_schema(
        {"models": [{"name": "orders", "columns": [None, {"type": "x"}]}]}
    )
    assert "Columns:" not in text
    assert "### Model: orders" in text


def test_describe_schema_skips_empty_string_name_and_null_columns():
    text = describe_schema(
        {
            "models": [
                {"name": "a", "columns": [{"name": "", "type": "int"}]},
                {"name": "b", "columns": None},
            ]
        }
    )
    assert "### Model: a" in text
    assert "### Model: b" in text
    assert "    - " not in text


def test_describe_schema_skips_null_model_relationship_view_slots():
    # Null slots in hand-edited manifests must not crash.
    text = describe_schema({"models": [None], "relationships": [None], "views": [None]})
    assert isinstance(text, str)


def test_extract_schema_items_skips_null_model_slots():
    items = extract_schema_items({"models": [None, {"columns": []}]})
    assert items == []


def test_extract_schema_items_skips_scalar_and_empty_name_columns():
    items = extract_schema_items(
        {
            "models": [
                {
                    "name": "orders",
                    "columns": ["amount", {"name": "", "type": "int"}],
                }
            ]
        }
    )
    col_items = [i for i in items if i["item_type"] == "column"]
    assert col_items == []


def test_extract_schema_items_skips_non_dict_columns():
    items = extract_schema_items(
        {
            "models": [
                {
                    "name": "orders",
                    "columns": [None, {"name": "amount", "type": "int"}, {"type": "x"}],
                }
            ]
        }
    )
    col_items = [i for i in items if i["item_type"] == "column"]
    assert len(col_items) == 1
    assert col_items[0]["item_name"] == "amount"
    model_items = [i for i in items if i["item_type"] == "model"]
    assert "amount" in model_items[0]["text"]
