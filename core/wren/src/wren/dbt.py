"""Helpers for reading dbt project configuration and generated artifacts."""

from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

_DEFAULT_DBT_TARGET_PATH = "target"
_COMPILED_DIR = "compiled"
_DBT_PROJECT_FILE = "dbt_project.yml"
_DBT_PROFILES_FILE = "profiles.yml"
_MANIFEST_FILE = "manifest.json"
_CATALOG_FILE = "catalog.json"
_RUN_RESULTS_FILE = "run_results.json"

_ENV_VAR_PATTERN = re.compile(
    r"""
    \{\{\s*
    env_var
    \(\s*
    (?P<quote1>['"])
    (?P<name>[^'"]+)
    (?P=quote1)
    (?:\s*,\s*
        (?P<quote2>['"])
        (?P<default>[^'"]*)
        (?P=quote2)
    )?
    \s*\)
    \s*\}\}
    """,
    re.VERBOSE,
)

DBT_ADAPTER_TO_WREN_DATASOURCE = {
    "athena": "athena",
    "bigquery": "bigquery",
    "clickhouse": "clickhouse",
    "databricks": "databricks",
    "doris": "mysql",
    "duckdb": "duckdb",
    "mysql": "mysql",
    "postgres": "postgres",
    "redshift": "redshift",
    "snowflake": "snowflake",
    "spark": "spark",
    "sqlserver": "mssql",
    "trino": "trino",
}


class DbtLoadError(ValueError):
    """Raised when dbt configuration or artifacts cannot be loaded."""


@dataclass(frozen=True)
class DbtTarget:
    """Resolved dbt target configuration."""

    project_dir: Path
    profile_name: str
    target_name: str
    target_path: Path
    adapter_type: str
    datasource: str
    project: dict[str, Any]
    profile: dict[str, Any]
    output: dict[str, Any]


@dataclass(frozen=True)
class DbtArtifacts:
    """Loaded dbt artifacts for a project/target."""

    project_dir: Path
    target_path: Path
    manifest: dict[str, Any]
    catalog: dict[str, Any]
    run_results: dict[str, Any] | None
    compiled_sql: dict[str, str]


@dataclass(frozen=True)
class DbtProjectImport:
    """Project files and summary generated from a dbt project."""

    files: list[Any]
    model_count: int
    source_count: int
    skipped_ephemeral: int
    skipped_without_columns: int
    relationship_count: int = 0


def default_wren_profile_name(target: DbtTarget) -> str:
    """Return a stable default Wren profile name for a dbt target."""
    return f"{target.profile_name}-{target.target_name}".replace("_", "-")


def map_dbt_adapter_to_wren(adapter_type: str) -> str:
    """Map a dbt adapter name to a Wren datasource name."""
    normalized = adapter_type.strip().lower()
    try:
        return DBT_ADAPTER_TO_WREN_DATASOURCE[normalized]
    except KeyError as exc:
        raise DbtLoadError(
            f"Unsupported dbt adapter '{adapter_type}'. "
            "Add a datasource mapping before importing this profile."
        ) from exc


def resolve_env_vars(value: Any, env: dict[str, str] | None = None) -> Any:
    """Recursively resolve dbt ``env_var()`` references inside YAML values."""
    env_map = env if env is not None else os.environ

    if isinstance(value, dict):
        return {k: resolve_env_vars(v, env=env_map) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve_env_vars(v, env=env_map) for v in value]
    if not isinstance(value, str):
        return value

    def _replace(match: re.Match[str]) -> str:
        name = match.group("name")
        default = match.group("default")
        if name in env_map:
            return env_map[name]
        if default is not None:
            return default
        raise DbtLoadError(
            f"Environment variable '{name}' is required by dbt config but is not set."
        )

    return _ENV_VAR_PATTERN.sub(_replace, value)


def load_dbt_project(project_dir: str | Path) -> dict[str, Any]:
    """Load ``dbt_project.yml`` from a dbt project directory."""
    root = Path(project_dir).expanduser().resolve()
    project_file = root / _DBT_PROJECT_FILE
    if not project_file.exists():
        raise DbtLoadError(
            f"dbt project file not found: {project_file}. "
            "Expected a directory containing dbt_project.yml."
        )
    project = _load_yaml_file(project_file, label="dbt project")
    if not isinstance(project, dict):
        raise DbtLoadError(
            f"dbt project file must contain a YAML mapping: {project_file}"
        )
    return project


def load_dbt_profiles(
    profiles_path: str | Path | None = None,
) -> dict[str, dict[str, Any]]:
    """Load dbt ``profiles.yml`` as a mapping of profile name to config."""
    path = (
        Path(profiles_path).expanduser()
        if profiles_path is not None
        else Path.home() / ".dbt" / _DBT_PROFILES_FILE
    )
    profiles = _load_yaml_file(path, label="dbt profiles")
    if profiles is None:
        raise DbtLoadError(f"dbt profiles file is empty: {path}")
    if not isinstance(profiles, dict):
        raise DbtLoadError(f"dbt profiles file must contain a YAML mapping: {path}")
    return profiles


def resolve_dbt_target(
    project_dir: str | Path,
    *,
    profiles_path: str | Path | None = None,
    profile_name: str | None = None,
    target_name: str | None = None,
    env: dict[str, str] | None = None,
) -> DbtTarget:
    """Resolve the active dbt profile and target for a project."""
    root = Path(project_dir).expanduser().resolve()
    project = load_dbt_project(root)
    selected_profile_name = profile_name or project.get("profile")
    if not selected_profile_name:
        raise DbtLoadError(
            "dbt project is missing 'profile'; pass --profile explicitly."
        )

    profiles = load_dbt_profiles(profiles_path)
    if selected_profile_name not in profiles:
        available = ", ".join(sorted(profiles)) or "none"
        raise DbtLoadError(
            f"dbt profile '{selected_profile_name}' not found in profiles.yml. "
            f"Available profiles: {available}."
        )

    profile = profiles[selected_profile_name]
    if not isinstance(profile, dict):
        raise DbtLoadError(f"dbt profile '{selected_profile_name}' must be a mapping.")

    outputs = profile.get("outputs")
    if not isinstance(outputs, dict) or not outputs:
        raise DbtLoadError(
            f"dbt profile '{selected_profile_name}' is missing 'outputs'."
        )

    selected_target_name = target_name or profile.get("target")
    if not selected_target_name:
        raise DbtLoadError(
            f"dbt profile '{selected_profile_name}' is missing 'target'. "
            "Pass --target explicitly."
        )
    if selected_target_name not in outputs:
        available_targets = ", ".join(sorted(outputs)) or "none"
        raise DbtLoadError(
            f"dbt target '{selected_target_name}' not found in profile "
            f"'{selected_profile_name}'. Available targets: {available_targets}."
        )

    resolved_output = resolve_env_vars(outputs[selected_target_name], env=env)
    if not isinstance(resolved_output, dict):
        raise DbtLoadError(
            f"dbt target '{selected_target_name}' must resolve to a mapping."
        )
    adapter_type = str(resolved_output.get("type") or "").strip()
    if not adapter_type:
        raise DbtLoadError(
            f"dbt target '{selected_target_name}' is missing adapter 'type'."
        )

    target_dir_name = str(project.get("target-path") or _DEFAULT_DBT_TARGET_PATH)
    target_path = root / target_dir_name

    return DbtTarget(
        project_dir=root,
        profile_name=selected_profile_name,
        target_name=selected_target_name,
        target_path=target_path,
        adapter_type=adapter_type,
        datasource=map_dbt_adapter_to_wren(adapter_type),
        project=project,
        profile=profile,
        output=resolved_output,
    )


def load_dbt_artifacts(
    project_dir: str | Path,
    *,
    target_path: str | Path | None = None,
) -> DbtArtifacts:
    """Load the dbt artifacts needed for Wren import."""
    root = Path(project_dir).expanduser().resolve()
    project = load_dbt_project(root)
    resolved_target_path = (
        Path(target_path).expanduser().resolve()
        if target_path is not None
        else root / str(project.get("target-path") or _DEFAULT_DBT_TARGET_PATH)
    )

    manifest = _load_json_file(
        resolved_target_path / _MANIFEST_FILE,
        label="dbt manifest",
    )
    catalog = _load_json_file(
        resolved_target_path / _CATALOG_FILE,
        label="dbt catalog",
    )

    run_results_path = resolved_target_path / _RUN_RESULTS_FILE
    run_results = (
        _load_json_file(run_results_path, label="dbt run results")
        if run_results_path.exists()
        else None
    )

    compiled_sql = load_compiled_sql(resolved_target_path / _COMPILED_DIR)

    return DbtArtifacts(
        project_dir=root,
        target_path=resolved_target_path,
        manifest=manifest,
        catalog=catalog,
        run_results=run_results,
        compiled_sql=compiled_sql,
    )


def load_compiled_sql(compiled_dir: str | Path) -> dict[str, str]:
    """Load compiled SQL files keyed by their relative path."""
    root = Path(compiled_dir).expanduser()
    if not root.exists():
        return {}

    sql_files = sorted(path for path in root.rglob("*.sql") if path.is_file())
    return {
        str(path.relative_to(root)): path.read_text(encoding="utf-8")
        for path in sql_files
    }


def convert_dbt_project_to_wren_project(
    project_dir: str | Path,
    *,
    output_dir: str | Path | None = None,
    profiles_path: str | Path | None = None,
    profile_name: str | None = None,
    target_name: str | None = None,
) -> DbtProjectImport:
    """Convert dbt artifacts into Wren project files."""
    from wren.context import (  # noqa: PLC0415
        _AGENTS_MD_TEMPLATE,
        ProjectFile,
    )

    target = resolve_dbt_target(
        project_dir,
        profiles_path=profiles_path,
        profile_name=profile_name,
        target_name=target_name,
    )
    artifacts = load_dbt_artifacts(project_dir, target_path=target.target_path)
    project_root = (
        Path(output_dir).expanduser().resolve()
        if output_dir is not None
        else Path.cwd().resolve()
    )

    (
        imported_models,
        model_count,
        source_count,
        skipped_ephemeral,
        skipped_no_columns,
    ) = _build_imported_models(artifacts)
    relationships, test_events = _apply_dbt_test_enrichment(artifacts, imported_models)
    query_pairs = _build_dbt_query_pairs(
        imported_models,
        relationships,
        datasource=target.datasource,
    )

    dbt_binding_dir = _relative_or_absolute_path(target.project_dir, project_root)
    project_config = {
        "schema_version": 2,
        "name": artifacts.manifest.get("metadata", {}).get(
            "project_name", target.project.get("name", "dbt_project")
        ),
        "version": str(target.project.get("version", "1.0")),
        "catalog": "wren",
        "schema": "public",
        "data_source": target.datasource,
        "dbt": {
            "project_dir": dbt_binding_dir,
            "profile": target.profile_name,
            "target": target.target_name,
        },
    }

    files = [
        ProjectFile(
            relative_path="wren_project.yml",
            content=yaml.dump(
                project_config, default_flow_style=False, sort_keys=False
            ),
        ),
        ProjectFile(
            relative_path="relationships.yml",
            content=yaml.dump(
                {"relationships": relationships},
                default_flow_style=False,
                sort_keys=False,
            ),
        ),
        ProjectFile(
            relative_path="instructions.md",
            content=_build_base_instructions(
                target,
                model_count,
                source_count,
                relationships,
                test_events,
                artifacts.run_results is not None,
            ),
        ),
        ProjectFile(relative_path="AGENTS.md", content=_AGENTS_MD_TEMPLATE),
        ProjectFile(
            relative_path="queries.yml",
            content=yaml.dump(
                {"version": 1, "pairs": query_pairs},
                default_flow_style=False,
                sort_keys=False,
            ),
        ),
    ]

    files.extend(
        ProjectFile(
            relative_path=f"models/{model['name']}/metadata.yml",
            content=yaml.dump(model, default_flow_style=False, sort_keys=False),
        )
        for model in imported_models
    )

    return DbtProjectImport(
        files=files,
        model_count=model_count,
        source_count=source_count,
        skipped_ephemeral=skipped_ephemeral,
        skipped_without_columns=skipped_no_columns,
        relationship_count=len(relationships),
    )


def convert_dbt_target_to_wren_profile(target: DbtTarget) -> dict[str, Any]:
    """Convert a resolved dbt target into a Wren profile payload."""
    output = target.output
    datasource = target.datasource

    if datasource == "duckdb":
        path_value = str(_require_output_field(output, "path"))
        db_path = Path(path_value).expanduser()
        if not db_path.is_absolute():
            db_path = (target.project_dir / db_path).resolve()
        url = db_path if not db_path.suffix else db_path.parent
        return {"datasource": "duckdb", "url": str(url), "format": "duckdb"}

    if datasource == "postgres":
        return {
            "datasource": "postgres",
            "host": str(_require_output_field(output, "host")),
            "port": str(output.get("port", "5432")),
            "database": str(_require_output_field(output, "dbname", "database")),
            "user": str(_require_output_field(output, "user")),
            "password": str(output["password"]) if output.get("password") else None,
        }

    if datasource in {"mysql", "redshift", "mssql", "clickhouse"}:
        return _filter_none(
            {
                "datasource": datasource,
                "host": str(_require_output_field(output, "host")),
                "port": str(_require_output_field(output, "port")),
                "database": str(
                    _require_output_field(output, "dbname", "database", "catalog")
                ),
                "user": str(_require_output_field(output, "user")),
                "password": str(output["password"]) if output.get("password") else None,
            }
        )

    if datasource == "snowflake":
        return _filter_none(
            {
                "datasource": "snowflake",
                "account": str(_require_output_field(output, "account")),
                "user": str(_require_output_field(output, "user")),
                "password": str(output["password"]) if output.get("password") else None,
                "database": str(_require_output_field(output, "database")),
                "schema": str(_require_output_field(output, "schema")),
                "warehouse": output.get("warehouse"),
            }
        )

    if datasource == "trino":
        return _filter_none(
            {
                "datasource": "trino",
                "host": str(_require_output_field(output, "host")),
                "port": str(output.get("port", "8080")),
                "catalog": str(_require_output_field(output, "database", "catalog")),
                "schema": str(_require_output_field(output, "schema")),
                "user": output.get("user"),
                "password": (
                    str(output["password"]) if output.get("password") else None
                ),
            }
        )

    if datasource == "athena":
        return _filter_none(
            {
                "datasource": "athena",
                "s3_staging_dir": str(
                    _require_output_field(output, "s3_staging_dir", "s3_data_dir")
                ),
                "region_name": output.get("region_name"),
                "schema_name": output.get("schema", output.get("schema_name")),
                "aws_access_key_id": output.get("aws_access_key_id"),
                "aws_secret_access_key": output.get("aws_secret_access_key"),
                "aws_session_token": output.get("aws_session_token"),
                "role_arn": output.get("role_arn"),
                "role_session_name": output.get("role_session_name"),
            }
        )

    if datasource == "spark":
        return {
            "datasource": "spark",
            "host": str(_require_output_field(output, "host")),
            "port": str(output.get("port", "15002")),
        }

    if datasource == "databricks":
        return {
            "datasource": "databricks",
            "databricks_type": "token",
            "server_hostname": str(
                _require_output_field(output, "server_hostname", "host")
            ),
            "http_path": str(_require_output_field(output, "http_path", "httpPath")),
            "access_token": str(
                _require_output_field(output, "token", "access_token", "accessToken")
            ),
        }

    if datasource == "bigquery":
        credentials = _bigquery_credentials_base64(output)
        return _filter_none(
            {
                "datasource": "bigquery",
                "bigquery_type": "dataset",
                "project_id": str(_require_output_field(output, "project")),
                "dataset_id": str(_require_output_field(output, "dataset")),
                "credentials": credentials,
            }
        )

    raise DbtLoadError(
        f"dbt adapter '{target.adapter_type}' maps to datasource '{datasource}', "
        "but profile conversion has not been implemented yet."
    )


def _load_yaml_file(path: Path, *, label: str) -> Any:
    """Load YAML from *path* with a consistent error surface."""
    if not path.exists():
        raise DbtLoadError(f"{label} file not found: {path}")
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise DbtLoadError(f"{label} is not valid YAML: {path}: {exc}") from exc


def _load_json_file(path: Path, *, label: str) -> dict[str, Any]:
    """Load JSON from *path* with a consistent error surface."""
    if not path.exists():
        hint = ""
        if label == "dbt catalog":
            hint = " Run `dbt docs generate` to create catalog.json."
        raise DbtLoadError(f"{label} file not found: {path}.{hint}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise DbtLoadError(f"{label} is not valid JSON: {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise DbtLoadError(f"{label} must contain a JSON object: {path}")
    return data


def _require_output_field(output: dict[str, Any], *keys: str) -> Any:
    """Return the first present non-empty output field."""
    for key in keys:
        value = output.get(key)
        if value not in (None, ""):
            return value
    names = ", ".join(keys)
    raise DbtLoadError(f"dbt target is missing required field(s): {names}")


def _filter_none(values: dict[str, Any]) -> dict[str, Any]:
    """Drop keys with None values."""
    return {key: value for key, value in values.items() if value is not None}


def _bigquery_credentials_base64(output: dict[str, Any]) -> str:
    """Encode BigQuery credentials from dbt output into Wren's expected format."""
    if output.get("credentials"):
        return str(output["credentials"])

    if output.get("keyfile"):
        keyfile = Path(str(output["keyfile"])).expanduser()
        if not keyfile.exists():
            raise DbtLoadError(f"BigQuery keyfile not found: {keyfile}")
        return base64.b64encode(keyfile.read_bytes()).decode()

    if output.get("keyfile_json"):
        payload = output["keyfile_json"]
        raw = (
            json.dumps(payload, ensure_ascii=False)
            if isinstance(payload, dict)
            else str(payload)
        )
        return base64.b64encode(raw.encode("utf-8")).decode()

    raise DbtLoadError(
        "BigQuery dbt target requires one of: credentials, keyfile, or keyfile_json."
    )


def _build_imported_models(
    artifacts: DbtArtifacts,
) -> tuple[list[dict[str, Any]], int, int, int, int]:
    manifest = artifacts.manifest
    catalog_nodes = artifacts.catalog.get("nodes", {})
    catalog_sources = artifacts.catalog.get("sources", {})

    imported_models: list[dict[str, Any]] = []
    used_names: set[str] = set()
    model_count = 0
    source_count = 0
    skipped_ephemeral = 0
    skipped_without_columns = 0

    for unique_id, node in sorted(manifest.get("nodes", {}).items()):
        if node.get("resource_type") != "model":
            continue
        if str(node.get("config", {}).get("materialized", "")).lower() == "ephemeral":
            skipped_ephemeral += 1
            continue
        model = _build_model_metadata(
            unique_id=unique_id,
            node=node,
            catalog_entry=catalog_nodes.get(unique_id, {}),
            wren_name=str(node.get("alias") or node.get("name") or ""),
            dbt_resource_type="model",
        )
        if model is None:
            skipped_without_columns += 1
            continue
        _ensure_unique_model_name(model["name"], used_names)
        imported_models.append(model)
        model_count += 1

    for unique_id, node in sorted(manifest.get("sources", {}).items()):
        source_name = _choose_source_model_name(node, used_names)
        model = _build_model_metadata(
            unique_id=unique_id,
            node=node,
            catalog_entry=catalog_sources.get(unique_id, {}),
            wren_name=source_name,
            dbt_resource_type="source",
        )
        if model is None:
            skipped_without_columns += 1
            continue
        _ensure_unique_model_name(model["name"], used_names)
        imported_models.append(model)
        source_count += 1

    return (
        imported_models,
        model_count,
        source_count,
        skipped_ephemeral,
        skipped_without_columns,
    )


def _apply_dbt_test_enrichment(
    artifacts: DbtArtifacts, imported_models: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    model_by_unique_id = {
        model.get("properties", {}).get("dbt_unique_id"): model
        for model in imported_models
    }
    status_by_unique_id = _build_run_results_index(artifacts.run_results)
    relationships: list[dict[str, Any]] = []
    relationship_keys: dict[tuple[str, str, str, str], str] = {}
    test_events: list[dict[str, Any]] = []

    for unique_id, node in sorted(artifacts.manifest.get("nodes", {}).items()):
        if node.get("resource_type") != "test":
            continue

        attached_uid = node.get("attached_node") or _infer_attached_node(node)
        if not attached_uid or attached_uid not in model_by_unique_id:
            continue

        model = model_by_unique_id[attached_uid]
        test_meta = node.get("test_metadata") or {}
        test_name = str(test_meta.get("name") or node.get("name") or "").strip()
        if not test_name:
            continue
        kwargs = test_meta.get("kwargs") or {}
        column_name = node.get("column_name") or kwargs.get("column_name")
        column = _find_column(model, str(column_name)) if column_name else None
        status_info = status_by_unique_id.get(unique_id, {})
        status = _normalize_test_status(status_info.get("status"))
        failures = status_info.get("failures")

        event: dict[str, Any] = {
            "unique_id": unique_id,
            "model_name": model["name"],
            "column_name": str(column_name) if column_name else None,
            "test_name": test_name,
            "status": status,
            "failures": failures,
        }

        if column is not None:
            _record_column_test(column, test_name, status)
            if test_name == "not_null":
                column["not_null"] = True
            elif test_name == "accepted_values":
                values = kwargs.get("values") or []
                if values:
                    column.setdefault("properties", {})["accepted_values"] = ",".join(
                        str(value) for value in values
                    )
                    event["values"] = [str(value) for value in values]
            elif test_name == "relationships":
                target_uid = _resolve_relationship_target_uid(node, attached_uid)
                target_model = model_by_unique_id.get(target_uid)
                target_field = str(kwargs.get("field") or "id")
                if target_model is not None:
                    rel_name = _ensure_relationship(
                        relationships,
                        relationship_keys,
                        model,
                        column["name"],
                        target_model,
                        target_field,
                    )
                    # Do NOT stamp column["relationship"] — the relationship is
                    # already recorded in relationships.yml. Putting it on the
                    # column causes the Wren engine to treat the FK as a join
                    # dereference, hiding it from direct SELECT.
                    event["relationship_name"] = rel_name
                    event["target_model_name"] = target_model["name"]
                    event["target_field"] = target_field

        test_events.append(event)

    _finalize_column_tests(imported_models)
    _sort_relationships(relationships)
    return relationships, test_events


def _build_model_metadata(
    *,
    unique_id: str,
    node: dict[str, Any],
    catalog_entry: dict[str, Any],
    wren_name: str,
    dbt_resource_type: str,
) -> dict[str, Any] | None:
    columns = _extract_columns(node, catalog_entry)
    if not columns:
        return None

    table_name = (
        node.get("identifier")
        or node.get("alias")
        or node.get("relation_name")
        or node.get("name")
    )
    if not table_name:
        raise DbtLoadError(f"dbt node '{unique_id}' is missing a relation name.")

    properties = _filter_none(
        {
            "description": _clean_description(node.get("description")),
            "dbt_layer": infer_dbt_layer(node),
            "dbt_unique_id": unique_id,
            "dbt_resource_type": dbt_resource_type,
        }
    )

    return {
        "name": wren_name,
        "table_reference": {
            "catalog": node.get("database", ""),
            "schema": node.get("schema", ""),
            "table": str(table_name),
        },
        "columns": columns,
        "cached": False,
        "properties": properties,
    }


def _extract_columns(node: dict[str, Any], catalog_entry: dict[str, Any]) -> list[dict]:
    manifest_columns = node.get("columns", {}) or {}
    catalog_columns = catalog_entry.get("columns", {}) or {}

    # When catalog data is available, restrict to columns that actually exist in
    # the database. Manifest-only columns (documented in schema.yml but not
    # materialized) are skipped to avoid referencing non-existent columns.
    if catalog_columns:
        merged_names = list(catalog_columns)
        for name in manifest_columns:
            if name not in merged_names:
                pass  # manifest-only: skip
    else:
        merged_names = list(manifest_columns)

    def _sort_key(name: str) -> tuple[int, int, str]:
        catalog_index = catalog_columns.get(name, {}).get("index")
        return (0 if catalog_index is not None else 1, catalog_index or 0, name)

    columns: list[dict] = []
    for name in sorted(merged_names, key=_sort_key):
        manifest_col = manifest_columns.get(name, {}) or {}
        catalog_col = catalog_columns.get(name, {}) or {}
        description = _clean_description(manifest_col.get("description"))
        data_type = (
            catalog_col.get("type") or manifest_col.get("data_type") or "VARCHAR"
        )
        column = {
            "name": name,
            "type": str(data_type).upper(),
            "is_calculated": False,
            "not_null": False,
            "properties": _filter_none({"description": description}),
        }
        columns.append(column)
    return columns


def infer_dbt_layer(node: dict[str, Any]) -> str:
    """Infer a dbt layer from resource metadata."""
    if node.get("resource_type") == "source":
        return "raw"

    fqn = [str(part).lower() for part in node.get("fqn", [])]
    name = str(node.get("name") or "").lower()
    materialized = str(node.get("config", {}).get("materialized") or "").lower()

    if materialized == "ephemeral":
        return "ephemeral"
    if any("staging" == part for part in fqn) or name.startswith("stg_"):
        return "staging"
    if any("marts" == part for part in fqn) or name.startswith(("fct_", "dim_")):
        return "mart"
    if any("intermediate" == part for part in fqn) or name.startswith("int_"):
        return "intermediate"
    return "model"


def _choose_source_model_name(node: dict[str, Any], used_names: set[str]) -> str:
    base = f"raw_{node.get('name')}"
    if base not in used_names:
        return base
    source_name = node.get("source_name") or "source"
    return f"raw_{source_name}_{node.get('name')}"


def _ensure_unique_model_name(name: str, used_names: set[str]) -> None:
    if name in used_names:
        raise DbtLoadError(
            f"Duplicate Wren model name '{name}' generated from dbt artifacts. "
            "Use dbt aliases or adjust the import naming strategy."
        )
    used_names.add(name)


def _clean_description(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _build_base_instructions(
    target: DbtTarget,
    model_count: int,
    source_count: int,
    relationships: list[dict[str, Any]],
    test_events: list[dict[str, Any]],
    has_run_results: bool,
) -> str:
    lines = [
        "# Imported from dbt",
        "",
        f"- dbt project: `{target.project.get('name', target.project_dir.name)}`",
        f"- dbt profile/target: `{target.profile_name}.{target.target_name}`",
        f"- imported models: {model_count}",
        f"- imported sources: {source_count}",
        f"- imported relationships: {len(relationships)}",
        "",
        "Structural metadata comes from `manifest.json` and `catalog.json`. "
        "The sections below summarize dbt test-derived constraints and warnings.",
        "",
    ]

    verified_lines = _build_verified_constraint_lines(test_events)
    warning_lines = _build_warning_lines(test_events, has_run_results)

    lines.extend(["## Verified Constraints", ""])
    if verified_lines:
        lines.extend(f"- {line}" for line in verified_lines)
    else:
        lines.append("- No verified dbt constraints were imported.")
    lines.append("")

    lines.extend(["## Relationships", ""])
    if relationships:
        for rel in relationships:
            models = rel.get("models", [])
            if len(models) >= 2:
                lines.append(
                    f"- {models[0]} -> {models[1]} ({rel.get('join_type', 'MANY_TO_ONE')})"
                )
    else:
        lines.append("- No dbt relationship tests were imported.")
    lines.append("")

    lines.extend(["## Data Quality Warnings", ""])
    if warning_lines:
        lines.extend(f"- {line}" for line in warning_lines)
    elif not has_run_results and test_events:
        lines.append("- Test status unknown. Run `dbt test` or `dbt build` to verify.")
    else:
        lines.append("- No dbt test warnings detected.")
    lines.append("")

    return "\n".join(lines)


def _relative_or_absolute_path(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return os.path.relpath(path, root)


def _build_run_results_index(
    run_results: dict[str, Any] | None,
) -> dict[str, dict[str, Any]]:
    if not run_results:
        return {}
    index: dict[str, dict[str, Any]] = {}
    for row in run_results.get("results", []):
        unique_id = row.get("unique_id")
        if unique_id:
            index[str(unique_id)] = {
                "status": row.get("status"),
                "failures": row.get("failures"),
            }
    return index


def _normalize_test_status(status: Any) -> str:
    value = str(status or "").lower()
    if value in {"pass", "success"}:
        return "verified"
    if value == "fail":
        return "failing"
    if value == "error":
        return "error"
    if value in {"warn", "warning"}:
        return "warning"
    return "unknown"


def _infer_attached_node(node: dict[str, Any]) -> str | None:
    depends_on = node.get("depends_on", {}) or {}
    for unique_id in depends_on.get("nodes", []):
        if str(unique_id).startswith(("model.", "source.")):
            return str(unique_id)
    return None


def _find_column(model: dict[str, Any], column_name: str) -> dict[str, Any] | None:
    for column in model.get("columns", []):
        if column.get("name") == column_name:
            return column
    return None


def _record_column_test(column: dict[str, Any], test_name: str, status: str) -> None:
    props = column.setdefault("properties", {})
    tests = props.setdefault("_dbt_tests", [])
    tests.append(test_name)
    statuses = props.setdefault("_dbt_test_statuses", [])
    statuses.append(status)


def _resolve_relationship_target_uid(
    node: dict[str, Any], attached_uid: str
) -> str | None:
    depends_on = node.get("depends_on", {}) or {}
    for candidate in depends_on.get("nodes", []):
        candidate = str(candidate)
        if candidate != attached_uid and candidate.startswith(("model.", "source.")):
            return candidate
    return None


def _ensure_relationship(
    relationships: list[dict[str, Any]],
    relationship_keys: dict[tuple[str, str, str, str], str],
    model: dict[str, Any],
    column_name: str,
    target_model: dict[str, Any],
    target_field: str,
) -> str:
    key = (model["name"], column_name, target_model["name"], target_field)
    existing = relationship_keys.get(key)
    if existing:
        return existing

    base_name = f"{model['name']}_to_{target_model['name']}"
    rel_name = base_name
    suffix = 2
    existing_names = {rel["name"] for rel in relationships}
    while rel_name in existing_names:
        rel_name = f"{base_name}_{suffix}"
        suffix += 1

    relationship_keys[key] = rel_name
    relationships.append(
        {
            "name": rel_name,
            "models": [model["name"], target_model["name"]],
            "join_type": _infer_join_type(model, target_model),
            "condition": (
                f"{model['name']}.{column_name} = {target_model['name']}.{target_field}"
            ),
            "properties": {"source": "dbt_test"},
        }
    )
    return rel_name


def _infer_join_type(model: dict[str, Any], target_model: dict[str, Any]) -> str:
    model_layer = str(model.get("properties", {}).get("dbt_layer", "")).lower()
    model_name = model["name"].lower()
    target_name = target_model["name"].lower()

    if model_name.startswith("fct_") or model_layer == "mart":
        if (
            target_name.startswith("dim_")
            or target_model.get("properties", {}).get("dbt_layer") == "mart"
        ):
            return "MANY_TO_ONE"
    if model_name.startswith("dim_"):
        return "ONE_TO_ONE"
    return "MANY_TO_ONE"


def _finalize_column_tests(imported_models: list[dict[str, Any]]) -> None:
    for model in imported_models:
        primary_key = model.get("primary_key")
        for column in model.get("columns", []):
            props = column.setdefault("properties", {})
            tests = sorted(set(props.pop("_dbt_tests", [])))
            statuses = props.pop("_dbt_test_statuses", [])

            if tests:
                props["dbt_tests"] = ",".join(tests)
            if statuses:
                props["dbt_test_status"] = _aggregate_status(statuses)

            if column.get("not_null") and "unique" in tests:
                column["is_primary_key"] = True
                if primary_key is None:
                    primary_key = column["name"]
        if primary_key:
            model["primary_key"] = primary_key


def _aggregate_status(statuses: list[str]) -> str:
    if any(status in {"failing", "error", "warning"} for status in statuses):
        for priority in ("failing", "error", "warning"):
            if priority in statuses:
                return priority
    if any(status == "verified" for status in statuses):
        return "verified"
    return "unknown"


def _sort_relationships(relationships: list[dict[str, Any]]) -> None:
    relationships.sort(key=lambda rel: rel.get("name", ""))


def _build_verified_constraint_lines(test_events: list[dict[str, Any]]) -> list[str]:
    grouped: dict[tuple[str, str | None], dict[str, Any]] = {}
    relationship_lines: list[str] = []

    for event in test_events:
        if event["status"] != "verified":
            continue
        if event["test_name"] == "relationships" and event.get("target_model_name"):
            relationship_lines.append(
                f"{event['model_name']}.{event['column_name']} -> "
                f"{event['target_model_name']}.{event['target_field']} "
                f"(MANY_TO_ONE join verified)"
            )
            continue

        key = (event["model_name"], event.get("column_name"))
        entry = grouped.setdefault(
            key,
            {
                "tests": set(),
                "values": None,
            },
        )
        entry["tests"].add(event["test_name"])
        if event["test_name"] == "accepted_values":
            entry["values"] = event.get("values") or []

    lines: list[str] = []
    for (model_name, column_name), entry in sorted(grouped.items()):
        tests = entry["tests"]
        if not column_name:
            continue
        if {"unique", "not_null"} <= tests:
            lines.append(f"{model_name}.{column_name}: NOT NULL, UNIQUE (primary key)")
        else:
            if "not_null" in tests:
                lines.append(f"{model_name}.{column_name}: NOT NULL")
            if "unique" in tests:
                lines.append(f"{model_name}.{column_name}: UNIQUE")
        if entry["values"]:
            values = ", ".join(entry["values"])
            lines.append(f"{model_name}.{column_name}: accepted values = {values}")

    lines.extend(sorted(set(relationship_lines)))
    return lines


def _build_warning_lines(
    test_events: list[dict[str, Any]], has_run_results: bool
) -> list[str]:
    warnings: list[str] = []
    for event in test_events:
        status = event["status"]
        if status == "verified":
            continue
        if status == "unknown" and not has_run_results:
            continue

        location = event["model_name"]
        if event.get("column_name"):
            location += f".{event['column_name']}"

        test_name = event["test_name"]
        failures = event.get("failures")
        failure_suffix = f" ({failures} failures)" if failures not in (None, "") else ""
        warnings.append(f"{location}: {test_name} {status}{failure_suffix}")

    if not has_run_results and test_events:
        warnings.append("Test status unknown. Run `dbt test` or `dbt build` to verify.")
    return warnings


def _build_dbt_query_pairs(
    imported_models: list[dict[str, Any]],
    relationships: list[dict[str, Any]],
    *,
    datasource: str,
) -> list[dict[str, Any]]:
    from wren.memory.seed_queries import generate_seed_queries  # noqa: PLC0415

    manifest = {
        "models": [_seed_model_payload(model) for model in imported_models],
        "relationships": [_seed_relationship_payload(rel) for rel in relationships],
    }

    pairs = generate_seed_queries(manifest)
    return [
        {
            "nl": pair["nl"],
            "sql": pair["sql"],
            "source": "dbt",
            "datasource": datasource,
        }
        for pair in pairs
    ]


def _seed_model_payload(model: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": model["name"],
        "primaryKey": model.get("primary_key"),
        "properties": _camelize_props(model.get("properties", {})),
        "columns": [
            {
                "name": column["name"],
                "type": column.get("type"),
                "isCalculated": column.get("is_calculated", False),
                "properties": _camelize_props(column.get("properties", {})),
            }
            for column in model.get("columns", [])
        ],
    }


def _seed_relationship_payload(relationship: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": relationship.get("name"),
        "models": relationship.get("models", []),
        "joinType": relationship.get("join_type"),
        "condition": relationship.get("condition", ""),
    }


def _camelize_props(properties: dict[str, Any]) -> dict[str, Any]:
    mapping = {
        "accepted_values": "acceptedValues",
        "data_scope": "dataScope",
        "dbt_layer": "dbtLayer",
        "dbt_test_status": "dbtTestStatus",
        "dbt_tests": "dbtTests",
        "derived_from": "derivedFrom",
    }
    result: dict[str, Any] = {}
    for key, value in properties.items():
        result[mapping.get(key, key)] = value
    return result
