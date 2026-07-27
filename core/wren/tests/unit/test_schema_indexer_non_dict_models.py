"""describe_schema / extract_schema_items skip non-dict and unnamed entries."""

from __future__ import annotations

import pytest

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


def test_columns_null_does_not_crash_either_path():
    # Regression: an explicit "columns": null must not raise in either path.
    # dict.get(k, default) returns default only when the key is *absent*;
    # an explicit null yields None, so cols[:20] would raise without `or []`.
    manifest = {"models": [{"name": "m", "columns": None}]}

    text = describe_schema(manifest)
    assert "### Model: m" in text

    items = extract_schema_items(manifest)
    names = {i.get("item_name") for i in items}
    assert "m" in names


def test_columns_null_slots_do_not_consume_summary_budget():
    # Regression: filter columns before slicing the 20-column summary so
    # leading nulls don't silently push valid columns out of the embedding
    # text.
    cols = [None] * 5 + [{"name": f"c{i}", "type": "int"} for i in range(25)]
    items = extract_schema_items({"models": [{"name": "m", "columns": cols}]})
    model_rec = next(i for i in items if i["item_type"] == "model")
    # 20 valid columns summarised, none of the leading nulls.
    assert model_rec["text"].count("(int)") == 20
    assert "c0" in model_rec["text"]
    assert "c19" in model_rec["text"]
    assert "c20" not in model_rec["text"]


@pytest.mark.parametrize("section", ["models", "relationships", "views", "cubes"])
def test_non_list_section_raises_valueerror(section):
    # A wrong-typed section (e.g. a hand-edit typo turning "models" into an
    # object) is a structural manifest error, not per-element junk: it must
    # raise rather than silently drop the section and wipe the index.
    manifest = {section: {"name": "oops"}}
    with pytest.raises(ValueError, match=section):
        describe_schema(manifest)
    with pytest.raises(ValueError, match=section):
        extract_schema_items(manifest)


def test_missing_or_null_section_is_treated_as_empty():
    # None / absent sections remain permissive (empty), unlike wrong-typed.
    assert describe_schema({"models": None}) == ""
    assert extract_schema_items({"models": None}) == []
