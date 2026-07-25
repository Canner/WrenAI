"""generate_seed_queries must tolerate non-dict models/relationships."""

from __future__ import annotations

import pytest

from wren.memory.seed_queries import generate_seed_queries

pytestmark = pytest.mark.unit


def test_generate_seed_queries_skips_nonduct_entries() -> None:
    manifest = {
        "models": [
            "bad",
            None,
            {
                "name": "orders",
                "columns": [
                    {"name": "status", "type": "varchar"},
                    "nope",
                ],
            },
            {"columns": [{"name": "x", "type": "int"}]},  # no name
        ],
        "relationships": [
            "bad-rel",
            {
                "models": ["orders", "customers"],
                "condition": "orders.customer_id = customers.id",
            },
        ],
    }
    pairs = generate_seed_queries(manifest)
    nls = [p["nl"] for p in pairs]
    assert any("orders" in nl for nl in nls)
    #relationship pair may appear if both model names exist in layers
    assert all(isinstance(p, dict) and "sql" in p for p in pairs)
