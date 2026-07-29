"""relationship models must be a list — wrong types raise ValueError (#2590)."""

from __future__ import annotations

import pytest

from wren.memory.schema_indexer import describe_schema, extract_schema_items


@pytest.mark.parametrize(
    ("bad", "got"), [({"a": 1}, "dict"), ("orders", "str"), (5, "int")]
)
def test_describe_schema_non_list_relationship_models_raises(bad, got):
    with pytest.raises(
        ValueError, match=rf"relationship 'r': 'models' must be a list, got {got}"
    ):
        describe_schema({"relationships": [{"name": "r", "models": bad}]})


@pytest.mark.parametrize(
    ("bad", "got"), [({"a": 1}, "dict"), ("orders", "str"), (5, "int")]
)
def test_extract_schema_items_non_list_relationship_models_raises(bad, got):
    with pytest.raises(
        ValueError, match=rf"relationship 'r': 'models' must be a list, got {got}"
    ):
        extract_schema_items({"relationships": [{"name": "r", "models": bad}]})


def test_string_models_do_not_emit_truncated_endpoints():
    """Regression: str models used to index first two characters as endpoints."""
    m = {
        "relationships": [
            {
                "name": "orders_customers",
                "models": "orders",
                "joinType": "MANY_TO_ONE",
                "condition": "o.cid = c.id",
            }
        ]
    }
    with pytest.raises(ValueError):
        describe_schema(m)
    with pytest.raises(ValueError):
        extract_schema_items(m)


def test_missing_models_still_ok():
    text = describe_schema({"relationships": [{"name": "r1"}]})
    assert "r1" in text
    items = extract_schema_items({"relationships": [{"name": "r1"}]})
    assert any(i.get("item_name") == "r1" for i in items)


def test_explicit_none_models_still_ok():
    """`models:` with no value parses to None, the shape users hit by accident."""
    text = describe_schema({"relationships": [{"name": "r1", "models": None}]})
    assert "r1" in text
    items = extract_schema_items({"relationships": [{"name": "r1", "models": None}]})
    assert any(i.get("item_name") == "r1" for i in items)


def test_valid_list_models_unchanged():
    text = describe_schema(
        {
            "relationships": [
                {
                    "name": "r1",
                    "models": ["orders", "customers"],
                    "joinType": "MANY_TO_ONE",
                }
            ]
        }
    )
    assert "orders → customers" in text
