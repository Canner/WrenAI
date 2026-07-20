"""Non-dict models/views must not break queryable-name collection."""

from wren.engine import _named_manifest_entries


def test_skips_non_dict_and_nameless():
    models = [
        {"name": "orders"},
        None,
        "bad",
        {"name": ""},
        {"name": "customers"},
        42,
        {"name": 99},
    ]
    assert _named_manifest_entries(models) == {"orders", "customers"}


def test_none_and_empty():
    assert _named_manifest_entries(None) == set()
    assert _named_manifest_entries([]) == set()
    assert _named_manifest_entries("not-a-list") == set()


def test_views_same_guard():
    views = [{"name": "v1"}, [], {"name": "v2"}]
    assert _named_manifest_entries(views) == {"v1", "v2"}
