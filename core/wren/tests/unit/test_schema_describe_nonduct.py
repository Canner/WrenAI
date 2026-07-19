from wren.memory.schema_indexer import describe_schema


def test_describe_schema_skips_nonduct_entries():
    text = describe_schema(
        {
            "models": [
                {"name": "orders", "columns": [{"name": "id", "type": "int"}, "bad"]},
                "not-a-model",
                None,
            ],
            "relationships": ["x", {"name": "r1", "models": ["a", "b"], "joinType": "MANY_TO_ONE"}],
            "views": [None, {"name": "v1", "statement": "SELECT 1"}],
        }
    )
    assert "orders" in text
    assert "not-a-model" not in text
    assert "v1" in text
