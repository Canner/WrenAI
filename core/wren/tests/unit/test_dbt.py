"""Unit tests for dbt project and artifact loading helpers."""

from __future__ import annotations

import json

import pytest
import yaml

from wren.dbt import (
    DbtLoadError,
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
    def test_import_normalizes_column_types_with_dbt_adapter(
        self, tmp_path, monkeypatch
    ):
        project_dir, profiles_path = _write_basic_dbt_project(tmp_path)
        monkeypatch.setenv("JAFFLE_DUCKDB_PATH", "warehouse/jaffle.duckdb")
        catalog_path = project_dir / "build" / "catalog.json"
        catalog = json.loads(catalog_path.read_text())
        catalog["nodes"]["model.jaffle_shop.orders"]["columns"]["id"][
            "type"
        ] = "character varying(255)"
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
