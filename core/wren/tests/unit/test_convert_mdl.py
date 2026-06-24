"""Tests for MDL JSON → YAML project conversion (wren context init --from-mdl)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from wren.context import (
    _AGENTS_MD_TEMPLATE,
    _CAMEL_TO_SNAKE_MAP,
    _camel_to_snake,
    _snake_to_camel,
    build_json,
    convert_mdl_to_project,
    write_project_files,
)

# ── Sample MDL fixture ────────────────────────────────────────────────────

SAMPLE_MDL = {
    "catalog": "wren",
    "schema": "public",
    "dataSource": "postgres",
    "models": [
        {
            "name": "orders",
            "tableReference": {"catalog": "", "schema": "public", "table": "orders"},
            "columns": [
                {
                    "name": "order_id",
                    "type": "INTEGER",
                    "isCalculated": False,
                    "notNull": True,
                    "isPrimaryKey": True,
                    "properties": {},
                },
                {
                    "name": "customer_id",
                    "type": "INTEGER",
                    "isCalculated": False,
                    "notNull": False,
                    "properties": {},
                },
            ],
            "primaryKey": "order_id",
            "cached": False,
            "properties": {},
        },
        {
            "name": "revenue_summary",
            "refSql": "SELECT SUM(total) FROM orders",
            "columns": [
                {
                    "name": "total",
                    "type": "DECIMAL",
                    "isCalculated": False,
                    "properties": {},
                },
            ],
            "cached": False,
            "properties": {},
        },
    ],
    "views": [
        {
            "name": "top_customers",
            "statement": "SELECT * FROM customers LIMIT 10",
            "description": "Top customers",
            "properties": {},
        },
        {
            "name": "monthly_revenue",
            "statement": (
                "SELECT DATE_TRUNC('month', order_date) AS month,\n"
                "       SUM(total) AS revenue\n"
                "FROM orders\n"
                "GROUP BY 1"
            ),
            "description": "Monthly revenue",
            "properties": {},
        },
    ],
    "relationships": [
        {
            "name": "orders_customers",
            "models": ["orders", "customers"],
            "joinType": "MANY_TO_ONE",
            "condition": "orders.customer_id = customers.customer_id",
        },
    ],
    "_instructions": "Always use UTC timestamps.\n\n## Naming\nUse snake_case.",
}


@pytest.fixture()
def sample_mdl_file(tmp_path: Path) -> Path:
    f = tmp_path / "mdl.json"
    f.write_text(json.dumps(SAMPLE_MDL))
    return f


# ── Unit tests: _camel_to_snake ────────────────────────────────────────────


@pytest.mark.parametrize(
    "camel, snake",
    [
        ("tableReference", "table_reference"),
        ("refSql", "ref_sql"),
        ("isCalculated", "is_calculated"),
        ("notNull", "not_null"),
        ("isPrimaryKey", "is_primary_key"),
        ("primaryKey", "primary_key"),
        ("joinType", "join_type"),
        ("dataSource", "data_source"),
        ("name", "name"),
        ("unknownCamelKey", "unknown_camel_key"),
    ],
)
def test_camel_to_snake(camel: str, snake: str):
    assert _camel_to_snake(camel) == snake


def test_round_trip_all_known_keys():
    """_snake_to_camel(_camel_to_snake(k)) == k for all known mappings."""
    for camel_key in _CAMEL_TO_SNAKE_MAP:
        snake_key = _camel_to_snake(camel_key)
        assert _snake_to_camel(snake_key) == camel_key, (
            f"Round-trip failed for {camel_key!r}: "
            f"camel→snake={snake_key!r}, snake→camel={_snake_to_camel(snake_key)!r}"
        )


# ── Integration test: convert_mdl_to_project ─────────────────────────────


def test_convert_mdl_to_project():
    files = convert_mdl_to_project(SAMPLE_MDL)
    file_map = {f.relative_path: f.content for f in files}

    # All expected files present
    assert "wren_project.yml" in file_map
    assert "models/orders/metadata.yml" in file_map
    assert "models/revenue_summary/metadata.yml" in file_map
    assert "models/revenue_summary/ref_sql.sql" in file_map
    assert "views/top_customers/metadata.yml" in file_map
    assert "views/monthly_revenue/metadata.yml" in file_map
    assert "views/monthly_revenue/sql.yml" in file_map
    assert "relationships.yml" in file_map
    assert "knowledge/rules/general.md" in file_map
    assert "AGENTS.md" in file_map
    assert file_map["AGENTS.md"] == _AGENTS_MD_TEMPLATE

    # wren_project.yml
    project = yaml.safe_load(file_map["wren_project.yml"])
    assert project["schema_version"] == 2
    assert project["catalog"] == "wren"
    assert project["schema"] == "public"
    assert project["data_source"] == "postgres"

    # Model with table_reference
    orders = yaml.safe_load(file_map["models/orders/metadata.yml"])
    assert "table_reference" in orders
    assert orders["primary_key"] == "order_id"
    assert orders["columns"][0]["is_primary_key"] is True
    assert orders["columns"][0]["not_null"] is True
    assert orders["columns"][0]["is_calculated"] is False
    # ref_sql must NOT appear in table_reference model
    assert "ref_sql" not in orders

    # Model with ref_sql (SQL in separate file, not in metadata)
    rev = yaml.safe_load(file_map["models/revenue_summary/metadata.yml"])
    assert "ref_sql" not in rev
    assert "SELECT SUM(total)" in file_map["models/revenue_summary/ref_sql.sql"]

    # View with inline statement (single-line)
    top = yaml.safe_load(file_map["views/top_customers/metadata.yml"])
    assert "statement" in top
    assert top["statement"] == "SELECT * FROM customers LIMIT 10"

    # View with separated statement (multi-line)
    monthly_meta = yaml.safe_load(file_map["views/monthly_revenue/metadata.yml"])
    assert "statement" not in monthly_meta
    monthly_sql = yaml.safe_load(file_map["views/monthly_revenue/sql.yml"])
    assert "statement" in monthly_sql

    # Relationships converted to snake_case
    rels = yaml.safe_load(file_map["relationships.yml"])
    assert rels["relationships"][0]["join_type"] == "MANY_TO_ONE"
    assert rels["relationships"][0]["name"] == "orders_customers"

    # Business rules → knowledge/rules/
    assert "Always use UTC" in file_map["knowledge/rules/general.md"]


# ── write_project_files ────────────────────────────────────────────────────


def test_write_project_files(tmp_path: Path):
    files = convert_mdl_to_project(SAMPLE_MDL)
    write_project_files(files, tmp_path)

    assert (tmp_path / "wren_project.yml").exists()
    assert (tmp_path / "models" / "orders" / "metadata.yml").exists()
    assert (tmp_path / "models" / "revenue_summary" / "ref_sql.sql").exists()
    assert (tmp_path / "views" / "monthly_revenue" / "sql.yml").exists()
    assert (tmp_path / "relationships.yml").exists()
    assert (tmp_path / "knowledge" / "rules" / "general.md").exists()
    assert (tmp_path / "AGENTS.md").exists()
    assert (tmp_path / "AGENTS.md").read_text() == _AGENTS_MD_TEMPLATE


def test_write_project_files_refuses_overwrite(tmp_path: Path):
    (tmp_path / "wren_project.yml").write_text("existing")
    files = convert_mdl_to_project(SAMPLE_MDL)
    with pytest.raises(SystemExit, match="already exists"):
        write_project_files(files, tmp_path, force=False)


def test_write_project_files_force_overwrites(tmp_path: Path):
    (tmp_path / "wren_project.yml").write_text("existing")
    files = convert_mdl_to_project(SAMPLE_MDL)
    write_project_files(files, tmp_path, force=True)
    project = yaml.safe_load((tmp_path / "wren_project.yml").read_text())
    assert project["schema_version"] == 2


# ── Round-trip: convert → build ────────────────────────────────────────────


def test_convert_then_build_roundtrip(tmp_path: Path):
    """Convert MDL JSON → YAML project → build back to JSON → compare."""
    files = convert_mdl_to_project(SAMPLE_MDL)
    write_project_files(files, tmp_path)

    rebuilt = build_json(tmp_path)

    assert rebuilt["catalog"] == SAMPLE_MDL["catalog"]
    assert rebuilt["schema"] == SAMPLE_MDL["schema"]
    assert len(rebuilt["models"]) == len(SAMPLE_MDL["models"])
    assert len(rebuilt["views"]) == len(SAMPLE_MDL["views"])
    assert len(rebuilt["relationships"]) == len(SAMPLE_MDL["relationships"])

    orders_rebuilt = next(m for m in rebuilt["models"] if m["name"] == "orders")
    assert orders_rebuilt["tableReference"]["table"] == "orders"
    assert orders_rebuilt["primaryKey"] == "order_id"

    rel = rebuilt["relationships"][0]
    assert rel["joinType"] == "MANY_TO_ONE"


# ── Edge cases ─────────────────────────────────────────────────────────────


def test_empty_mdl():
    """Empty models/views/relationships — only the project, AGENTS.md, and the knowledge marker."""
    mdl = {"catalog": "wren", "schema": "public"}
    files = convert_mdl_to_project(mdl)
    paths = {f.relative_path for f in files}
    assert paths == {"wren_project.yml", "AGENTS.md", "knowledge/knowledge.yml"}
    assert "instructions.md" not in paths


def test_no_data_source():
    """Missing dataSource — wren_project.yml omits data_source field."""
    mdl = {"catalog": "wren", "schema": "public", "models": [], "views": []}
    files = convert_mdl_to_project(mdl)
    project = yaml.safe_load(next(f for f in files if f.relative_path == "wren_project.yml").content)
    assert "data_source" not in project


def test_no_instructions():
    """No _instructions — no business-rules file is produced."""
    mdl = {"catalog": "wren", "schema": "public"}
    files = convert_mdl_to_project(mdl)
    assert not any(f.relative_path == "instructions.md" for f in files)
    assert not any(f.relative_path == "knowledge/rules/general.md" for f in files)


def test_unknown_camel_key_preserved():
    """Unknown camelCase keys are converted via generic fallback."""
    mdl = {
        "catalog": "wren",
        "schema": "public",
        "models": [
            {
                "name": "foo",
                "refSql": "SELECT 1",
                "columns": [],
                "unknownCamelKey": "value",
            }
        ],
    }
    files = convert_mdl_to_project(mdl)
    meta = yaml.safe_load(
        next(f for f in files if f.relative_path == "models/foo/metadata.yml").content
    )
    assert "unknown_camel_key" in meta
    assert meta["unknown_camel_key"] == "value"


def test_empty_relationships_not_written():
    """Empty relationships list — relationships.yml is not produced."""
    mdl = {"catalog": "wren", "schema": "public", "relationships": []}
    files = convert_mdl_to_project(mdl)
    assert not any(f.relative_path == "relationships.yml" for f in files)


# ── CLI tests ──────────────────────────────────────────────────────────────


def test_cli_init_from_mdl(tmp_path: Path, sample_mdl_file: Path):
    from typer.testing import CliRunner

    from wren.cli import app

    runner = CliRunner()
    project_dir = tmp_path / "project"
    result = runner.invoke(
        app,
        ["context", "init", "--path", str(project_dir), "--from-mdl", str(sample_mdl_file)],
    )
    assert result.exit_code == 0, result.output
    assert "Imported MDL" in result.output
    assert (project_dir / "wren_project.yml").exists()
    assert (project_dir / "models" / "orders" / "metadata.yml").exists()


def test_cli_init_from_mdl_file_not_found(tmp_path: Path):
    from typer.testing import CliRunner

    from wren.cli import app

    runner = CliRunner()
    result = runner.invoke(
        app,
        ["context", "init", "--path", str(tmp_path), "--from-mdl", "/nonexistent/mdl.json"],
    )
    assert result.exit_code != 0
    assert "not found" in result.output


def test_cli_init_from_mdl_no_force_existing(tmp_path: Path, sample_mdl_file: Path):
    """Refuse to overwrite without --force."""
    (tmp_path / "wren_project.yml").write_text("existing")
    from typer.testing import CliRunner

    from wren.cli import app

    runner = CliRunner()
    result = runner.invoke(
        app,
        ["context", "init", "--path", str(tmp_path), "--from-mdl", str(sample_mdl_file)],
    )
    assert result.exit_code != 0
    assert "already exists" in result.output


def test_cli_init_from_mdl_force(tmp_path: Path, sample_mdl_file: Path):
    """Overwrite with --force."""
    (tmp_path / "wren_project.yml").write_text("existing")
    from typer.testing import CliRunner

    from wren.cli import app

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--path",
            str(tmp_path),
            "--from-mdl",
            str(sample_mdl_file),
            "--force",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "Imported MDL" in result.output
    project = yaml.safe_load((tmp_path / "wren_project.yml").read_text())
    assert project["schema_version"] == 2
