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
        "name: summary\n"
        "statement: SELECT 1\n"
        "dialect: postgres\n"
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


def _make_v3_cube_project(tmp_path: Path) -> Path:
    """v3 project with an orders model, ready for cubes/*.yml files."""
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 3\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
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


def test_load_cubes_returns_empty_when_no_dir(tmp_path):
    assert load_cubes(tmp_path) == []


def test_load_cubes_parses_yaml(tmp_path):
    _make_v3_cube_project(tmp_path)
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "order_metrics.yml").write_text(
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: revenue\n    expression: SUM(o_totalprice)\n    type: DOUBLE\n"
        "dimensions:\n"
        "  - name: status\n    expression: o_orderstatus\n    type: VARCHAR\n"
    )
    cubes = load_cubes(tmp_path)
    assert len(cubes) == 1
    assert cubes[0]["name"] == "order_metrics"
    assert cubes[0]["base_object"] == "orders"
    assert cubes[0]["measures"][0]["name"] == "revenue"


def test_build_manifest_includes_cubes(tmp_path):
    _make_v3_cube_project(tmp_path)
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "order_metrics.yml").write_text(
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: revenue\n    expression: SUM(o_totalprice)\n    type: DOUBLE\n"
    )
    manifest = build_manifest(tmp_path)
    assert "cubes" in manifest
    assert manifest["cubes"][0]["name"] == "order_metrics"
    assert "_source_file" not in manifest["cubes"][0]


def test_build_json_cube_camel_case(tmp_path):
    _make_v3_cube_project(tmp_path)
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "order_metrics.yml").write_text(
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures:\n"
        "  - name: revenue\n    expression: SUM(o_totalprice)\n    type: DOUBLE\n"
        "time_dimensions:\n"
        "  - name: created_at\n    expression: o_orderdate\n    type: DATE\n"
    )
    result = build_json(tmp_path)
    cube = result["cubes"][0]
    assert cube["baseObject"] == "orders"
    assert cube["timeDimensions"][0]["name"] == "created_at"


def test_validate_cube_unknown_base_object(tmp_path):
    _make_v3_cube_project(tmp_path)
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "bad.yml").write_text(
        "name: bad\nbase_object: nosuch\nmeasures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n"
    )
    errors = validate_project(tmp_path)
    assert any("base_object 'nosuch'" in e.message for e in errors)


def test_validate_cube_duplicate_name(tmp_path):
    _make_v3_cube_project(tmp_path)
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    body = (
        "name: order_metrics\nbase_object: orders\n"
        "measures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n"
    )
    (cubes_dir / "a.yml").write_text(body)
    (cubes_dir / "b.yml").write_text(body)
    errors = validate_project(tmp_path)
    assert any("duplicate cube name" in e.message for e in errors)


def test_validate_cube_missing_base_object_uses_snake_case(tmp_path):
    """Validation error should reference the YAML field name (snake_case)."""
    _make_v3_cube_project(tmp_path)
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "om.yml").write_text(
        "name: order_metrics\n"
        "measures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n"
    )
    errors = validate_project(tmp_path)
    assert any("'base_object'" in e.message for e in errors)
    assert not any("baseObject" in e.message for e in errors)


def test_validate_cube_non_string_hierarchy_level(tmp_path):
    """Non-string hierarchy levels must be reported, not crash."""
    _make_v3_cube_project(tmp_path)
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "om.yml").write_text(
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n"
        "dimensions: [{name: status, expression: o_orderstatus, type: VARCHAR}]\n"
        "hierarchies:\n"
        "  drill:\n"
        "    - status\n"
        "    - [nested, list]\n"
    )
    errors = validate_project(tmp_path)
    assert any("hierarchy levels must be strings" in e.message for e in errors)


def test_validate_cube_bad_hierarchy(tmp_path):
    _make_v3_cube_project(tmp_path)
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "om.yml").write_text(
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n"
        "dimensions: [{name: status, expression: o_orderstatus, type: VARCHAR}]\n"
        "hierarchies:\n"
        "  drill: [status, nonexistent_dim]\n"
    )
    errors = validate_project(tmp_path)
    assert any("nonexistent_dim" in e.message for e in errors)


def test_validate_cube_ok(tmp_path):
    _make_v3_cube_project(tmp_path)
    cubes_dir = tmp_path / "cubes"
    cubes_dir.mkdir()
    (cubes_dir / "om.yml").write_text(
        "name: order_metrics\n"
        "base_object: orders\n"
        "measures: [{name: c, expression: 'COUNT(*)', type: BIGINT}]\n"
        "dimensions: [{name: status, expression: o_orderstatus, type: VARCHAR}]\n"
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
    (tmp_path / "relationships.yml").write_text("relationships: []\n")
    (tmp_path / "instructions.md").write_text("## Rule 1\nAlways use UTC.\n")
    return tmp_path


def test_plan_upgrade_v1_to_v2(tmp_path):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=2)
    assert result.from_version == 1
    assert result.to_version == 2
    assert any("models/orders/metadata.yml" in f for f in result.files_created)
    assert any("models/revenue/ref_sql.sql" in f for f in result.files_created)
    assert any("models/orders.yml" in f for f in result.files_deleted)
    assert any("views.yml" in f for f in result.files_deleted)


def test_plan_upgrade_v1_to_v3(tmp_path):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=3)
    assert result.from_version == 1
    assert result.to_version == 3
    assert len(result.files_created) > 0


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
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path)
    assert result.to_version == 3


def test_apply_upgrade_v1_to_v2(tmp_path):
    _make_v1_project(tmp_path)
    result = plan_upgrade(tmp_path, target_version=2)
    apply_upgrade(tmp_path, result)

    # New structure exists
    assert (tmp_path / "models" / "orders" / "metadata.yml").exists()
    assert (tmp_path / "models" / "revenue" / "metadata.yml").exists()
    assert (tmp_path / "models" / "revenue" / "ref_sql.sql").exists()
    assert (tmp_path / "views" / "summary" / "metadata.yml").exists()

    # Old files deleted
    assert not (tmp_path / "models" / "orders.yml").exists()
    assert not (tmp_path / "models" / "revenue.yml").exists()
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
    manifest = {"catalog": "wren", "schema": "public", "models": [_SEM_MODEL_WITHOUT_DESC]}
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
    manifest = {"catalog": "wren", "schema": "public", "models": [_SEM_MODEL_WITHOUT_DESC]}
    result = validate_manifest(_b64(manifest), DataSource.duckdb, level="error")
    assert result["warnings"] == []


@pytest.mark.unit
def test_validate_manifest_strict_column_warnings():
    manifest = {"catalog": "wren", "schema": "public", "models": [_SEM_MODEL_WITHOUT_DESC]}
    result = validate_manifest(_b64(manifest), DataSource.duckdb, level="strict")
    text = " ".join(result["warnings"])
    assert "plan_cd" in text
    assert "acct_id" in text


@pytest.mark.unit
def test_validate_manifest_invalid_level():
    result = validate_manifest(_b64(_SEM_BASE_MANIFEST), DataSource.duckdb, level="nope")
    assert any("nope" in e for e in result["errors"])


@pytest.mark.unit
def test_validate_manifest_invalid_datasource():
    manifest = {**_SEM_BASE_MANIFEST, "views": [_VALID_VIEW]}
    result = validate_manifest(_b64(manifest), "not-a-datasource")
    assert len(result["errors"]) == 1
