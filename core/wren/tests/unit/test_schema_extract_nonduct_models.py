from wren.memory.schema_indexer import extract_schema_items


def test_extract_skips_nonduct_models_and_columns():
    items = extract_schema_items(
        {
            "models": [
                {
                    "name": "orders",
                    "columns": [
                        {"name": "id", "type": "int"},
                        "bad",
                        {"type": "str"},  # missing name
                    ],
                },
                "nope",
            ],
            "relationships": ["x", {"name": "r", "models": ["a", "b"]}],
            "views": [1, {"name": "v", "statement": "SELECT 1"}],
        }
    )
    kinds = {(i.get("type"), i.get("name")) for i in items}
    assert ("model", "orders") in kinds
    assert ("column", "id") in kinds
    # corrupted entries skipped
    assert all(i.get("name") != "nope" for i in items)
