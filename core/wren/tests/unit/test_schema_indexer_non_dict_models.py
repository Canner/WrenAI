"""describe_schema / extract_schema_items skip non-dict top-level entries."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _load():
    path = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "wren"
        / "memory"
        / "schema_indexer.py"
    )
    spec = importlib.util.spec_from_file_location("schema_indexer_solo", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_describe_schema_skips_non_dict_models_rels_views():
    mod = _load()
    text = mod.describe_schema(
        {
            "models": [None, "x", {"name": "orders", "columns": []}],
            "relationships": [None, {"name": "r1"}],
            "views": ["bad", {"name": "v1"}],
        }
    )
    assert "orders" in text
    assert "None" not in text


def test_extract_schema_items_skips_non_dict_models():
    mod = _load()
    items = mod.extract_schema_items(
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
