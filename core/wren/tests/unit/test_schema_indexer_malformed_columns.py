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
    assert "None" not in text


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
