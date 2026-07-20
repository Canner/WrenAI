from wren.dbt import (
    _build_dbt_query_pairs,
    _camelize_props,
    _seed_model_payload,
    _seed_relationship_payload,
)


def test_seed_model_skips_junk_columns():
    payload = _seed_model_payload(
        {
            "name": "orders",
            "columns": [None, {"name": "id"}, "x", {"properties": {}}],
        }
    )
    assert payload is not None
    assert [c["name"] for c in payload["columns"]] == ["id"]


def test_seed_model_rejects_non_dict():
    assert _seed_model_payload(None) is None  # type: ignore[arg-type]
    assert _seed_model_payload({"columns": []}) is None


def test_seed_relationship_rejects_non_dict():
    assert _seed_relationship_payload("x") is None  # type: ignore[arg-type]


def test_camelize_props_tolerates_none():
    assert _camelize_props(None) == {}
    assert _camelize_props("x") == {}  # type: ignore[arg-type]


def test_build_pairs_skips_junk_models(monkeypatch):
    def fake_seed(manifest):
        assert manifest["models"] == [
            {
                "name": "ok",
                "primaryKey": None,
                "properties": {},
                "columns": [],
            }
        ]
        return [{"nl": "q", "sql": "select 1"}]

    monkeypatch.setattr(
        "wren.memory.seed_queries.generate_seed_queries",
        fake_seed,
    )
    pairs = _build_dbt_query_pairs(
        [None, {"name": "ok", "columns": []}, "bad"],
        [None, {"name": "r1"}],
        datasource="postgres",
    )
    assert pairs == [
        {"nl": "q", "sql": "select 1", "source": "dbt", "datasource": "postgres"}
    ]
