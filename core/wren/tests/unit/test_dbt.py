"""Unit tests for dbt project and artifact loading helpers."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import duckdb
import pytest
import sqlglot
import yaml

from wren.dbt import (
    DbtLoadError,
    _apply_dbt_test_enrichment,
    _build_imported_models,
    _ensure_relationship,
    _find_column,
    convert_dbt_project_to_wren_project,
    convert_dbt_target_to_wren_profile,
    default_wren_profile_name,
    load_compiled_sql,
    load_dbt_artifacts,
    load_dbt_profiles,
    map_dbt_adapter_to_wren,
    resolve_dbt_target,
    resolve_env_vars,
)


def _write_basic_dbt_project(tmp_path):
    project_dir = tmp_path / "jaffle_shop"
    target_dir = project_dir / "build"
    compiled_dir = target_dir / "compiled" / "jaffle_shop" / "models"
    compiled_dir.mkdir(parents=True)

    (project_dir / "dbt_project.yml").write_text(
        "name: jaffle_shop\nprofile: jaffle_shop\ntarget-path: build\n"
    )
    (target_dir / "manifest.json").write_text(
        json.dumps(
            {
                "metadata": {"adapter_type": "duckdb"},
                "nodes": {
                    "model.jaffle_shop.orders": {
                        "resource_type": "model",
                        "name": "orders",
                    }
                },
            }
        )
    )
    (target_dir / "catalog.json").write_text(
        json.dumps(
            {
                "nodes": {
                    "model.jaffle_shop.orders": {
                        "metadata": {"type": "TABLE"},
                        "columns": {"id": {"type": "integer"}},
                    }
                }
            }
        )
    )
    (target_dir / "run_results.json").write_text(
        json.dumps(
            {
                "results": [
                    {
                        "unique_id": "test.jaffle_shop.not_null_orders_id",
                        "status": "pass",
                    }
                ]
            }
        )
    )
    (compiled_dir / "orders.sql").write_text("select * from orders\n")

    profiles_path = tmp_path / "profiles.yml"
    profiles_path.write_text(
        "jaffle_shop:\n"
        "  target: dev\n"
        "  outputs:\n"
        "    dev:\n"
        "      type: duckdb\n"
        "      path: \"{{ env_var('JAFFLE_DUCKDB_PATH') }}\"\n"
    )
    return project_dir, profiles_path


@pytest.mark.unit
class TestAdapterMapping:
    def test_map_known_adapter(self):
        assert map_dbt_adapter_to_wren("duckdb") == "duckdb"
        assert map_dbt_adapter_to_wren("sqlserver") == "mssql"

    def test_map_unknown_adapter(self):
        with pytest.raises(DbtLoadError, match="Unsupported dbt adapter"):
            map_dbt_adapter_to_wren("fabric")


@pytest.mark.unit
class TestEnvResolution:
    def test_resolve_env_var_string(self):
        value = "{{ env_var('DBT_PASSWORD') }}"
        resolved = resolve_env_vars(value, env={"DBT_PASSWORD": "secret"})
        assert resolved == "secret"

    def test_resolve_env_var_with_default(self):
        value = "{{ env_var('DBT_SCHEMA', 'analytics') }}"
        resolved = resolve_env_vars(value, env={})
        assert resolved == "analytics"

    def test_resolve_env_var_nested(self):
        payload = {
            "password": "{{ env_var('DBT_PASSWORD') }}",
            "schema": "{{ env_var('DBT_SCHEMA', 'public') }}",
            "extras": ["{{ env_var('DBT_ROLE', 'analyst') }}"],
        }
        resolved = resolve_env_vars(payload, env={"DBT_PASSWORD": "secret"})
        assert resolved["password"] == "secret"
        assert resolved["schema"] == "public"
        assert resolved["extras"] == ["analyst"]

    def test_resolve_env_var_missing_without_default(self):
        with pytest.raises(DbtLoadError, match="DBT_PASSWORD"):
            resolve_env_vars("{{ env_var('DBT_PASSWORD') }}", env={})


@pytest.mark.unit
class TestResolveDbtTarget:
    def test_load_profiles_accepts_directory_path(self, tmp_path):
        profiles_dir = tmp_path / "dbt"
        profiles_dir.mkdir()
        (profiles_dir / "profiles.yml").write_text("jaffle_shop: {}\n")

        assert load_dbt_profiles(profiles_dir) == {"jaffle_shop": {}}

    def test_load_profiles_uses_dbt_profiles_dir(self, tmp_path, monkeypatch):
        profiles_dir = tmp_path / "profiles"
        profiles_dir.mkdir()
        (profiles_dir / "profiles.yml").write_text("jaffle_shop: {}\n")
        monkeypatch.setenv("DBT_PROFILES_DIR", str(profiles_dir))

        assert load_dbt_profiles() == {"jaffle_shop": {}}

    def test_load_profiles_uses_cwd_before_home_fallback(self, tmp_path, monkeypatch):
        (tmp_path / "profiles.yml").write_text("jaffle_shop: {}\n")
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("DBT_PROFILES_DIR", raising=False)

        assert load_dbt_profiles() == {"jaffle_shop": {}}

    def test_resolve_target_from_project_and_profiles(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        target = resolve_dbt_target(
            project_dir,
            profiles_path=profiles_path,
            env={"JAFFLE_DUCKDB_PATH": "/tmp/jaffle.duckdb"},
        )

        assert target.profile_name == "jaffle_shop"
        assert target.target_name == "dev"
        assert target.datasource == "duckdb"
        assert target.adapter_type == "duckdb"
        assert target.output["path"] == "/tmp/jaffle.duckdb"
        assert target.target_path == project_dir / "build"

    def test_resolve_target_missing_profile(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        (project_dir / "dbt_project.yml").write_text("name: jaffle_shop\n")

        with pytest.raises(DbtLoadError, match="missing 'profile'"):
            resolve_dbt_target(project_dir, profiles_path=profiles_path)

    def test_resolve_target_missing_output(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        profiles_path.write_text(
            "jaffle_shop:\n  target: prod\n  outputs:\n    dev:\n      type: duckdb\n"
        )

        with pytest.raises(DbtLoadError, match="Available targets: dev"):
            resolve_dbt_target(project_dir, profiles_path=profiles_path)


@pytest.mark.unit
class TestConvertDbtTargetToWrenProfile:
    def test_default_profile_name(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        target = resolve_dbt_target(
            project_dir,
            profiles_path=profiles_path,
            env={"JAFFLE_DUCKDB_PATH": "/tmp/jaffle.duckdb"},
        )

        assert default_wren_profile_name(target) == "jaffle-shop-dev"

    def test_convert_duckdb_profile(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        target = resolve_dbt_target(
            project_dir,
            profiles_path=profiles_path,
            env={"JAFFLE_DUCKDB_PATH": "warehouse/jaffle.duckdb"},
        )

        profile = convert_dbt_target_to_wren_profile(target)

        assert profile == {
            "datasource": "duckdb",
            "url": str((project_dir / "warehouse").resolve()),
            "format": "duckdb",
        }

    def test_convert_postgres_profile(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        profiles_path.write_text(
            "jaffle_shop:\n"
            "  target: dev\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: postgres\n"
            "      host: localhost\n"
            "      port: 5432\n"
            "      dbname: analytics\n"
            "      user: postgres\n"
            "      password: secret\n"
        )
        target = resolve_dbt_target(project_dir, profiles_path=profiles_path)

        profile = convert_dbt_target_to_wren_profile(target)

        assert profile == {
            "datasource": "postgres",
            "host": "localhost",
            "port": "5432",
            "database": "analytics",
            "user": "postgres",
            "password": "secret",
        }

    def test_convert_postgres_profile_omits_missing_password(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        profiles_path.write_text(
            "jaffle_shop:\n"
            "  target: dev\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: postgres\n"
            "      host: localhost\n"
            "      port: 5432\n"
            "      dbname: analytics\n"
            "      user: postgres\n"
        )
        target = resolve_dbt_target(project_dir, profiles_path=profiles_path)

        profile = convert_dbt_target_to_wren_profile(target)

        assert profile == {
            "datasource": "postgres",
            "host": "localhost",
            "port": "5432",
            "database": "analytics",
            "user": "postgres",
        }

    def test_convert_bigquery_profile_from_keyfile_json(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        profiles_path.write_text(
            "jaffle_shop:\n"
            "  target: dev\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: bigquery\n"
            "      project: demo-project\n"
            "      dataset: analytics\n"
            "      keyfile_json:\n"
            "        client_email: analytics@example.com\n"
        )
        target = resolve_dbt_target(project_dir, profiles_path=profiles_path)

        profile = convert_dbt_target_to_wren_profile(target)

        assert profile["datasource"] == "bigquery"
        assert profile["bigquery_type"] == "dataset"
        assert profile["project_id"] == "demo-project"
        assert profile["dataset_id"] == "analytics"
        assert profile["credentials"]

    def test_map_starrocks_adapter(self):
        assert map_dbt_adapter_to_wren("starrocks") == "starrocks"

    def test_convert_starrocks_profile(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        profiles_path.write_text(
            "jaffle_shop:\n"
            "  target: dev\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: starrocks\n"
            "      host: sr.example.com\n"
            "      port: 9030\n"
            "      schema: analytics\n"
            "      username: etl\n"
            "      password: secret\n"
        )
        target = resolve_dbt_target(project_dir, profiles_path=profiles_path)

        profile = convert_dbt_target_to_wren_profile(target)

        assert profile["datasource"] == "starrocks"
        assert profile["host"] == "sr.example.com"
        assert profile["port"] == "9030"
        assert profile["database"] == "analytics"
        assert profile["user"] == "etl"
        assert profile["password"] == "secret"

    def test_convert_starrocks_profile_rejects_custom_catalog(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        profiles_path.write_text(
            "jaffle_shop:\n"
            "  target: dev\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: starrocks\n"
            "      host: sr.example.com\n"
            "      schema: analytics\n"
            "      username: etl\n"
            "      catalog: hive_catalog\n"
        )
        target = resolve_dbt_target(project_dir, profiles_path=profiles_path)

        with pytest.raises(DbtLoadError, match="catalog"):
            convert_dbt_target_to_wren_profile(target)

    def test_convert_databricks_profile_preserves_catalog(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        profiles_path.write_text(
            "jaffle_shop:\n"
            "  target: dev\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: databricks\n"
            "      host: dbc.example.cloud.databricks.com\n"
            "      http_path: /sql/1.0/warehouses/abc\n"
            "      token: dapi-token\n"
            "      catalog: main\n"
        )
        target = resolve_dbt_target(project_dir, profiles_path=profiles_path)

        profile = convert_dbt_target_to_wren_profile(target)

        assert profile == {
            "datasource": "databricks",
            "databricks_type": "token",
            "server_hostname": "dbc.example.cloud.databricks.com",
            "http_path": "/sql/1.0/warehouses/abc",
            "access_token": "dapi-token",
            "catalog": "main",
        }

    def test_convert_profile_missing_required_field(self, tmp_path):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        profiles_path.write_text(
            "jaffle_shop:\n"
            "  target: dev\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: postgres\n"
            "      host: localhost\n"
            "      port: 5432\n"
        )
        target = resolve_dbt_target(project_dir, profiles_path=profiles_path)

        with pytest.raises(DbtLoadError, match="dbname, database"):
            convert_dbt_target_to_wren_profile(target)


@pytest.mark.unit
class TestLoadDbtArtifacts:
    def test_import_preserves_quoted_column_tests(self, tmp_path):
        """Import verified quoted-column metadata and execute its recovered join."""
        project_dir = tmp_path / "dbt"
        fixture_dir = Path(__file__).parents[1] / "fixtures" / "dbt" / "quoted_columns"
        shutil.copytree(fixture_dir, project_dir / "target")
        (project_dir / "dbt_project.yml").write_text(
            "name: review_dbt\nprofile: review_dbt\n", encoding="utf-8"
        )
        profiles_path = project_dir / "profiles.yml"
        profiles_path.write_text(
            "review_dbt:\n  target: dev\n  outputs:\n"
            "    dev:\n      type: duckdb\n      path: warehouse.duckdb\n",
            encoding="utf-8",
        )

        imported = convert_dbt_project_to_wren_project(
            project_dir, output_dir=project_dir / "wren", profiles_path=profiles_path
        )
        files = {file.relative_path: file.content for file in imported.files}
        customers = yaml.safe_load(files["models/dim_customers/metadata.yml"])
        column = customers["columns"][0]
        assert customers["primary_key"] == "customer-id"
        assert column["not_null"] is True
        assert column["properties"]["dbt_tests"] == "not_null,unique"
        assert column["properties"]["dbt_test_status"] == "verified"
        assert imported.relationship_count == 1
        relationship = yaml.safe_load(files["relationships.yml"])["relationships"][0]
        condition = relationship["condition"]
        assert {
            (col.table, col.name)
            for col in sqlglot.parse_one(condition).find_all(sqlglot.exp.Column)
        } == {("fct_orders", "customer-id"), ("dim_customers", "customer-id")}
        # The restored join must refer to the actual columns, not subtraction.
        with duckdb.connect() as conn:
            conn.execute('CREATE TABLE dim_customers ("customer-id" INTEGER)')
            conn.execute('CREATE TABLE fct_orders ("customer-id" INTEGER)')
            conn.execute("INSERT INTO dim_customers VALUES (1), (2)")
            conn.execute("INSERT INTO fct_orders VALUES (1), (1), (2)")
            assert conn.execute(
                f"SELECT count(*) FROM fct_orders JOIN dim_customers ON {condition}"
            ).fetchone() == (3,)

    def test_import_skips_relationship_with_missing_target_column(
        self, tmp_path, monkeypatch
    ):
        """Keep test evidence without inventing a join to a missing catalog column."""
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        monkeypatch.setenv("JAFFLE_DUCKDB_PATH", "warehouse.duckdb")
        fixture_dir = Path(__file__).parents[1] / "fixtures" / "dbt" / "quoted_columns"
        for filename in ("manifest.json", "catalog.json", "run_results.json"):
            shutil.copyfile(fixture_dir / filename, project_dir / "build" / filename)
        catalog_path = project_dir / "build" / "catalog.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        del catalog["nodes"]["model.review_dbt.dim_customers"]["columns"]["customer-id"]
        catalog_path.write_text(json.dumps(catalog), encoding="utf-8")

        imported = convert_dbt_project_to_wren_project(
            project_dir, output_dir=project_dir / "wren", profiles_path=profiles_path
        )
        files = {file.relative_path: file.content for file in imported.files}
        assert imported.relationship_count == 0
        assert yaml.safe_load(files["relationships.yml"])["relationships"] == []
        assert "join verified" not in files["knowledge/rules/general.md"]

        artifacts = load_dbt_artifacts(project_dir)
        models, *_ = _build_imported_models(artifacts)
        relationships, events = _apply_dbt_test_enrichment(artifacts, models)
        assert relationships == []
        assert len(events) == 3
        event = next(event for event in events if event["test_name"] == "relationships")
        assert event["status"] == "verified"
        assert event["column_name"] == '"customer-id"'
        assert (
            not {"relationship_name", "target_model_name", "target_field"}
            & event.keys()
        )

    @pytest.mark.parametrize(
        "dialect, quoted_name, name",
        [
            ("duckdb", '"Customer-ID"', "Customer-ID"),
            ("duckdb", '"customer""id"', 'customer"id'),
            ("mysql", "`customer``id`", "customer`id"),
            ("tsql", "[customer]]id]", "customer]id"),
        ],
    )
    def test_find_quoted_column(self, dialect, quoted_name, name):
        """Decode identifier delimiters and escapes with the source adapter dialect."""
        column = {"name": name}
        assert (
            _find_column({"columns": [column]}, quoted_name, dialect=dialect) is column
        )

    def test_find_column_prefers_exact_catalog_name(self):
        """Keep literal quote characters when they are part of a physical name."""
        raw_column = {"name": '"id"'}
        assert (
            _find_column({"columns": [{"name": "id"}, raw_column]}, '"id"')
            is raw_column
        )

    def test_unquoted_columns_keep_existing_relationship_condition(self):
        """Preserve the existing lookup and join SQL for ordinary identifiers."""
        column = {"name": "customer_id"}
        orders = {"name": "orders", "columns": [column]}
        assert _find_column(orders, "customer_id", dialect="duckdb") is column
        relationships = []
        _ensure_relationship(
            relationships, {}, orders, "customer_id", {"name": "customers"}, "id"
        )
        assert relationships[0]["condition"] == "orders.customer_id = customers.id"

    @pytest.mark.parametrize("name", ["id", "'id'", "t.id", '"ID"', '"id'])
    def test_find_column_does_not_reinterpret_other_sql(self, name):
        """Reject SQL values, expressions, malformed quotes, and mismatched case."""
        assert (
            _find_column({"columns": [{"name": "ID" if name == "id" else "id"}]}, name)
            is None
        )

    def test_import_normalizes_column_types_with_dbt_adapter(
        self, tmp_path, monkeypatch
    ):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        monkeypatch.setenv("JAFFLE_DUCKDB_PATH", "warehouse/jaffle.duckdb")
        catalog_path = project_dir / "build" / "catalog.json"
        catalog = json.loads(catalog_path.read_text())
        catalog["nodes"]["model.jaffle_shop.orders"]["columns"]["id"]["type"] = (
            "character varying(255)"
        )
        catalog_path.write_text(json.dumps(catalog))

        imported = convert_dbt_project_to_wren_project(
            project_dir, profiles_path=profiles_path
        )

        model_file = next(
            file
            for file in imported.files
            if file.relative_path == "models/orders/metadata.yml"
        )
        metadata = yaml.safe_load(model_file.content)
        assert metadata["columns"][0]["type"] == "VARCHAR(255)"

    def test_load_artifacts(self, tmp_path):
        project_dir, _profiles_path = _write_basic_dbt_project(tmp_path)

        artifacts = load_dbt_artifacts(project_dir)

        assert artifacts.project_dir == project_dir.resolve()
        assert artifacts.target_path == (project_dir / "build").resolve()
        assert "model.jaffle_shop.orders" in artifacts.manifest["nodes"]
        assert "model.jaffle_shop.orders" in artifacts.catalog["nodes"]
        assert artifacts.run_results["results"][0]["status"] == "pass"
        assert (
            artifacts.compiled_sql["jaffle_shop/models/orders.sql"]
            == "select * from orders\n"
        )

    def test_load_artifacts_without_run_results(self, tmp_path):
        project_dir, _profiles_path = _write_basic_dbt_project(tmp_path)
        (project_dir / "build" / "run_results.json").unlink()

        artifacts = load_dbt_artifacts(project_dir)

        assert artifacts.run_results is None

    def test_load_artifacts_missing_manifest(self, tmp_path):
        project_dir, _profiles_path = _write_basic_dbt_project(tmp_path)
        (project_dir / "build" / "manifest.json").unlink()

        with pytest.raises(DbtLoadError, match="dbt manifest file not found"):
            load_dbt_artifacts(project_dir)

    def test_load_artifacts_invalid_catalog_json(self, tmp_path):
        project_dir, _profiles_path = _write_basic_dbt_project(tmp_path)
        (project_dir / "build" / "catalog.json").write_text("{")

        with pytest.raises(DbtLoadError, match="dbt catalog is not valid JSON"):
            load_dbt_artifacts(project_dir)

    def test_load_compiled_sql_missing_dir(self, tmp_path):
        assert load_compiled_sql(tmp_path / "missing") == {}

    def test_load_artifacts_missing_catalog_has_actionable_hint(self, tmp_path):
        project_dir, _profiles_path = _write_basic_dbt_project(tmp_path)
        (project_dir / "build" / "catalog.json").unlink()

        with pytest.raises(DbtLoadError, match="dbt docs generate"):
            load_dbt_artifacts(project_dir)
