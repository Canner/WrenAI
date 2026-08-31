"""Unit tests for wren.context — load/validate/build YAML→JSON."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wren.context import (
    UpgradeError,
    _convert_keys,
    _snake_to_camel,
    apply_upgrade,
    build_json,
    build_manifest,
    convert_mdl_to_project,
    discover_project_path,
    get_schema_version,
    load_cubes,
    load_instructions,
    load_models,
    load_relationships,
    load_views,
    plan_upgrade,
    require_schema_version,
    save_target,
    validate_project,
)

# ── Case conversion ────────────────────────────────────────────────────────


def test_snake_to_camel():
    assert _snake_to_camel("table_reference") == "tableReference"
    assert _snake_to_camel("is_primary_key") == "isPrimaryKey"
    assert _snake_to_camel("ref_sql") == "refSql"
    assert _snake_to_camel("join_type") == "joinType"
    assert _snake_to_camel("not_null") == "notNull"
    assert _snake_to_camel("is_calculated") == "isCalculated"
    assert _snake_to_camel("primary_key") == "primaryKey"
    assert _snake_to_camel("data_source") == "dataSource"
    assert _snake_to_camel("name") == "name"


def test_snake_to_camel_preserves_leading_underscore():
    # Sentinel keys like `_instructions` must keep their leading underscore
    # and not capitalize the first real word (the naive split mangled this
    # into "Instructions").
    assert _snake_to_camel("_instructions") == "_instructions"
    assert _snake_to_camel("_dbt_tests") == "_dbtTests"
    assert _snake_to_camel("__double") == "__double"


def test_convert_keys_does_not_mangle_nested_instructions():
    # A nested `_instructions` carrier must survive the camelCase pass intact;
    # the top-level pop workarounds elsewhere don't protect nested ones.
    obj = {"models": [{"name": "m", "_instructions": "do x"}]}
    result = _convert_keys(obj)
    assert result["models"][0]["_instructions"] == "do x"
    assert "Instructions" not in result["models"][0]


def test_convert_keys_nested():
    obj = {
        "table_reference": {"catalog": "c", "schema_name": "s"},
        "columns": [{"is_calculated": False, "not_null": True}],
    }
    result = _convert_keys(obj)
    assert "tableReference" in result
    assert "schemaName" in result["tableReference"]
    assert result["columns"][0]["isCalculated"] is False
    assert result["columns"][0]["notNull"] is True


# ── Schema version ─────────────────────────────────────────────────────────


def test_get_schema_version_default(tmp_path):
    (tmp_path / "wren_project.yml").write_text("name: test\ndata_source: postgres\n")
    assert get_schema_version(tmp_path) == 1


def test_get_schema_version_explicit(tmp_path):
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 2\nname: test\ndata_source: postgres\n"
    )
    assert get_schema_version(tmp_path) == 2


def test_require_schema_version_unsupported(tmp_path):
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 99\nname: test\ndata_source: postgres\n"
    )
    with pytest.raises(SystemExit, match="unsupported schema_version"):
        require_schema_version(tmp_path)


# ── load_models (v2) ──────────────────────────────────────────────────────


def _make_v2_project(tmp_path: Path, schema_version: int = 2) -> Path:
    """Write wren_project.yml with the given schema_version."""
    (tmp_path / "wren_project.yml").write_text(
        f"schema_version: {schema_version}\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
    )
    return tmp_path


def test_load_models_from_dirs(tmp_path):
    _make_v2_project(tmp_path)
    model_dir = tmp_path / "models" / "orders"
    model_dir.mkdir(parents=True)
    (model_dir / "metadata.yml").write_text(
        "name: orders\ntable_reference:\n  table: orders\ncolumns: []\n"
    )
    models = load_models(tmp_path)
    assert len(models) == 1
    assert models[0]["name"] == "orders"


def test_load_models_sorted(tmp_path):
    _make_v2_project(tmp_path)
    for name in ("zebra", "apple", "mango"):
        d = tmp_path / "models" / name
        d.mkdir(parents=True)
        (d / "metadata.yml").write_text(
            f"name: {name}\ntable_reference:\n  table: {name}\n"
        )
    models = load_models(tmp_path)
    names = [m["name"] for m in models]
    assert names == sorted(names)


def test_load_models_ref_sql_file(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "revenue"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: revenue\ncolumns: []\n")
    (d / "ref_sql.sql").write_text("SELECT 1 AS x")
    models = load_models(tmp_path)
    assert models[0]["ref_sql"] == "SELECT 1 AS x"


def test_load_models_ref_sql_file_precedence(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "revenue"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: revenue\nref_sql: SELECT 0\ncolumns: []\n")
    (d / "ref_sql.sql").write_text("SELECT 1 AS x")
    models = load_models(tmp_path)
    assert models[0]["ref_sql"] == "SELECT 1 AS x"


def test_load_models_inline_ref_sql(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "active"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: active\nref_sql: SELECT DISTINCT id FROM orders\ncolumns: []\n"
    )
    models = load_models(tmp_path)
    assert models[0]["ref_sql"] == "SELECT DISTINCT id FROM orders"


def test_load_models_table_reference(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        'name: orders\ntable_reference:\n  catalog: ""\n  schema: public\n  table: orders\ncolumns: []\n'
    )
    models = load_models(tmp_path)
    assert models[0]["table_reference"]["table"] == "orders"


def test_load_models_skips_non_dir(tmp_path):
    _make_v2_project(tmp_path)
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    (models_dir / "stray.yml").write_text("name: stray\n")
    models = load_models(tmp_path)
    assert models == []


def test_load_models_skips_missing_metadata(tmp_path):
    _make_v2_project(tmp_path)
    (tmp_path / "models" / "empty_dir").mkdir(parents=True)
    models = load_models(tmp_path)
    assert models == []


# ── load_views (v2) ───────────────────────────────────────────────────────


def test_load_views_from_dirs(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "views" / "monthly"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: monthly\nstatement: SELECT 1\n")
    views = load_views(tmp_path)
    assert len(views) == 1
    assert views[0]["name"] == "monthly"


def test_load_views_sql_yml_precedence(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "views" / "monthly"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: monthly\nstatement: SELECT 0\n")
    (d / "sql.yml").write_text("statement: SELECT 1\n")
    views = load_views(tmp_path)
    assert views[0]["statement"].strip() == "SELECT 1"


def test_load_views_inline_statement(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "views" / "top"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: top\nstatement: SELECT * FROM orders LIMIT 10\n"
    )
    views = load_views(tmp_path)
    assert "SELECT" in views[0]["statement"]


def test_load_views_skips_non_dir(tmp_path):
    _make_v2_project(tmp_path)
    views_dir = tmp_path / "views"
    views_dir.mkdir()
    (views_dir / "stray.yml").write_text("name: stray\n")
    views = load_views(tmp_path)
    assert views == []


def test_load_views_skips_missing_metadata(tmp_path):
    _make_v2_project(tmp_path)
    (tmp_path / "views" / "empty_dir").mkdir(parents=True)
    views = load_views(tmp_path)
    assert views == []


# ── load_models / load_views (v1) ─────────────────────────────────────────


def test_load_models_v1_flat_files(tmp_path):
    _make_v2_project(tmp_path, schema_version=1)
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    (models_dir / "orders.yml").write_text(
        "name: orders\ntable_reference:\n  table: orders\n"
    )
    models = load_models(tmp_path)
    assert len(models) == 1
    assert models[0]["name"] == "orders"


def test_load_views_v1_single_file(tmp_path):
    _make_v2_project(tmp_path, schema_version=1)
    (tmp_path / "views.yml").write_text(
        "views:\n  - name: v1\n    statement: SELECT 1\n"
    )
    views = load_views(tmp_path)
    assert len(views) == 1
    assert views[0]["name"] == "v1"


# ── load_relationships ────────────────────────────────────────────────────


def test_load_relationships(tmp_path):
    _make_v2_project(tmp_path)
    (tmp_path / "relationships.yml").write_text(
        "relationships:\n"
        "  - name: orders_customers\n"
        "    models: [orders, customers]\n"
        "    join_type: MANY_TO_ONE\n"
        "    condition: orders.customer_id = customers.customer_id\n"
    )
    rels = load_relationships(tmp_path)
    assert len(rels) == 1
    assert rels[0]["name"] == "orders_customers"


# ── load_instructions ─────────────────────────────────────────────────────


def test_load_instructions(tmp_path):
    _make_v2_project(tmp_path)
    (tmp_path / "instructions.md").write_text("## Rule 1\nAlways use snake_case.\n")
    result = load_instructions(tmp_path)
    assert result is not None
    assert "Rule 1" in result


def test_load_instructions_missing(tmp_path):
    _make_v2_project(tmp_path)
    assert load_instructions(tmp_path) is None


# ── knowledge/ rules + version axis (O3) ──────────────────────────────────


def test_load_knowledge_rules_concatenates_sorted(tmp_path):
    from wren.context import load_knowledge_rules  # noqa: PLC0415

    _make_v2_project(tmp_path)
    rdir = tmp_path / "knowledge" / "rules"
    rdir.mkdir(parents=True)
    (rdir / "b_units.md").write_text("Amounts are USD.\n")
    (rdir / "a_filters.md").write_text("Exclude soft-deleted rows.\n")
    result = load_knowledge_rules(tmp_path)
    # sorted by filename: a_filters before b_units
    assert result == "Exclude soft-deleted rows.\n\nAmounts are USD."


def test_load_knowledge_rules_missing(tmp_path):
    from wren.context import load_knowledge_rules  # noqa: PLC0415

    _make_v2_project(tmp_path)
    assert load_knowledge_rules(tmp_path) is None


def test_load_rules_combines_knowledge_and_legacy(tmp_path):
    from wren.context import load_rules  # noqa: PLC0415

    _make_v2_project(tmp_path)
    (tmp_path / "knowledge" / "rules").mkdir(parents=True)
    (tmp_path / "knowledge" / "rules" / "general.md").write_text("From knowledge.\n")
    (tmp_path / "instructions.md").write_text("From legacy.\n")
    content, used_legacy = load_rules(tmp_path)
    assert content == "From knowledge.\n\nFrom legacy."
    assert used_legacy is True


def test_load_rules_knowledge_only_no_legacy_flag(tmp_path):
    from wren.context import load_rules  # noqa: PLC0415

    _make_v2_project(tmp_path)
    (tmp_path / "knowledge" / "rules").mkdir(parents=True)
    (tmp_path / "knowledge" / "rules" / "general.md").write_text("Only knowledge.\n")
    content, used_legacy = load_rules(tmp_path)
    assert content == "Only knowledge."
    assert used_legacy is False


def test_load_rules_flags_empty_legacy_file(tmp_path):
    """An existing-but-empty instructions.md still flags the deprecated pattern."""
    from wren.context import load_rules  # noqa: PLC0415

    _make_v2_project(tmp_path)
    (tmp_path / "instructions.md").write_text("")
    content, used_legacy = load_rules(tmp_path)
    assert content is None  # empty file contributes no content
    assert used_legacy is True


def test_get_knowledge_schema_version(tmp_path):
    from wren.context import create_knowledge_skeleton, get_knowledge_schema_version  # noqa: PLC0415

    _make_v2_project(tmp_path)
    assert get_knowledge_schema_version(tmp_path) == 0  # no knowledge/ yet
    create_knowledge_skeleton(tmp_path)
    assert get_knowledge_schema_version(tmp_path) == 1


def test_validate_reports_malformed_knowledge_yml(tmp_path):
    """A malformed knowledge.yml surfaces as a ValidationError, not a crash."""
    _make_v2_project(tmp_path, schema_version=5)
    (tmp_path / "knowledge").mkdir()
    (tmp_path / "knowledge" / "knowledge.yml").write_text(
        "schema_version: [unterminated\n"
    )
    errors = validate_project(tmp_path)
    assert any("knowledge" in e.path and "invalid YAML" in e.message for e in errors)


def test_validate_rejects_unsupported_knowledge_version(tmp_path):
    _make_v2_project(tmp_path, schema_version=5)
    (tmp_path / "knowledge").mkdir()
    (tmp_path / "knowledge" / "knowledge.yml").write_text("schema_version: 99\n")
    errors = validate_project(tmp_path)
    assert any(
        "knowledge" in e.path and "unsupported knowledge schema_version" in e.message
        for e in errors
    )


# ── build_manifest / build_json ───────────────────────────────────────────


def _minimal_v2_project(tmp_path: Path) -> Path:
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        'table_reference:\n  catalog: ""\n  schema: public\n  table: orders\n'
        "columns:\n  - name: id\n    type: INTEGER\n    is_calculated: false\n    not_null: true\n    is_primary_key: true\n    properties: {}\n"
        "primary_key: id\ncached: false\nproperties: {}\n"
    )
    return tmp_path


def test_build_manifest_snake_case(tmp_path):
    _minimal_v2_project(tmp_path)
    manifest = build_manifest(tmp_path)
    model = manifest["models"][0]
    assert "table_reference" in model
    assert "is_calculated" in model["columns"][0]
    assert "primary_key" in model
    assert "_instructions" not in manifest


def test_build_json_camel_case(tmp_path):
    _minimal_v2_project(tmp_path)
    result = build_json(tmp_path)
    model = result["models"][0]
    assert "tableReference" in model
    assert "isCalculated" in model["columns"][0]
    assert "primaryKey" in model
    assert "_instructions" not in result


def test_build_manifest_includes_data_source(tmp_path):
    """build_manifest must include data_source from project config."""
    _minimal_v2_project(tmp_path)
    manifest = build_manifest(tmp_path)
    assert manifest["data_source"] == "postgres"


def test_build_json_includes_data_source(tmp_path):
    """build_json must include dataSource (camelCase) from project config."""
    _minimal_v2_project(tmp_path)
    result = build_json(tmp_path)
    assert result["dataSource"] == "postgres"


def test_build_manifest_omits_data_source_when_unset(tmp_path):
    """If project config lacks data_source, the field is omitted."""
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 2\nname: test\ncatalog: wren\nschema: public\n"
    )
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\ntable_reference:\n  table: orders\ncolumns: []\n"
    )
    manifest = build_manifest(tmp_path)
    assert "data_source" not in manifest


def test_build_json_round_trip(tmp_path):
    _minimal_v2_project(tmp_path)
    result = build_json(tmp_path)
    serialized = json.dumps(result)
    parsed = json.loads(serialized)
    assert parsed["models"][0]["tableReference"]["table"] == "orders"
    assert parsed["models"][0]["primaryKey"] == "id"


def test_build_json_no_instructions(tmp_path):
    """_instructions must not appear in build output even when instructions.md exists."""
    _minimal_v2_project(tmp_path)
    (tmp_path / "instructions.md").write_text("## Rule\nAlways use UTC.\n")
    result = build_json(tmp_path)
    assert "_instructions" not in result


def test_mdl_json_clean(tmp_path):
    """target/mdl.json written by save_target must not contain _instructions."""
    _minimal_v2_project(tmp_path)
    (tmp_path / "instructions.md").write_text("## Rule\nAlways use UTC.\n")
    manifest_json = build_json(tmp_path)
    out = save_target(manifest_json, tmp_path)
    data = json.loads(out.read_text())
    assert "_instructions" not in data


# ── save_target ───────────────────────────────────────────────────────────


def test_save_target_creates_dir(tmp_path):
    _make_v2_project(tmp_path)
    manifest = {"catalog": "wren", "schema": "public", "models": []}
    out = save_target(manifest, tmp_path)
    assert out.exists()
    assert out.name == "mdl.json"
    loaded = json.loads(out.read_text())
    assert loaded["catalog"] == "wren"


# ── validate_project ──────────────────────────────────────────────────────


def _make_valid_project(tmp_path: Path) -> Path:
    """Build a minimal valid v2 project."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
        "primary_key: id\n"
    )
    (tmp_path / "relationships.yml").write_text("relationships: []\n")
    return tmp_path


def test_validate_valid_project(tmp_path):
    _make_valid_project(tmp_path)
    errors = validate_project(tmp_path)
    assert errors == []


def test_validate_missing_project_yml(tmp_path):
    errors = validate_project(tmp_path)
    hard = [e for e in errors if e.level == "error"]
    assert any("not found" in e.message for e in hard)


def test_validate_missing_data_source(tmp_path):
    (tmp_path / "wren_project.yml").write_text("schema_version: 2\nname: test\n")
    errors = validate_project(tmp_path)
    assert any("data_source" in e.message for e in errors)


def test_validate_unsupported_schema_version(tmp_path):
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 99\nname: test\ndata_source: postgres\n"
    )
    errors = validate_project(tmp_path)
    assert any("unsupported schema_version" in e.message for e in errors)


def test_validate_missing_model_name(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "noname"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("table_reference:\n  table: t\ncolumns: []\n")
    errors = validate_project(tmp_path)
    assert any("missing 'name'" in e.message for e in errors)


def test_validate_duplicate_model(tmp_path):
    _make_v2_project(tmp_path)
    for folder in ("a", "b"):
        d = tmp_path / "models" / folder
        d.mkdir(parents=True)
        (d / "metadata.yml").write_text(
            "name: orders\ntable_reference:\n  table: orders\ncolumns: []\n"
        )
    errors = validate_project(tmp_path)
    assert any("duplicate model name" in e.message for e in errors)


def test_validate_model_name_list_reports_error(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: [a, b]\ntable_reference:\n  table: orders\ncolumns: []\n"
    )
    errors = validate_project(tmp_path)
    assert any(
        "model 'name' must be a scalar value, got list" in e.message for e in errors
    )


def test_validate_model_name_dict_reports_error(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: {x: 1}\ntable_reference:\n  table: orders\ncolumns: []\n"
    )
    errors = validate_project(tmp_path)
    assert any(
        "model 'name' must be a scalar value, got dict" in e.message for e in errors
    )


def test_validate_model_name_int_is_not_rejected(tmp_path):
    # An int name is unusual but hashable, so it never hit the crash this guard
    # exists for; the guard must not turn it into a new validation error.
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: 3\ntable_reference:\n  table: orders\ncolumns: []\n"
    )
    errors = validate_project(tmp_path)
    assert not any("must be a scalar value" in e.message for e in errors)


def test_validate_model_name_empty_list_reports_scalar_error_not_missing(tmp_path):
    # An empty list is falsy, so the type guard must run before the missing-name
    # check or this reports "missing 'name'" instead of the malformed type.
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: []\ntable_reference:\n  table: orders\ncolumns: []\n"
    )
    errors = validate_project(tmp_path)
    assert any(
        "model 'name' must be a scalar value, got list" in e.message for e in errors
    )
    assert not any("model missing 'name'" in e.message for e in errors)


def test_validate_model_name_empty_dict_reports_scalar_error_not_missing(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: {}\ntable_reference:\n  table: orders\ncolumns: []\n"
    )
    errors = validate_project(tmp_path)
    assert any(
        "model 'name' must be a scalar value, got dict" in e.message for e in errors
    )
    assert not any("model missing 'name'" in e.message for e in errors)


def test_validate_both_tref_and_ref_sql(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "conflict"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: conflict\ntable_reference:\n  table: t\nref_sql: SELECT 1\ncolumns: []\n"
    )
    errors = validate_project(tmp_path)
    assert any("both 'table_reference' and 'ref_sql'" in e.message for e in errors)


def test_validate_neither_tref_nor_ref_sql(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "empty"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: empty\ncolumns: []\n")
    errors = validate_project(tmp_path)
    assert any("must define either" in e.message for e in errors)


def test_validate_pk_not_in_columns(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
        "primary_key: missing_col\n"
    )
    errors = validate_project(tmp_path)
    assert any("not found in columns" in e.message for e in errors)


def test_validate_pk_invalid_type(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
        "primary_key: 123\n"
    )
    # Must not raise (no TypeError) and must flag the malformed shape.
    errors = validate_project(tmp_path)
    assert any("must be a non-empty string or list" in e.message for e in errors)


def test_validate_composite_pk_missing_col(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n  - name: a\n    type: INTEGER\n"
        "primary_key:\n  - a\n  - missing_col\n"
    )
    errors = validate_project(tmp_path)
    assert any("primary_key 'missing_col' not found" in e.message for e in errors)


def test_validate_composite_pk_all_present(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n  - name: a\n    type: INTEGER\n  - name: b\n    type: INTEGER\n"
        "primary_key:\n  - a\n  - b\n"
    )
    errors = validate_project(tmp_path)
    assert not any("not found in columns" in e.message for e in errors)


def test_validate_composite_pk_requires_schema_version_4(tmp_path):
    _make_v2_project(tmp_path, schema_version=3)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n  - name: a\n    type: INTEGER\n  - name: b\n    type: INTEGER\n"
        "primary_key:\n  - a\n  - b\n"
    )
    errors = validate_project(tmp_path)
    assert any("requires schema_version >= 4" in e.message for e in errors)


def test_validate_composite_pk_ok_at_schema_version_4(tmp_path):
    _make_v2_project(tmp_path, schema_version=4)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n  - name: a\n    type: INTEGER\n  - name: b\n    type: INTEGER\n"
        "primary_key:\n  - a\n  - b\n"
    )
    errors = validate_project(tmp_path)
    assert not any("requires schema_version >= 4" in e.message for e in errors)


def test_validate_relationship_unknown_model(tmp_path):
    _make_valid_project(tmp_path)
    (tmp_path / "relationships.yml").write_text(
        "relationships:\n"
        "  - name: bad_rel\n"
        "    models: [orders, nonexistent]\n"
        "    join_type: MANY_TO_ONE\n"
        "    condition: a = b\n"
    )
    errors = validate_project(tmp_path)
    assert any("unknown model" in e.message for e in errors)


def test_validate_view_no_statement(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "views" / "nostatement"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: nostatement\ndescription: bad\n")
    errors = validate_project(tmp_path)
    assert any("missing 'statement'" in e.message for e in errors)


def test_validate_view_name_list_reports_error(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "views" / "monthly"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: [a, b]\nstatement: SELECT 1\n")
    errors = validate_project(tmp_path)
    assert any(
        "view 'name' must be a scalar value, got list" in e.message for e in errors
    )


def test_validate_view_name_dict_reports_error(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "views" / "monthly"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: {x: 1}\nstatement: SELECT 1\n")
    errors = validate_project(tmp_path)
    assert any(
        "view 'name' must be a scalar value, got dict" in e.message for e in errors
    )


def test_validate_view_name_empty_list_reports_scalar_error_not_missing(tmp_path):
    # An empty list is falsy, so the type guard must run before the missing-name
    # check or this reports "missing 'name'" instead of the malformed type.
    _make_v2_project(tmp_path)
    d = tmp_path / "views" / "monthly"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: []\nstatement: SELECT 1\n")
    errors = validate_project(tmp_path)
    assert any(
        "view 'name' must be a scalar value, got list" in e.message for e in errors
    )
    assert not any("view missing 'name'" in e.message for e in errors)


def test_validate_view_name_empty_dict_reports_scalar_error_not_missing(tmp_path):
    _make_v2_project(tmp_path)
    d = tmp_path / "views" / "monthly"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: {}\nstatement: SELECT 1\n")
    errors = validate_project(tmp_path)
    assert any(
        "view 'name' must be a scalar value, got dict" in e.message for e in errors
    )
    assert not any("view missing 'name'" in e.message for e in errors)


def test_validate_missing_join_type(tmp_path):
    _make_valid_project(tmp_path)
    (tmp_path / "relationships.yml").write_text(
        "relationships:\n  - name: r\n    models: [orders]\n    condition: a = b\n"
    )
    errors = validate_project(tmp_path)
    warnings = [e for e in errors if e.level == "warning"]
    assert any("join_type" in e.message for e in warnings)


# ── discover_project_path ─────────────────────────────────────────────────


def test_discover_walk_up(tmp_path, monkeypatch):
    # project file in parent; cwd is a subdir
    subdir = tmp_path / "sub" / "deep"
    subdir.mkdir(parents=True)
    (tmp_path / "wren_project.yml").write_text("name: test\ndata_source: pg\n")
    monkeypatch.chdir(subdir)
    result = discover_project_path()
    assert result == tmp_path


def test_discover_no_project_raises(tmp_path, monkeypatch):
    """No project found anywhere — discover_project_path raises SystemExit."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("WREN_PROJECT_HOME", raising=False)
    # Use a non-existent WREN_HOME so no config.yml can be found
    monkeypatch.setenv("WREN_HOME", str(tmp_path / "empty_wren_home"))
    import importlib  # noqa: PLC0415

    import wren.context as ctx  # noqa: PLC0415

    importlib.reload(ctx)
    with pytest.raises(SystemExit, match="no wren project found"):
        ctx.discover_project_path()


def test_discover_via_env_var(tmp_path, monkeypatch):
    """WREN_PROJECT_HOME env var overrides cwd walk."""
    project_dir = tmp_path / "my_project"
    project_dir.mkdir()
    (project_dir / "wren_project.yml").write_text("name: test\ndata_source: pg\n")
    monkeypatch.setenv("WREN_PROJECT_HOME", str(project_dir))
    result = discover_project_path()
    assert result == project_dir


def test_discover_via_config(tmp_path, monkeypatch):
    """~/.wren/config.yml default_project used as last fallback."""
    project_dir = tmp_path / "my_project"
    project_dir.mkdir()
    (project_dir / "wren_project.yml").write_text("name: test\ndata_source: pg\n")
    wren_home = tmp_path / "wren_home"
    wren_home.mkdir()
    (wren_home / "config.yml").write_text(f"default_project: {project_dir}\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("WREN_PROJECT_HOME", raising=False)
    monkeypatch.setenv("WREN_HOME", str(wren_home))
    import importlib  # noqa: PLC0415

    import wren.context as ctx  # noqa: PLC0415

    importlib.reload(ctx)
    result = ctx.discover_project_path()
    assert result == project_dir


# ── Schema version 3 / dialect / layoutVersion ──────────────────────────────


def _make_v3_project(tmp_path: Path) -> Path:
    """Write a minimal v3 project with dialect support."""
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 3\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
    )
    return tmp_path


def test_get_schema_version_v3(tmp_path):
    _make_v3_project(tmp_path)
    assert get_schema_version(tmp_path) == 3


def test_require_schema_version_v3(tmp_path):
    _make_v3_project(tmp_path)
    assert require_schema_version(tmp_path) == 3


def test_build_json_layout_version_v2_project(tmp_path):
    """schema_version 2 → layoutVersion 1."""
    _minimal_v2_project(tmp_path)
    result = build_json(tmp_path)
    assert result["layoutVersion"] == 1


def test_build_json_layout_version_v3_project(tmp_path):
    """schema_version 3 → layoutVersion 2."""
    _make_v3_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
    )
    result = build_json(tmp_path)
    assert result["layoutVersion"] == 2


def test_build_json_model_dialect_preserved(tmp_path):
    """Model dialect field flows through to JSON output."""
    _make_v3_project(tmp_path)
    d = tmp_path / "models" / "revenue"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: revenue\n"
        "table_reference:\n  table: revenue\n"
        "dialect: bigquery\n"
        "columns:\n  - name: amount\n    type: decimal\n"
    )
    result = build_json(tmp_path)
    assert result["models"][0]["dialect"] == "bigquery"


def test_build_json_view_dialect_preserved(tmp_path):
    """View dialect field flows through to JSON output."""
    _make_v3_project(tmp_path)
    d = tmp_path / "views" / "summary"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: summary\nstatement: SELECT 1\ndialect: postgres\n"
    )
    result = build_json(tmp_path)
    assert result["views"][0]["dialect"] == "postgres"


def test_v3_models_load_same_as_v2(tmp_path):
    """schema_version 3 uses the same directory layout as v2."""
    _make_v3_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: orders\ntable_reference:\n  table: orders\n")
    models = load_models(tmp_path)
    assert len(models) == 1
    assert models[0]["name"] == "orders"


# ── Schema version 5 / unified layout (U0.1) ────────────────────────────────

# Golden fixture shared with the SaaS encoder (Track S) as the v5 layout contract.
V5_GOLDEN = Path(__file__).resolve().parents[4] / "examples" / "v5-jaffle"


def test_schema_version_5_recognized(tmp_path):
    """v5 wren_project.yml is supported, not reported as unsupported."""
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 5\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
    )
    assert get_schema_version(tmp_path) == 5
    assert require_schema_version(tmp_path) == 5


def test_build_json_layout_version_v5_project(tmp_path):
    """schema_version 5 → layoutVersion 3 (reuses v4 engine wire format)."""
    _make_v2_project(tmp_path, schema_version=5)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
    )
    result = build_json(tmp_path)
    assert result["layoutVersion"] == 3


def test_v5_models_load_same_as_v2(tmp_path):
    """schema_version 5 uses the same per-folder reader as v2."""
    _make_v2_project(tmp_path, schema_version=5)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: orders\ntable_reference:\n  table: orders\n")
    models = load_models(tmp_path)
    assert len(models) == 1
    assert models[0]["name"] == "orders"


def test_v5_golden_has_no_structural_errors():
    """The shipped v5 golden fixture validates clean (no errors)."""
    assert V5_GOLDEN.exists(), f"missing golden fixture at {V5_GOLDEN}"
    errors = [e for e in validate_project(V5_GOLDEN) if e.level == "error"]
    assert errors == [], "\n".join(str(e) for e in errors)


def test_v5_golden_builds():
    """build_json on the v5 golden fixture succeeds and stamps layoutVersion 3."""
    assert get_schema_version(V5_GOLDEN) == 5
    result = build_json(V5_GOLDEN)
    assert result["layoutVersion"] == 3
    model_names = {m["name"] for m in result["models"]}
    assert {"customers", "orders"} <= model_names
    # ref_sql.sql is merged into the orders model
    orders = next(m for m in result["models"] if m["name"] == "orders")
    assert "raw_orders" in orders["refSql"]
    # relationships, views, and cubes flow through
    assert any(r["name"] == "orders_customer" for r in result["relationships"])
    assert any(v["name"] == "customer_orders" for v in result["views"])
    assert any(c["name"] == "order_metrics" for c in result["cubes"])


def test_convert_mdl_preserves_dialect(tmp_path):
    """convert_mdl_to_project preserves dialect on models and views."""
    mdl = {
        "layoutVersion": 2,
        "catalog": "wren",
        "schema": "public",
        "dataSource": "POSTGRES",
        "models": [
            {
                "name": "revenue",
                "tableReference": {"table": "revenue"},
                "dialect": "bigquery",
                "columns": [{"name": "amount", "type": "decimal"}],
            }
        ],
        "views": [
            {
                "name": "summary",
                "statement": "SELECT 1",
                "dialect": "postgres",
            }
        ],
    }
    files = convert_mdl_to_project(mdl)
    file_map = {f.relative_path: f.content for f in files}

    # Check schema_version derived from layoutVersion 2
    import yaml

    project = yaml.safe_load(file_map["wren_project.yml"])
    assert project["schema_version"] == 3

    # Check model dialect preserved
    model_meta = yaml.safe_load(file_map["models/revenue/metadata.yml"])
    assert model_meta["dialect"] == "bigquery"

    # Check view dialect preserved
    view_meta = yaml.safe_load(file_map["views/summary/metadata.yml"])
    assert view_meta["dialect"] == "postgres"


def test_convert_mdl_v1_layout_version(tmp_path):
    """layoutVersion 1 (or missing) → schema_version 2."""
    mdl = {
        "catalog": "wren",
        "schema": "public",
        "models": [],
    }
    files = convert_mdl_to_project(mdl)
    import yaml

    file_map = {f.relative_path: f.content for f in files}
    project = yaml.safe_load(file_map["wren_project.yml"])
    assert project["schema_version"] == 2


def test_validate_dialect_unknown_value(tmp_path):
    """Unknown dialect value is an error."""
    _make_v3_project(tmp_path)
    d = tmp_path / "models" / "bad"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: bad\n"
        "table_reference:\n  table: bad\n"
        "dialect: nosuchdb\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
    )
    errors = validate_project(tmp_path)
    assert any("unknown dialect" in e.message for e in errors)


def test_validate_dialect_valid_value(tmp_path):
    """Valid dialect does not produce errors."""
    _make_v3_project(tmp_path)
    d = tmp_path / "models" / "ok"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: ok\n"
        "table_reference:\n  table: ok\n"
        "dialect: bigquery\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
        "primary_key: id\n"
    )
    (tmp_path / "relationships.yml").write_text("relationships: []\n")
    errors = validate_project(tmp_path)
    assert errors == []


def test_validate_dialect_warning_in_v2(tmp_path):
    """dialect on a schema_version 2 project produces a warning."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "mixed"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: mixed\n"
        "table_reference:\n  table: mixed\n"
        "dialect: bigquery\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
    )
    errors = validate_project(tmp_path)
    warnings = [e for e in errors if e.level == "warning"]
    assert any("schema_version >= 3" in w.message for w in warnings)


def test_validate_view_dialect_unknown(tmp_path):
    """Unknown dialect on a view is an error."""
    _make_v3_project(tmp_path)
    d = tmp_path / "views" / "badview"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: badview\nstatement: SELECT 1\ndialect: nosuchdb\n"
    )
    errors = validate_project(tmp_path)
    assert any("unknown dialect" in e.message for e in errors)


# ── Cubes ───────────────────────────────────────────────────────────────────


def _make_v2_cube_project(tmp_path: Path) -> Path:
    """v2 project with an orders model, ready for cubes/*/metadata.yml files."""
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 2\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
    )
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n"
        "  - name: o_totalprice\n    type: double\n"
        "  - name: o_orderstatus\n    type: varchar\n"
    )
    return tmp_path


def _write_cube(tmp_path: Path, name: str, content: str) -> Path:
    cube_dir = tmp_path / "cubes" / name
    cube_dir.mkdir(parents=True)
    cube_file = cube_dir / "metadata.yml"
    cube_file.write_text(content)
    return cube_file


def test_load_cubes_returns_empty_when_no_dir(tmp_path):
    assert load_cubes(tmp_path) == []


def test_load_cubes_v1_parses_flat_yaml(tmp_path):
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 1\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
    )
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "order_metrics.yml").write_text(
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: revenue\n    expression: SUM(o_totalprice)\n    type: DOUBLE\n"
    )
    cubes = load_cubes(tmp_path)
    assert len(cubes) == 1
    assert cubes[0]["name"] == "order_metrics"


def test_load_cubes_v2_parses_metadata_yaml(tmp_path):
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "order_metrics",
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: revenue\n    expression: SUM(o_totalprice)\n    type: DOUBLE\n"
        "dimensions:\n"
        "  - name: status\n    expression: o_orderstatus\n    type: VARCHAR\n",
    )
    cubes = load_cubes(tmp_path)
    assert len(cubes) == 1
    assert cubes[0]["name"] == "order_metrics"
    assert cubes[0]["base_object"] == "orders"
    assert cubes[0]["measures"][0]["name"] == "revenue"


def test_load_cubes_v2_ignores_flat_yaml(tmp_path):
    _make_v2_cube_project(tmp_path)
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "order_metrics.yml").write_text(
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: revenue\n    expression: SUM(o_totalprice)\n    type: DOUBLE\n"
    )
    assert load_cubes(tmp_path) == []


def test_load_cubes_v3_uses_v2_layout(tmp_path):
    _make_v2_cube_project(tmp_path)
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 3\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
    )
    _write_cube(
        tmp_path,
        "order_metrics",
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: revenue\n    expression: SUM(o_totalprice)\n    type: DOUBLE\n",
    )
    cubes = load_cubes(tmp_path)
    assert len(cubes) == 1
    assert cubes[0]["name"] == "order_metrics"


def test_build_manifest_includes_cubes(tmp_path):
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "order_metrics",
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: revenue\n    expression: SUM(o_totalprice)\n    type: DOUBLE\n",
    )
    manifest = build_manifest(tmp_path)
    assert "cubes" in manifest
    assert manifest["cubes"][0]["name"] == "order_metrics"
    assert "_source_file" not in manifest["cubes"][0]


def test_build_json_cube_camel_case(tmp_path):
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "order_metrics",
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: revenue\n    expression: SUM(o_totalprice)\n    type: DOUBLE\n"
        "time_dimensions:\n"
        "  - name: created_at\n    expression: o_orderdate\n    type: DATE\n",
    )
    result = build_json(tmp_path)
    cube = result["cubes"][0]
    assert cube["baseObject"] == "orders"
    assert cube["timeDimensions"][0]["name"] == "created_at"


def test_validate_cube_unknown_base_object(tmp_path):
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "bad",
        "name: bad\nbase_object: nosuch\nmeasures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n",
    )
    errors = validate_project(tmp_path)
    assert any("base_object 'nosuch'" in e.message for e in errors)


def test_validate_cube_duplicate_name(tmp_path):
    _make_v2_cube_project(tmp_path)
    body = (
        "name: order_metrics\nbase_object: orders\n"
        "measures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n"
    )
    _write_cube(tmp_path, "a", body)
    _write_cube(tmp_path, "b", body)
    errors = validate_project(tmp_path)
    assert any("duplicate cube name" in e.message for e in errors)


def test_validate_cube_missing_base_object_uses_snake_case(tmp_path):
    """Validation error should reference the YAML field name (snake_case)."""
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "om",
        "name: order_metrics\n"
        "measures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n",
    )
    errors = validate_project(tmp_path)
    assert any("'base_object'" in e.message for e in errors)
    assert not any("baseObject" in e.message for e in errors)


def test_validate_cube_non_string_hierarchy_level(tmp_path):
    """Non-string hierarchy levels must be reported, not crash."""
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "om",
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n"
        "dimensions: [{name: status, expression: o_orderstatus, type: VARCHAR}]\n"
        "hierarchies:\n"
        "  drill:\n"
        "    - status\n"
        "    - [nested, list]\n",
    )
    errors = validate_project(tmp_path)
    assert any("hierarchy levels must be strings" in e.message for e in errors)


def test_validate_cube_bad_hierarchy(tmp_path):
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "om",
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n"
        "dimensions: [{name: status, expression: o_orderstatus, type: VARCHAR}]\n"
        "hierarchies:\n"
        "  drill: [status, nonexistent_dim]\n",
    )
    errors = validate_project(tmp_path)
    assert any("nonexistent_dim" in e.message for e in errors)


def test_load_cubes_drops_non_dict_member_entries(tmp_path):
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "om",
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: c\n    expression: 'COUNT(*)'\n    type: BIGINT\n"
        "  - nope\n"
        "dimensions: not-a-list\n",
    )
    cubes = load_cubes(tmp_path)
    assert len(cubes) == 1
    assert [m["name"] for m in cubes[0]["measures"]] == ["c"]
    assert cubes[0]["dimensions"] == []


def test_normalise_cube_null_member_lists():
    """YAML `dimensions:` (null) must become [] so mdl.json never carries null."""
    from wren.context import _normalise_cube_member_lists

    cube = {
        "name": "order_metrics",
        "base_object": "orders",
        "measures": None,
        "dimensions": None,
        "time_dimensions": [{"name": "d", "expression": "x"}],
    }
    out = _normalise_cube_member_lists(cube)
    assert out["measures"] == []
    assert out["dimensions"] == []
    assert out["time_dimensions"] == [{"name": "d", "expression": "x"}]


def test_load_cubes_normalises_empty_member_keys(tmp_path):
    """v2 empty YAML keys must reach [] via load_cubes (not only the helper)."""
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "om",
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: total\n"
        "    expression: SUM(o_totalprice)\n"
        "    type: double\n"
        "dimensions:\n"
        "time_dimensions:\n",
    )
    cubes = load_cubes(tmp_path)
    assert len(cubes) == 1
    assert cubes[0]["dimensions"] == []
    assert cubes[0]["time_dimensions"] == []
    assert [m["name"] for m in cubes[0]["measures"]] == ["total"]


def test_validate_project_reports_member_without_name(tmp_path):
    """Nameless measures must fail validate (not only cube list after build)."""
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "om",
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - expression: SUM(o_totalprice)\n"
        "    type: double\n",
    )
    errors = validate_project(tmp_path)
    msgs = [e.message for e in errors]
    assert any("must have a string 'name'" in m for m in msgs)


def test_validate_project_reports_malformed_cube_members(tmp_path):
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "om",
        "name: order_metrics\nbase_object: orders\nmeasures: nope\n",
    )
    errors = validate_project(tmp_path)
    msgs = [e.message for e in errors]
    assert any("'measures' must be a list, got str" in m for m in msgs)


def test_validate_project_reports_non_mapping_cube_metadata(tmp_path):
    _make_v2_cube_project(tmp_path)
    cube_dir = tmp_path / "cubes" / "bad"
    cube_dir.mkdir(parents=True)
    (cube_dir / "metadata.yml").write_text("- just a list\n")
    errors = validate_project(tmp_path)
    msgs = [e.message for e in errors]
    assert any("cube metadata must be a mapping, got list" in m for m in msgs)


def test_validate_project_reports_v1_non_mapping_cube_file(tmp_path):
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 1\nname: test\ndata_source: postgres\n"
    )
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "bad.yml").write_text("- not-a-mapping\n")
    errors = validate_project(tmp_path)
    msgs = [e.message for e in errors]
    assert any("cube file must be a mapping" in m for m in msgs)
    assert load_cubes(tmp_path) == []


def test_validate_project_reports_invalid_cube_yaml(tmp_path):
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 1\nname: test\ndata_source: postgres\n"
    )
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "broken.yml").write_text("name: [unterminated\n")
    errors = validate_project(tmp_path)
    assert any("invalid YAML" in e.message for e in errors)
    assert load_cubes(tmp_path) == []


def test_validate_project_reports_invalid_v2_cube_yaml(tmp_path):
    """Directory layout metadata.yml parse errors must report invalid YAML too."""
    _make_v2_cube_project(tmp_path)
    _write_cube(tmp_path, "om", "name: [unterminated\n")
    errors = validate_project(tmp_path)
    assert any("invalid YAML" in e.message for e in errors)
    assert load_cubes(tmp_path) == []


def test_validate_cube_ok(tmp_path):
    _make_v2_cube_project(tmp_path)
    _write_cube(
        tmp_path,
        "om",
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n"
        "dimensions: [{name: status, expression: o_orderstatus, type: VARCHAR}]\n",
    )
    errors = validate_project(tmp_path)
    # No cube-specific errors.
    assert not any("cube" in e.message.lower() for e in errors)


# ── Upgrade ──────────────────────────────────────────────────────────────────


def _make_v1_project(tmp_path: Path) -> Path:
    """Create a minimal v1 project with flat model files and views.yml."""
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 1\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
    )
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    (models_dir / "orders.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
        "primary_key: id\n"
    )
    (models_dir / "revenue.yml").write_text(
        "name: revenue\n"
        "ref_sql: SELECT SUM(amount) FROM orders\n"
        "columns:\n  - name: total\n    type: DECIMAL\n"
    )
    (tmp_path / "views.yml").write_text(
        "views:\n"
        "  - name: summary\n"
        "    statement: SELECT 1\n"
        "  - name: monthly\n"
        '    statement: "SELECT\\n  date_trunc(month, d)\\n  FROM t"\n'
    )
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "order_metrics.yml").write_text(
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: revenue\n    expression: SUM(amount)\n    type: DOUBLE\n"
    )
    (tmp_path / "relationships.yml").write_text("relationships: []\n")
    (tmp_path / "instructions.md").write_text("## Rule 1\nAlways use UTC.\n")
    return tmp_path


def _set_v1_entity_name(project_path: Path, entity: str, name: str) -> None:
    replacements = {
        "model": ("models/orders.yml", "name: orders\n", f"name: {name}\n"),
        "view": ("views.yml", "  - name: summary\n", f"  - name: {name}\n"),
        "cube": (
            "cubes/order_metrics.yml",
            "name: order_metrics\n",
            f"name: {name}\n",
        ),
    }
    relative_path, original, replacement = replacements[entity]
    source_path = project_path / relative_path
    content = source_path.read_text(encoding="utf-8")
    source_path.write_text(
        content.replace(original, replacement, 1),
        encoding="utf-8",
    )


def _set_v1_view_statement(project_path: Path, statement: int) -> None:
    views_file = project_path / "views.yml"
    content = views_file.read_text(encoding="utf-8")
    views_file.write_text(
        content.replace(
            "    statement: SELECT 1\n",
            f"    statement: {statement}\n",
            1,
        ),
        encoding="utf-8",
    )


def _set_v1_model_ref_sql(project_path: Path, ref_sql: int) -> None:
    model_file = project_path / "models" / "revenue.yml"
    content = model_file.read_text(encoding="utf-8")
    model_file.write_text(
        content.replace(
            "ref_sql: SELECT SUM(amount) FROM orders\n",
            f"ref_sql: {ref_sql}\n",
            1,
        ),
        encoding="utf-8",
    )


_V1_UPGRADE_FILE_TARGETS = [
    "models/orders/metadata.yml",
    "models/revenue/ref_sql.sql",
    "views/summary/metadata.yml",
    "views/monthly/sql.yml",
    "cubes/order_metrics/metadata.yml",
]


def _snapshot_v1_sources(project_path: Path) -> dict[str, str]:
    relative_paths = [
        "models/orders.yml",
        "models/revenue.yml",
        "views.yml",
        "cubes/order_metrics.yml",
    ]
    return {
        relative_path: (project_path / relative_path).read_text(encoding="utf-8")
        for relative_path in relative_paths
    }


def _assert_v1_sources_unchanged(
    project_path: Path, source_contents: dict[str, str]
) -> None:
    for relative_path, expected_content in source_contents.items():
        assert (project_path / relative_path).read_text(
            encoding="utf-8"
        ) == expected_content
    assert get_schema_version(project_path) == 1


def test_plan_upgrade_v1_to_v2(tmp_path):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=2)
    assert result.from_version == 1
    assert result.to_version == 2
    assert any("models/orders/metadata.yml" in f for f in result.files_created)
    assert any("models/revenue/ref_sql.sql" in f for f in result.files_created)
    assert any("cubes/order_metrics/metadata.yml" in f for f in result.files_created)
    assert any("models/orders.yml" in f for f in result.files_deleted)
    assert any("cubes/order_metrics.yml" in f for f in result.files_deleted)
    assert any("views.yml" in f for f in result.files_deleted)


@pytest.mark.parametrize("entity", ["model", "view", "cube"])
def test_plan_upgrade_v1_to_v2_rejects_traversal_names(tmp_path, entity):
    _make_v1_project(tmp_path)
    outside_dir = tmp_path.parent / f"{tmp_path.name}-{entity}-outside"
    _set_v1_entity_name(tmp_path, entity, f"../../{outside_dir.name}")

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="single portable path component"):
        plan_upgrade(tmp_path, target_version=2)

    assert not outside_dir.exists()
    assert get_schema_version(tmp_path) == 1


@pytest.mark.parametrize("entity", ["model", "view", "cube"])
@pytest.mark.parametrize("name", ["sub/child", r"sub\child", ".", ".."])
def test_plan_upgrade_v1_to_v2_requires_portable_path_component(tmp_path, entity, name):
    _make_v1_project(tmp_path)
    _set_v1_entity_name(tmp_path, entity, name)
    source_contents = _snapshot_v1_sources(tmp_path)

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="single portable path component"):
        plan_upgrade(tmp_path, target_version=2)

    _assert_v1_sources_unchanged(tmp_path, source_contents)


@pytest.mark.parametrize("statement", [42, 0])
def test_plan_upgrade_v1_to_v2_rejects_non_string_view_statement(tmp_path, statement):
    _make_v1_project(tmp_path)
    _set_v1_view_statement(tmp_path, statement)
    source_contents = _snapshot_v1_sources(tmp_path)

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="view 'summary' statement must be a string"):
        plan_upgrade(tmp_path, target_version=2)

    _assert_v1_sources_unchanged(tmp_path, source_contents)


@pytest.mark.parametrize("ref_sql", [42, 0])
def test_plan_upgrade_v1_to_v2_rejects_non_string_model_ref_sql(tmp_path, ref_sql):
    _make_v1_project(tmp_path)
    _set_v1_model_ref_sql(tmp_path, ref_sql)
    source_contents = _snapshot_v1_sources(tmp_path)

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="model 'revenue' ref_sql must be a string"):
        plan_upgrade(tmp_path, target_version=2)

    _assert_v1_sources_unchanged(tmp_path, source_contents)


@pytest.mark.parametrize("relative_target", _V1_UPGRADE_FILE_TARGETS)
def test_plan_upgrade_v1_to_v2_rejects_symlink_file_targets(tmp_path, relative_target):
    _make_v1_project(tmp_path)
    source_contents = _snapshot_v1_sources(tmp_path)
    victim = tmp_path.parent / f"{tmp_path.name}-victim"
    victim.write_text("unchanged\n", encoding="utf-8")
    target = tmp_path / relative_target
    target.parent.mkdir(parents=True, exist_ok=True)
    target.symlink_to(victim)

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="symbolic link"):
        plan_upgrade(tmp_path, target_version=2)

    assert victim.read_text(encoding="utf-8") == "unchanged\n"
    _assert_v1_sources_unchanged(tmp_path, source_contents)


def test_plan_upgrade_v1_to_v3(tmp_path):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=3)
    assert result.from_version == 1
    assert result.to_version == 3
    assert len(result.files_created) > 0


def test_plan_upgrade_v1_to_v2_rejects_duplicate_cube_targets(tmp_path):
    _make_v1_project(tmp_path)
    (tmp_path / "cubes" / "other_metrics.yml").write_text(
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: count\n    expression: COUNT(*)\n    type: BIGINT\n"
    )

    # Use fresh import to avoid stale class reference after importlib.reload in earlier tests.
    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="multiple legacy cube files"):
        plan_upgrade(tmp_path, target_version=2)


def test_plan_upgrade_v1_to_v2_rejects_duplicate_view_names(tmp_path):
    _make_v1_project(tmp_path)
    source_contents = _snapshot_v1_sources(tmp_path)
    (tmp_path / "views.yml").write_text(
        "views:\n"
        "  - name: summary\n"
        "    statement: SELECT 1\n"
        "  - name: summary\n"
        "    statement: SELECT 2\n"
    )
    duplicate_views_contents = (tmp_path / "views.yml").read_text(encoding="utf-8")

    # Use fresh import to avoid stale class reference after importlib.reload in earlier tests.
    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="multiple legacy views"):
        plan_upgrade(tmp_path, target_version=2)

    assert get_schema_version(tmp_path) == 1
    assert (tmp_path / "views.yml").exists()
    assert (tmp_path / "views.yml").read_text(
        encoding="utf-8"
    ) == duplicate_views_contents
    assert not (tmp_path / "views").exists()
    for relative_path in (
        "models/orders.yml",
        "models/revenue.yml",
        "cubes/order_metrics.yml",
    ):
        assert (tmp_path / relative_path).read_text(
            encoding="utf-8"
        ) == source_contents[relative_path]


def test_plan_upgrade_v1_to_v2_rejects_case_insensitive_duplicate_view_names(
    tmp_path,
):
    _make_v1_project(tmp_path)
    source_contents = _snapshot_v1_sources(tmp_path)
    (tmp_path / "views.yml").write_text(
        "views:\n"
        "  - name: Revenue\n"
        "    statement: SELECT 1\n"
        "  - name: revenue\n"
        "    statement: SELECT 2\n"
    )
    duplicate_views_contents = (tmp_path / "views.yml").read_text(encoding="utf-8")

    # Use fresh import to avoid stale class reference after importlib.reload in earlier tests.
    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="multiple legacy views"):
        plan_upgrade(tmp_path, target_version=2)

    assert get_schema_version(tmp_path) == 1
    assert (tmp_path / "views.yml").exists()
    assert (tmp_path / "views.yml").read_text(
        encoding="utf-8"
    ) == duplicate_views_contents
    assert not (tmp_path / "views").exists()
    for relative_path in (
        "models/orders.yml",
        "models/revenue.yml",
        "cubes/order_metrics.yml",
    ):
        assert (tmp_path / relative_path).read_text(
            encoding="utf-8"
        ) == source_contents[relative_path]


def test_plan_upgrade_v1_to_v2_rejects_duplicate_model_targets(tmp_path):
    _make_v1_project(tmp_path)
    source_contents = _snapshot_v1_sources(tmp_path)
    (tmp_path / "models" / "orders_copy.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders_copy\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
    )
    duplicate_model_contents = (tmp_path / "models" / "orders_copy.yml").read_text(
        encoding="utf-8"
    )

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="multiple legacy models"):
        plan_upgrade(tmp_path, target_version=2)

    assert get_schema_version(tmp_path) == 1
    assert not (tmp_path / "models" / "orders").exists()
    assert (tmp_path / "models" / "orders_copy.yml").read_text(
        encoding="utf-8"
    ) == duplicate_model_contents
    for relative_path in (
        "models/orders.yml",
        "models/revenue.yml",
        "views.yml",
        "cubes/order_metrics.yml",
    ):
        assert (tmp_path / relative_path).read_text(
            encoding="utf-8"
        ) == source_contents[relative_path]


def test_plan_upgrade_v1_to_v2_rejects_case_insensitive_duplicate_model_targets(
    tmp_path,
):
    _make_v1_project(tmp_path)
    source_contents = _snapshot_v1_sources(tmp_path)
    (tmp_path / "models" / "orders_upper.yml").write_text(
        "name: Orders\n"
        "table_reference:\n  table: orders_upper\n"
        "columns:\n  - name: id\n    type: INTEGER\n"
    )
    duplicate_model_contents = (tmp_path / "models" / "orders_upper.yml").read_text(
        encoding="utf-8"
    )

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="multiple legacy models"):
        plan_upgrade(tmp_path, target_version=2)

    assert get_schema_version(tmp_path) == 1
    assert not (tmp_path / "models" / "orders").exists()
    assert not (tmp_path / "models" / "Orders").exists()
    assert (tmp_path / "models" / "orders_upper.yml").read_text(
        encoding="utf-8"
    ) == duplicate_model_contents
    for relative_path in (
        "models/orders.yml",
        "models/revenue.yml",
        "views.yml",
        "cubes/order_metrics.yml",
    ):
        assert (tmp_path / relative_path).read_text(
            encoding="utf-8"
        ) == source_contents[relative_path]


def test_plan_upgrade_v2_to_v3(tmp_path):
    _make_v2_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=3)
    assert result.from_version == 2
    assert result.to_version == 3
    assert result.files_created == []
    assert result.files_deleted == []
    assert _PROJECT_FILE in result.files_modified


def test_plan_upgrade_already_at_target(tmp_path):
    _make_v3_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=3)
    assert result.from_version == 3
    assert result.to_version == 3
    assert result.files_created == []
    assert result.files_deleted == []
    assert result.files_modified == []


def test_plan_upgrade_above_target(tmp_path):
    _make_v3_project(tmp_path)
    # Use fresh import to avoid stale class reference after importlib.reload in earlier tests
    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="Cannot downgrade"):
        plan_upgrade(tmp_path, target_version=1)


def test_plan_upgrade_default_to_latest(tmp_path):
    from wren.context import _LATEST_SCHEMA_VERSION  # noqa: PLC0415

    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path)
    assert result.to_version == _LATEST_SCHEMA_VERSION == 5


def test_apply_upgrade_v1_to_v2(tmp_path):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=2)
    apply_upgrade(tmp_path, result)

    # New structure exists
    assert (tmp_path / "models" / "orders" / "metadata.yml").exists()
    assert (tmp_path / "models" / "revenue" / "metadata.yml").exists()
    assert (tmp_path / "models" / "revenue" / "ref_sql.sql").exists()
    assert (tmp_path / "views" / "summary" / "metadata.yml").exists()
    assert (tmp_path / "cubes" / "order_metrics" / "metadata.yml").exists()

    # Old files deleted
    assert not (tmp_path / "models" / "orders.yml").exists()
    assert not (tmp_path / "models" / "revenue.yml").exists()
    assert not (tmp_path / "cubes" / "order_metrics.yml").exists()
    assert not (tmp_path / "views.yml").exists()

    # schema_version updated
    assert get_schema_version(tmp_path) == 2

    # Content preserved
    models = load_models(tmp_path)
    assert len(models) == 2
    names = {m["name"] for m in models}
    assert names == {"orders", "revenue"}
    revenue = next(m for m in models if m["name"] == "revenue")
    assert "SELECT SUM(amount)" in revenue["ref_sql"]
    cubes = load_cubes(tmp_path)
    assert len(cubes) == 1
    assert cubes[0]["name"] == "order_metrics"


# ── Regression: v1 views.yml with non-mapping entries (issue #2597) ────────
#
# A hand-edited legacy views.yml can contain a non-mapping list entry (e.g.
# `- null`). _load_views_v1 must drop it, matching the other v1/v2 loaders,
# so every consumer below still works instead of crashing with a bare
# AttributeError — and validate_project must additionally report it rather
# than silently ignore it.


def _corrupt_v1_views_yml(tmp_path: Path) -> None:
    """Overwrite views.yml with a non-mapping entry alongside a valid one."""
    (tmp_path / "views.yml").write_text(
        'views:\n  - null\n  - "junk"\n  - name: summary\n    statement: SELECT 1\n'
    )


def test_validate_project_reports_v1_views_yml_non_mapping_entries(tmp_path):
    _make_v1_project(tmp_path)
    _corrupt_v1_views_yml(tmp_path)
    errors = validate_project(tmp_path)
    hard = [e for e in errors if e.level == "error"]
    # Both malformed entries are reported, each at its own index.
    entry_errors = [e for e in hard if "must be a mapping" in e.message]
    assert {e.path for e in entry_errors} == {
        "views.yml > views[0]",
        "views.yml > views[1]",
    }
    assert any("NoneType" in e.message for e in entry_errors)
    assert any("str" in e.message for e in entry_errors)
    # The well-formed sibling entry is unaffected.
    assert not any("summary" in e.message for e in errors)


def test_validate_project_accepts_empty_v1_views_key(tmp_path):
    """A bare ``views:`` means "no views" and must not be reported."""
    _make_v1_project(tmp_path)
    (tmp_path / "views.yml").write_text("views:\n")
    assert build_manifest(tmp_path)["views"] == []
    assert not [e for e in validate_project(tmp_path) if "views" in e.path]


@pytest.mark.parametrize(
    ("views_yml", "expected_type"),
    [
        ("views: junk\n", "str"),
        ("views: 3\n", "int"),
        ("views:\n  a: 1\n", "dict"),
    ],
)
def test_validate_project_reports_non_list_v1_views_container(
    tmp_path, views_yml, expected_type
):
    """A non-list under ``views:`` is malformed — report it once, don't crash."""
    _make_v1_project(tmp_path)
    (tmp_path / "views.yml").write_text(views_yml)

    hard = [e for e in validate_project(tmp_path) if e.level == "error"]
    container = [e for e in hard if e.path == "views.yml > views"]
    assert len(container) == 1
    assert f"must be a list, got {expected_type}" in container[0].message
    # Not additionally reported once per character/key of the container.
    assert not [e for e in hard if "must be a mapping" in e.message]

    # Every consumer degrades to "no views" rather than raising.
    assert build_manifest(tmp_path)["views"] == []
    assert build_json(tmp_path)["views"] == []
    plan = plan_upgrade(tmp_path, target_version=2)
    assert not [f for f in plan.files_created if f.startswith("views/")]
    apply_upgrade(tmp_path, plan)
    assert not (tmp_path / "views").exists()


# ── Regression: model columns non-list / non-dict entries ─────────────────


def test_load_models_v2_normalises_non_list_columns(tmp_path):
    """columns: scalar is dropped to [] by the loader."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\ntable_reference:\n  table: orders\ncolumns: id, customer_id\n"
    )
    models = load_models(tmp_path)
    assert len(models) == 1
    assert models[0]["columns"] == []


def test_load_models_v2_omits_missing_columns_key(tmp_path):
    """Absent columns key stays absent (no empty list injection)."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: orders\ntable_reference:\n  table: orders\n")
    models = load_models(tmp_path)
    assert len(models) == 1
    assert "columns" not in models[0]


def test_load_models_v2_drops_non_dict_column_entries(tmp_path):
    """Bare string / junk column entries are not coerced to column names."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "customers"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: customers\n"
        "table_reference:\n  table: customers\n"
        "columns:\n"
        "  - name: id\n    type: INTEGER\n"
        "  - bare\n"
        "  - 3\n"
    )
    models = load_models(tmp_path)
    assert len(models) == 1
    assert models[0]["columns"] == [{"name": "id", "type": "INTEGER"}]


def test_validate_project_reports_non_list_model_columns(tmp_path):
    """validate_project reports hand-edited non-list columns (loader already empty)."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\ntable_reference:\n  table: orders\ncolumns: id, customer_id\n"
    )
    errors = validate_project(tmp_path)
    msgs = [f"{e.path}: {e.message}" for e in errors]
    assert any("must be a list, got str" in m for m in msgs), msgs
    assert any("models/orders/metadata.yml > orders > columns" in m for m in msgs), msgs


def test_validate_project_reports_null_model_columns(tmp_path):
    """Explicit `columns:` (YAML null) is present and non-list — report it."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\ntable_reference:\n  table: orders\ncolumns:\n"
    )
    errors = validate_project(tmp_path)
    msgs = [f"{e.path}: {e.message}" for e in errors]
    assert any("columns" in m and "must be a list, got NoneType" in m for m in msgs), (
        msgs
    )


def test_validate_project_reports_non_dict_column_entries(tmp_path):
    """Bare-string column entries must error, not vanish silently."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n"
        "  - name: id\n    type: INTEGER\n"
        "  - bare_column\n"
    )
    errors = validate_project(tmp_path)
    msgs = [f"{e.path}: {e.message}" for e in errors]
    assert any(
        "columns[1]" in m and "column entry must be an object" in m for m in msgs
    ), msgs


def test_validate_project_duplicate_model_names_do_not_crosswire_columns(tmp_path):
    """Duplicate model names must not share/steal each other's raw column lists."""
    _make_v2_project(tmp_path)
    for dirname, columns_yaml, clean in (
        (
            "a",
            "  - bare_junk\n  - type: INTEGER\n  - name: ok\n    type: INT\n",
            False,
        ),
        (
            "b",
            "  - name: only\n    type: INT\n",
            True,
        ),
    ):
        d = tmp_path / "models" / dirname
        d.mkdir(parents=True)
        (d / "metadata.yml").write_text(
            f"name: orders\ntable_reference:\n  table: orders\ncolumns:\n{columns_yaml}"
        )
    errors = validate_project(tmp_path)
    diagnostics = [f"{e.path}: {e.message}" for e in errors]
    assert any("duplicate model name" in d for d in diagnostics), diagnostics
    # Real errors on a/ must remain.
    assert any(
        "models/a/metadata.yml" in d
        and "columns[0]" in d
        and "column entry must be an object" in d
        for d in diagnostics
    ), diagnostics
    assert any(
        "models/a/metadata.yml" in d
        and "columns[1]" in d
        and "column missing 'name'" in d
        for d in diagnostics
    ), diagnostics
    # No phantom column errors against clean b/.
    b_col_errs = [
        d
        for d in diagnostics
        if "models/b/metadata.yml" in d
        and ("column entry must be an object" in d or "column missing 'name'" in d)
    ]
    assert b_col_errs == [], b_col_errs


def test_plan_upgrade_v1_to_v2_rejects_malformed_model_columns(tmp_path):
    """v1→v2 must abort before discarding non-list / non-object columns."""
    _make_v1_project(tmp_path)
    models_dir = tmp_path / "models"
    (models_dir / "orders.yml").write_text(
        "name: orders\ntable_reference:\n  table: orders\ncolumns: id, customer_id\n",
        encoding="utf-8",
    )
    (models_dir / "items.yml").write_text(
        "name: items\n"
        "table_reference:\n  table: items\n"
        "columns:\n"
        "  - name: id\n    type: INTEGER\n"
        "  - bare_column\n",
        encoding="utf-8",
    )
    source_contents = _snapshot_v1_sources(tmp_path)

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="malformed model columns"):
        plan_upgrade(tmp_path, target_version=2)

    _assert_v1_sources_unchanged(tmp_path, source_contents)
    # Source content still intact (not normalised away).
    assert "id, customer_id" in (models_dir / "orders.yml").read_text(encoding="utf-8")
    assert "bare_column" in (models_dir / "items.yml").read_text(encoding="utf-8")


def test_validate_project_column_indices_match_file(tmp_path):
    """Junk at [0] must not renumber a later unnamed column's error."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  table: orders\n"
        "columns:\n"
        "  - bare_junk\n"
        "  - type: INTEGER\n"
        "  - name: amt\n    type: DOUBLE\n"
    )
    errors = validate_project(tmp_path)
    diagnostics = [f"{e.path}: {e.message}" for e in errors]
    assert any(
        "columns[0]" in d and "column entry must be an object" in d for d in diagnostics
    ), diagnostics
    assert any(
        "columns[1]" in d and "column missing 'name'" in d for d in diagnostics
    ), diagnostics
    # Must not report missing-name against the renumbered filtered index 0.
    missing_name_paths = [d for d in diagnostics if "column missing 'name'" in d]
    assert all("columns[0]" not in d for d in missing_name_paths), missing_name_paths


def test_validate_project_v1_model_paths_use_flat_yml(tmp_path):
    """v1 errors should label models/<stem>.yml, not models/<stem>/metadata.yml."""
    (tmp_path / "wren_project.yml").write_text("schema_version: 1\n", encoding="utf-8")
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    (models_dir / "orders.yml").write_text(
        "name: orders\ncolumns: id, customer_id\n",
        encoding="utf-8",
    )
    errors = validate_project(tmp_path)
    diagnostics = [f"{e.path} {e.message}" for e in errors]
    assert any(
        "models/orders.yml > orders > columns" in d and "must be a list" in d
        for d in diagnostics
    ), diagnostics
    assert not any("models/orders/metadata.yml" in d for d in diagnostics), diagnostics


def test_validate_project_uses_dir_name_when_model_name_missing(tmp_path):
    """v2 error path should use models/<dir>, not stem 'metadata'."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "table_reference:\n  table: orders\ncolumns: not-a-list\n"
    )
    errors = validate_project(tmp_path)
    msgs = [f"{e.path}: {e.message}" for e in errors]
    assert any(
        "models/orders/metadata.yml > orders > columns" in m and "must be a list" in m
        for m in msgs
    ), msgs


def test_build_manifest_drops_v1_views_yml_non_mapping_entries(tmp_path):
    _make_v1_project(tmp_path)
    _corrupt_v1_views_yml(tmp_path)
    manifest = build_manifest(tmp_path)
    assert [v["name"] for v in manifest["views"]] == ["summary"]


def test_build_json_does_not_crash_on_v1_views_yml_non_mapping_entries(tmp_path):
    _make_v1_project(tmp_path)
    _corrupt_v1_views_yml(tmp_path)
    manifest = build_json(tmp_path)
    assert [v["name"] for v in manifest["views"]] == ["summary"]


def test_plan_upgrade_v1_to_v2_does_not_crash_on_non_mapping_view(tmp_path):
    _make_v1_project(tmp_path)
    _corrupt_v1_views_yml(tmp_path)
    result = plan_upgrade(tmp_path, target_version=2)
    view_files = [f for f in result.files_created if f.startswith("views/")]
    assert view_files == ["views/summary/metadata.yml"]


def test_apply_upgrade_v1_to_v2_does_not_crash_on_non_mapping_view(tmp_path):
    _make_v1_project(tmp_path)
    _corrupt_v1_views_yml(tmp_path)
    result = plan_upgrade(tmp_path, target_version=2)
    apply_upgrade(tmp_path, result)
    assert (tmp_path / "views" / "summary" / "metadata.yml").exists()
    assert not (tmp_path / "views.yml").exists()
    # Only the well-formed view became a directory — no junk siblings.
    assert [d.name for d in (tmp_path / "views").iterdir()] == ["summary"]


@pytest.mark.parametrize("entity", ["model", "view", "cube"])
def test_apply_upgrade_v1_to_v2_rejects_traversal_names_before_writing(
    tmp_path, entity
):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=2)
    outside_dir = tmp_path.parent / f"{tmp_path.name}-{entity}-outside"
    _set_v1_entity_name(tmp_path, entity, f"../../{outside_dir.name}")
    source_contents = _snapshot_v1_sources(tmp_path)

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="single portable path component"):
        apply_upgrade(tmp_path, result)

    assert not outside_dir.exists()
    _assert_v1_sources_unchanged(tmp_path, source_contents)


@pytest.mark.parametrize("statement", [42, 0])
def test_apply_upgrade_v1_to_v2_rejects_non_string_view_statement_before_writing(
    tmp_path, statement
):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=2)
    _set_v1_view_statement(tmp_path, statement)
    source_contents = _snapshot_v1_sources(tmp_path)

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="view 'summary' statement must be a string"):
        apply_upgrade(tmp_path, result)

    _assert_v1_sources_unchanged(tmp_path, source_contents)


@pytest.mark.parametrize("ref_sql", [42, 0])
def test_apply_upgrade_v1_to_v2_rejects_non_string_model_ref_sql_before_writing(
    tmp_path, ref_sql
):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=2)
    _set_v1_model_ref_sql(tmp_path, ref_sql)
    source_contents = _snapshot_v1_sources(tmp_path)

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="model 'revenue' ref_sql must be a string"):
        apply_upgrade(tmp_path, result)

    _assert_v1_sources_unchanged(tmp_path, source_contents)


@pytest.mark.parametrize("relative_target", _V1_UPGRADE_FILE_TARGETS)
def test_apply_upgrade_v1_to_v2_rejects_late_symlink_file_targets(
    tmp_path, relative_target
):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=2)
    source_contents = _snapshot_v1_sources(tmp_path)
    victim = tmp_path.parent / f"{tmp_path.name}-victim"
    victim.write_text("unchanged\n", encoding="utf-8")
    target = tmp_path / relative_target
    target.parent.mkdir(parents=True, exist_ok=True)
    target.symlink_to(victim)

    from wren.context import UpgradeError as _UE  # noqa: PLC0415

    with pytest.raises(_UE, match="symbolic link"):
        apply_upgrade(tmp_path, result)

    assert victim.read_text(encoding="utf-8") == "unchanged\n"
    _assert_v1_sources_unchanged(tmp_path, source_contents)


def test_apply_upgrade_v2_to_v3(tmp_path):
    _make_v2_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=3)
    apply_upgrade(tmp_path, result)
    assert get_schema_version(tmp_path) == 3


def test_apply_upgrade_v1_to_v3(tmp_path):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=3)
    apply_upgrade(tmp_path, result)
    assert get_schema_version(tmp_path) == 3
    assert (tmp_path / "models" / "orders" / "metadata.yml").exists()
    assert not (tmp_path / "models" / "orders.yml").exists()
    assert (tmp_path / "cubes" / "order_metrics" / "metadata.yml").exists()
    assert not (tmp_path / "cubes" / "order_metrics.yml").exists()
    assert load_cubes(tmp_path)[0]["name"] == "order_metrics"


def test_upgrade_preserves_relationships(tmp_path):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=3)
    apply_upgrade(tmp_path, result)
    assert (tmp_path / "relationships.yml").exists()
    rels = load_relationships(tmp_path)
    assert rels == []


def test_upgrade_preserves_instructions(tmp_path):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=3)
    apply_upgrade(tmp_path, result)
    assert (tmp_path / "instructions.md").exists()
    content = load_instructions(tmp_path)
    assert "Rule 1" in content


# ── v4 → v5 (knowledge/ skeleton) ─────────────────────────────────────────

_KNOWLEDGE_SKELETON = [
    "knowledge/rules/.gitkeep",
    "knowledge/glossary/.gitkeep",
    "knowledge/metrics/.gitkeep",
    "knowledge/caveats/.gitkeep",
    "knowledge/sql/.gitkeep",
    "knowledge/knowledge.yml",
]


def test_plan_upgrade_v4_to_v5_lists_knowledge(tmp_path):
    _make_v2_project(tmp_path, schema_version=4)
    result = plan_upgrade(tmp_path, target_version=5)
    assert result.from_version == 4
    assert result.to_version == 5
    assert set(result.files_created) == set(_KNOWLEDGE_SKELETON)
    assert "wren_project.yml" in result.files_modified
    # plan must not touch disk
    assert not (tmp_path / "knowledge").exists()


def test_apply_upgrade_v4_to_v5_creates_knowledge(tmp_path):
    _make_v2_project(tmp_path, schema_version=4)
    apply_upgrade(tmp_path, plan_upgrade(tmp_path, target_version=5))
    assert get_schema_version(tmp_path) == 5
    for rel in _KNOWLEDGE_SKELETON:
        assert (tmp_path / rel).exists(), rel
    # knowledge axis has its own schema_version, decoupled from MDL
    import yaml as _yaml  # noqa: PLC0415

    kcfg = _yaml.safe_load((tmp_path / "knowledge" / "knowledge.yml").read_text())
    assert kcfg["schema_version"] == 1


def test_upgrade_v4_to_v5_idempotent(tmp_path):
    _make_v2_project(tmp_path, schema_version=4)
    apply_upgrade(tmp_path, plan_upgrade(tmp_path, target_version=5))
    # second pass: already at latest → no-op plan, knowledge untouched
    again = plan_upgrade(tmp_path, target_version=5)
    assert again.from_version == again.to_version == 5
    assert again.files_created == []


def test_upgrade_v4_to_v5_preserves_existing_knowledge(tmp_path):
    """An existing knowledge file is never overwritten by the upgrade."""
    _make_v2_project(tmp_path, schema_version=4)
    (tmp_path / "knowledge" / "rules").mkdir(parents=True)
    (tmp_path / "knowledge" / "rules" / "house.md").write_text("# keep me\n")
    apply_upgrade(tmp_path, plan_upgrade(tmp_path, target_version=5))
    assert (tmp_path / "knowledge" / "rules" / "house.md").read_text() == "# keep me\n"
    assert (tmp_path / "knowledge" / "knowledge.yml").exists()


def test_apply_upgrade_v2_to_v5_full_chain(tmp_path):
    """v2 → v5 restamps through and builds the knowledge skeleton; models still load."""
    _make_v2_project(tmp_path)
    d = tmp_path / "models" / "orders"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: orders\ntable_reference:\n  table: orders\n")
    apply_upgrade(tmp_path, plan_upgrade(tmp_path, target_version=5))
    assert get_schema_version(tmp_path) == 5
    assert (tmp_path / "knowledge" / "knowledge.yml").exists()
    assert load_models(tmp_path)[0]["name"] == "orders"


_PROJECT_FILE = "wren_project.yml"


# ── Semantic validation tests (view dry-plan + description checks) ─────────

import base64
import json as _json

import orjson
import pytest

from wren.context import validate_manifest
from wren.model.data_source import DataSource


def _b64(manifest: dict) -> str:
    return base64.b64encode(orjson.dumps(manifest)).decode()


_SEM_MODEL_WITH_DESC = {
    "name": "orders",
    "tableReference": {"schema": "main", "table": "orders"},
    "columns": [
        {"name": "o_orderkey", "type": "integer"},
        {"name": "o_custkey", "type": "integer"},
    ],
    "primaryKey": "o_orderkey",
    "properties": {"description": "Orders model"},
}

_SEM_MODEL_WITHOUT_DESC = {
    "name": "accounts",
    "tableReference": {"schema": "main", "table": "accounts"},
    "columns": [
        {"name": "acct_id", "type": "integer"},
        {"name": "plan_cd", "type": "varchar"},
    ],
    "primaryKey": "acct_id",
}

_VALID_VIEW = {
    "name": "valid_view",
    "statement": 'SELECT o_orderkey FROM "orders"',
    "properties": {"description": "A valid view"},
}

_VIEW_WITHOUT_DESC = {
    "name": "daily_usage",
    "statement": 'SELECT o_orderkey FROM "orders"',
}

_BROKEN_VIEW = {
    "name": "stale_report",
    "statement": 'SELECT * FROM "deleted_model"',
}

_EMPTY_STMT_VIEW = {
    "name": "empty_view",
    "statement": "",
}

_SEM_BASE_MANIFEST = {
    "catalog": "wren",
    "schema": "public",
    "models": [_SEM_MODEL_WITH_DESC],
}


@pytest.mark.unit
def test_validate_manifest_view_pass():
    manifest = {**_SEM_BASE_MANIFEST, "views": [_VALID_VIEW]}
    result = validate_manifest(_b64(manifest), DataSource.duckdb)
    assert result["errors"] == []


@pytest.mark.unit
def test_validate_manifest_view_dry_plan_error():
    manifest = {**_SEM_BASE_MANIFEST, "views": [_BROKEN_VIEW]}
    result = validate_manifest(_b64(manifest), DataSource.duckdb)
    assert len(result["errors"]) == 1
    assert "stale_report" in result["errors"][0]


@pytest.mark.unit
def test_validate_manifest_empty_statement():
    manifest = {**_SEM_BASE_MANIFEST, "views": [_EMPTY_STMT_VIEW]}
    result = validate_manifest(_b64(manifest), DataSource.duckdb)
    assert any("empty statement" in e for e in result["errors"])


@pytest.mark.unit
def test_validate_manifest_model_no_description():
    manifest = {
        "catalog": "wren",
        "schema": "public",
        "models": [_SEM_MODEL_WITHOUT_DESC],
    }
    result = validate_manifest(_b64(manifest), DataSource.duckdb)
    assert result["errors"] == []
    assert any("accounts" in w for w in result["warnings"])


@pytest.mark.unit
def test_validate_manifest_view_no_description():
    manifest = {**_SEM_BASE_MANIFEST, "views": [_VIEW_WITHOUT_DESC]}
    result = validate_manifest(_b64(manifest), DataSource.duckdb)
    assert result["errors"] == []
    assert any("daily_usage" in w for w in result["warnings"])


@pytest.mark.unit
def test_validate_manifest_level_error_suppresses_warnings():
    manifest = {
        "catalog": "wren",
        "schema": "public",
        "models": [_SEM_MODEL_WITHOUT_DESC],
    }
    result = validate_manifest(_b64(manifest), DataSource.duckdb, level="error")
    assert result["warnings"] == []


@pytest.mark.unit
def test_validate_manifest_strict_column_warnings():
    manifest = {
        "catalog": "wren",
        "schema": "public",
        "models": [_SEM_MODEL_WITHOUT_DESC],
    }
    result = validate_manifest(_b64(manifest), DataSource.duckdb, level="strict")
    text = " ".join(result["warnings"])
    assert "plan_cd" in text
    assert "acct_id" in text


@pytest.mark.unit
def test_validate_manifest_invalid_level():
    result = validate_manifest(
        _b64(_SEM_BASE_MANIFEST), DataSource.duckdb, level="nope"
    )
    assert any("nope" in e for e in result["errors"])


@pytest.mark.unit
def test_validate_manifest_invalid_datasource():
    manifest = {**_SEM_BASE_MANIFEST, "views": [_VALID_VIEW]}
    result = validate_manifest(_b64(manifest), "not-a-datasource")
    assert len(result["errors"]) == 1


def test_load_relationships_filters_non_dict_entries(tmp_path: Path) -> None:
    (tmp_path / "relationships.yml").write_text(
        "relationships:\n  - not-a-mapping\n  - 42\n  - name: ok\n    models: [a, b]\n    join_type: MANY_TO_ONE\n    condition: a.id = b.id\n",
        encoding="utf-8",
    )
    rels = load_relationships(tmp_path)
    assert len(rels) == 1
    assert rels[0]["name"] == "ok"


def test_validate_project_reports_non_dict_relationship_entries(tmp_path: Path) -> None:
    # Minimal project scaffold for validate_project
    (tmp_path / "wren_project.yml").write_text("schema_version: 1\n", encoding="utf-8")
    (tmp_path / "relationships.yml").write_text(
        "relationships:\n  - not-a-mapping\n  - 42\n",
        encoding="utf-8",
    )
    errors = validate_project(tmp_path)
    msgs = [e.message for e in errors]
    assert any("relationship entry must be a mapping, got str" in m for m in msgs)
    assert any("relationship entry must be a mapping, got int" in m for m in msgs)


def test_validate_project_reports_relationships_not_list(tmp_path: Path) -> None:
    (tmp_path / "wren_project.yml").write_text("schema_version: 1\n", encoding="utf-8")
    (tmp_path / "relationships.yml").write_text(
        "relationships: nope\n", encoding="utf-8"
    )
    errors = validate_project(tmp_path)
    msgs = [e.message for e in errors]
    assert any("'relationships' must be a list, got str" in m for m in msgs)


def test_validate_project_reports_relationships_bare_root(tmp_path: Path) -> None:
    (tmp_path / "wren_project.yml").write_text("schema_version: 1\n", encoding="utf-8")
    (tmp_path / "relationships.yml").write_text(
        "- name: ok\n  models: [a, b]\n  join_type: MANY_TO_ONE\n  condition: a.id = b.id\n",
        encoding="utf-8",
    )
    errors = validate_project(tmp_path)
    msgs = [e.message for e in errors]
    assert any(
        "relationships.yml must be a mapping with a 'relationships' key, got list" in m
        for m in msgs
    )


def _extract_fenced_yaml(markdown: str, heading: str) -> str:
    """Pull the first ```yaml fenced block under a markdown heading."""
    after_heading = markdown[markdown.index(heading) :]
    start = after_heading.index("```yaml") + len("```yaml")
    end = after_heading.index("```", start)
    return after_heading[start:end]


def test_generate_mdl_skill_step3_example_round_trips(tmp_path: Path) -> None:
    """The generate-mdl skill's own Step 2/Step 3 examples, fed to the real
    loader/validator, must produce a clean project. Regression for #2672: Step 3
    used to ship a bare top-level list, which load_relationships silently drops
    and validate_project rejects."""
    from wren.skills_delivery import get_skill  # noqa: PLC0415

    skill = get_skill("generate-mdl")
    models_yaml = _extract_fenced_yaml(skill, "### Step 2 — Write model files")
    relationships_yaml = _extract_fenced_yaml(skill, "### Step 3 — Write relationships")

    _make_v2_project(tmp_path)
    (tmp_path / "models" / "orders").mkdir(parents=True)
    (tmp_path / "models" / "orders" / "metadata.yml").write_text(
        models_yaml, encoding="utf-8"
    )
    (tmp_path / "models" / "customers").mkdir(parents=True)
    (tmp_path / "models" / "customers" / "metadata.yml").write_text(
        "name: customers\n"
        "table_reference:\n  table: customers\n"
        "primary_key: customer_id\n"
        "columns:\n  - name: customer_id\n    type: INTEGER\n",
        encoding="utf-8",
    )
    (tmp_path / "relationships.yml").write_text(relationships_yaml, encoding="utf-8")

    rels = load_relationships(tmp_path)
    assert len(rels) == 1
    assert rels[0]["name"] == "orders_customers"

    assert validate_project(tmp_path) == []


def test_validate_project_relationship_indices_match_file(tmp_path: Path) -> None:
    """Junk at [0] must not renumber a later unnamed relationship's warnings."""
    (tmp_path / "wren_project.yml").write_text("schema_version: 1\n", encoding="utf-8")
    (tmp_path / "relationships.yml").write_text(
        "relationships:\n  - 42\n  - models: [a, b]\n    condition: a.id = b.id\n",
        encoding="utf-8",
    )
    errors = validate_project(tmp_path)
    diagnostics = [f"{getattr(e, 'path', '')} {e.message}" for e in errors]
    assert any("got int" in diagnostic for diagnostic in diagnostics)
    assert any(
        "relationships[1]" in diagnostic and "join_type" in diagnostic
        for diagnostic in diagnostics
    )
