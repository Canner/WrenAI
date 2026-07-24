from wren.memory.seed_queries import generate_seed_queries


def test_generate_seed_queries_skips_nonduct_models_and_columns():
    pairs = generate_seed_queries(
        {
            "models": [
                {
                    "name": "orders",
                    "columns": [
                        {"name": "amount", "type": "double"},
                        "bad",
                        {"type": "int"},
                    ],
                },
                "nope",
            ],
            "relationships": ["x"],
        }
    )
    assert any("orders" in p["nl"] for p in pairs)
    assert all(isinstance(p.get("sql"), str) for p in pairs)
