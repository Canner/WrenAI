"""Context management — load YAML MDL files, validate, build manifest JSON."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

_WREN_HOME = Path(os.environ.get("WREN_HOME", Path.home() / ".wren"))
_DEFAULT_PROJECT = _WREN_HOME / "project"
PROJECT_FILE = "wren_project.yml"
_TARGET_DIR = "target"
_TARGET_FILE = "mdl.json"

_AGENTS_MD_TEMPLATE = """\
# AGENTS.md

This project uses [Wren Engine](https://github.com/Canner/WrenAI) as the semantic layer for data querying. Queries are written against MDL model names, not raw database tables.

## Answering data questions

When the user asks about data, metrics, reports, or business questions, follow this workflow:

1. `wren memory fetch -q "<question>"` — get relevant schema context
2. `wren memory recall -q "<question>" --limit 3` — find similar past queries
3. Write SQL using model names from the MDL (not raw table names)
4. `wren --sql "<sql>"` — execute through the semantic layer
5. `wren memory store --nl "<question>" --sql "<sql>"` — store confirmed results

If this is the first query in the session, also run `wren context instructions` to load business rules.

## Modifying the data model

When the user wants to add models, change schema, or onboard a new table:

1. Edit YAML files in `models/`, `views/`, or `relationships.yml`
2. `wren context validate` — check structure
3. `wren context build` — compile to `target/mdl.json`
4. `wren memory index` — re-index schema for search

## Prerequisites

This project requires the `wren` CLI. Install with your data source extra:

```bash
pip install "wrenai[postgres,memory,ui]"
```

Replace `postgres` with your data source (`mysql`, `bigquery`, `snowflake`, `clickhouse`, `trino`, `mssql`, `databricks`, `redshift`, `spark`, `athena`, `oracle`). The `memory` extra enables semantic search; `ui` enables the interactive UI.

See https://docs.getwren.ai/oss/engine/get_started/installation for full setup.

## Quick reference

| Task | Command |
|------|---------|
| Run a query | `wren --sql "SELECT ..."` |
| Preview planned SQL | `wren dry-plan --sql "SELECT ..."` |
| Show available models | `wren context show` |
| Check connection | `wren profile debug` |
| Check memory index | `wren memory status` |
| Rebuild after changes | `wren context build && wren memory index` |
"""


# ── Case conversion ───────────────────────────────────────────────────────


def _snake_to_camel(name: str) -> str:
    """Convert snake_case to camelCase."""
    parts = name.split("_")
    return parts[0] + "".join(w.capitalize() for w in parts[1:])


def _convert_keys(obj: Any) -> Any:
    """Recursively convert all dict keys from snake_case to camelCase."""
    if isinstance(obj, dict):
        return {_snake_to_camel(k): _convert_keys(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_keys(item) for item in obj]
    return obj


# Known camelCase → snake_case pairs (inverse of snake→camel mapping)
_CAMEL_TO_SNAKE_MAP = {
    "tableReference": "table_reference",
    "refSql": "ref_sql",
    "isCalculated": "is_calculated",
    "notNull": "not_null",
    "isPrimaryKey": "is_primary_key",
    "primaryKey": "primary_key",
    "joinType": "join_type",
    "dataSource": "data_source",
    "layoutVersion": "layout_version",
    "refreshTime": "refresh_time",
    "baseObject": "base_object",
    "rowLevelAccessControls": "row_level_access_controls",
    "columnLevelAccessControl": "column_level_access_control",
    "requiredProperties": "required_properties",
    "defaultExpr": "default_expr",
    "isHidden": "is_hidden",
}


def _camel_to_snake(name: str) -> str:
    """Convert camelCase to snake_case.

    Uses known mapping table first, then generic regex fallback.
    """
    if name in _CAMEL_TO_SNAKE_MAP:
        return _CAMEL_TO_SNAKE_MAP[name]
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower()


def _convert_keys_to_snake(obj: Any) -> Any:
    """Recursively convert all dict keys from camelCase to snake_case."""
    if isinstance(obj, dict):
        return {_camel_to_snake(k): _convert_keys_to_snake(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_keys_to_snake(item) for item in obj]
    return obj


# ── MDL JSON → YAML project conversion ───────────────────────────────────


@dataclass
class ProjectFile:
    """A file to be written during project conversion."""

    relative_path: str  # e.g. "models/orders/metadata.yml"
    content: str  # file content (YAML or SQL or Markdown)


def convert_mdl_to_project(mdl_json: dict) -> list[ProjectFile]:
    """Convert an MDL JSON manifest to a list of project files.

    Args:
        mdl_json: Parsed MDL JSON (camelCase keys).

    Returns:
        List of ProjectFile objects, each representing a file to write.
    """
    files: list[ProjectFile] = []

    # ── wren_project.yml ──────────────────────────────────────
    # Map layoutVersion back to schema_version
    layout_version = mdl_json.get("layoutVersion", 1)
    _LAYOUT_TO_SCHEMA = {1: 2, 2: 3, 3: 4}
    schema_version = _LAYOUT_TO_SCHEMA.get(
        layout_version, 4 if layout_version >= 3 else (3 if layout_version >= 2 else 2)
    )
    project_config: dict[str, Any] = {"schema_version": schema_version}
    if "name" in mdl_json:
        project_config["name"] = mdl_json["name"]
    elif "projectName" in mdl_json:
        project_config["name"] = mdl_json["projectName"]
    if "catalog" in mdl_json:
        project_config["catalog"] = mdl_json["catalog"]
    if "schema" in mdl_json:
        project_config["schema"] = mdl_json["schema"]
    if "dataSource" in mdl_json:
        project_config["data_source"] = mdl_json["dataSource"]

    files.append(
        ProjectFile(
            relative_path="wren_project.yml",
            content=yaml.dump(
                project_config,
                default_flow_style=False,
                sort_keys=False,
                allow_unicode=True,
            ),
        )
    )

    # ── Models ────────────────────────────────────────────────
    for i, model in enumerate(mdl_json.get("models", [])):
        model_snake = _convert_keys_to_snake(model)
        if "name" not in model_snake:
            raise ValueError(f"Model at index {i} is missing required 'name' field")
        name = model_snake["name"]
        dir_path = f"models/{name}"

        ref_sql = model_snake.pop("ref_sql", None)
        if ref_sql:
            files.append(
                ProjectFile(
                    relative_path=f"{dir_path}/ref_sql.sql",
                    content=ref_sql.strip() + "\n",
                )
            )

        files.append(
            ProjectFile(
                relative_path=f"{dir_path}/metadata.yml",
                content=yaml.dump(
                    model_snake,
                    default_flow_style=False,
                    sort_keys=False,
                    allow_unicode=True,
                ),
            )
        )

    # ── Views ─────────────────────────────────────────────────
    for i, view in enumerate(mdl_json.get("views", [])):
        view_snake = _convert_keys_to_snake(view)
        if "name" not in view_snake:
            raise ValueError(f"View at index {i} is missing required 'name' field")
        name = view_snake["name"]
        dir_path = f"views/{name}"

        statement = view_snake.pop("statement", None)
        if statement and "\n" in statement.strip():
            files.append(
                ProjectFile(
                    relative_path=f"{dir_path}/sql.yml",
                    content=yaml.dump(
                        {"statement": statement},
                        default_flow_style=False,
                        sort_keys=False,
                        allow_unicode=True,
                    ),
                )
            )
        elif statement:
            view_snake["statement"] = statement

        files.append(
            ProjectFile(
                relative_path=f"{dir_path}/metadata.yml",
                content=yaml.dump(
                    view_snake,
                    default_flow_style=False,
                    sort_keys=False,
                    allow_unicode=True,
                ),
            )
        )

    # ── Relationships ─────────────────────────────────────────
    relationships = mdl_json.get("relationships", [])
    if relationships:
        rels_snake = [_convert_keys_to_snake(r) for r in relationships]
        files.append(
            ProjectFile(
                relative_path="relationships.yml",
                content=yaml.dump(
                    {"relationships": rels_snake},
                    default_flow_style=False,
                    sort_keys=False,
                    allow_unicode=True,
                ),
            )
        )

    # ── Instructions ──────────────────────────────────────────
    instructions = mdl_json.get("_instructions")
    if instructions:
        files.append(
            ProjectFile(
                relative_path="instructions.md",
                content=instructions.strip() + "\n",
            )
        )

    # ── AGENTS.md ──────────────────────────────────────────────
    files.append(
        ProjectFile(
            relative_path="AGENTS.md",
            content=_AGENTS_MD_TEMPLATE,
        )
    )

    return files


def write_project_files(
    files: list[ProjectFile],
    output_dir: Path,
    *,
    force: bool = False,
) -> None:
    """Write project files to disk.

    Args:
        files: List of ProjectFile from convert_mdl_to_project().
        output_dir: Target directory.
        force: If False, raise SystemExit if any target file already exists.
    """
    output_dir = Path(output_dir)

    if force and output_dir.exists():
        import shutil  # noqa: PLC0415

        managed_paths = {
            "models",
            "views",
            "relationships.yml",
            "instructions.md",
            "wren_project.yml",
            "AGENTS.md",
        }
        if any(f.relative_path == "queries.yml" for f in files):
            managed_paths.add("queries.yml")

        for managed in managed_paths:
            target = output_dir / managed
            if target.is_dir():
                shutil.rmtree(target)
            elif target.exists():
                target.unlink()

    if not force:
        conflicts = [
            f.relative_path for f in files if (output_dir / f.relative_path).exists()
        ]
        if conflicts:
            names = ", ".join(f"'{Path(p).name}'" for p in conflicts)
            raise SystemExit(
                f"Error: {names} already exists. Use --force to overwrite."
            )

    for f in files:
        root = output_dir.resolve()
        path = (output_dir / f.relative_path).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            raise SystemExit(f"Error: invalid output path: {f.relative_path!r}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f.content)


# ── Project discovery ─────────────────────────────────────────────────────


def load_global_config() -> dict:
    """Load ~/.wren/config.yml (global preferences)."""
    config_file = _WREN_HOME / "config.yml"
    if not config_file.exists():
        return {}
    return yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}


def discover_project_path(explicit: str | None = None) -> Path:
    """Return the project directory path.

    Priority:
    1. explicit arg (--project / --path flag)
    2. WREN_PROJECT_HOME env var
    3. Walk up from cwd looking for wren_project.yml
    4. default_project in ~/.wren/config.yml
    5. Raise SystemExit with actionable message
    """
    if explicit:
        return Path(explicit).expanduser()

    # 2. WREN_PROJECT_HOME env var
    env = os.environ.get("WREN_PROJECT_HOME")
    if env:
        return Path(env).expanduser()

    # 3. Walk up from cwd looking for wren_project.yml
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / PROJECT_FILE).exists():
            return parent
        # Stop at home or root
        if parent == Path.home() or parent == parent.parent:
            break

    # 4. ~/.wren/config.yml default_project
    cfg = load_global_config()
    if cfg.get("default_project"):
        return Path(cfg["default_project"]).expanduser()

    raise SystemExit(
        "Error: no wren project found.\n"
        "  Run this command from a directory containing wren_project.yml,\n"
        "  run `wren context init` to create one, or set WREN_PROJECT_HOME."
    )


def load_project_config(project_path: Path) -> dict:
    """Load wren_project.yml and return as dict."""
    config_file = project_path / PROJECT_FILE
    if not config_file.exists():
        return {}
    return yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}


# Field order preferred when writing wren_project.yml back from a dict —
# keeps the file readable for humans even after CLI commands rewrite it.
# Anything not in this list is appended in dict-iteration order at the end.
_PROJECT_FIELD_ORDER = (
    "schema_version",
    "name",
    "version",
    "catalog",
    "schema",
    "data_source",
    "profile",
)


def save_project_config(project_path: Path, config: dict) -> None:
    """Write ``wren_project.yml`` with a stable field ordering.

    Drops YAML comments — round-tripping with comments would require
    ``ruamel.yaml`` which isn't a dependency. The file is rewritten by
    set-profile / upgrade-style commands; comments are init-template only.
    """
    ordered: dict = {}
    for key in _PROJECT_FIELD_ORDER:
        if key in config:
            ordered[key] = config[key]
    for key, value in config.items():
        if key not in ordered:
            ordered[key] = value

    (project_path / PROJECT_FILE).write_text(
        yaml.safe_dump(
            ordered, default_flow_style=False, sort_keys=False, allow_unicode=True
        )
    )


_SUPPORTED_SCHEMA_VERSIONS = {1, 2, 3, 4, 5}

# schema_version → layoutVersion mapping for the engine.
# v5 is the unified OSS/SaaS layout (knowledge/ as first-class project-layout);
# it adds no engine-facing MDL JSON, so it reuses v4's engine layoutVersion 3.
_LAYOUT_VERSION_MAP = {1: 1, 2: 1, 3: 2, 4: 3, 5: 3}

# knowledge/ layout (v5). Single source of truth — reused by the v4→v5 upgrade
# step and by project init. The knowledge axis has its own schema_version in
# knowledge.yml, decoupled from the MDL schema_version in wren_project.yml.
_KNOWLEDGE_SUBDIRS = ("rules", "glossary", "metrics", "caveats", "sql")
_KNOWLEDGE_CONFIG_FILE = "knowledge/knowledge.yml"
_KNOWLEDGE_SCHEMA_VERSION = 1
_SUPPORTED_KNOWLEDGE_VERSIONS = {1}

# Valid dialect values (matches Rust DataSource enum)
_VALID_DIALECTS = {
    "athena",
    "bigquery",
    "canner",
    "clickhouse",
    "databricks",
    "datafusion",
    "doris",
    "duckdb",
    "gcs_file",
    "local_file",
    "minio_file",
    "mssql",
    "mysql",
    "oracle",
    "postgres",
    "redshift",
    "s3_file",
    "snowflake",
    "spark",
    "trino",
}


def get_schema_version(project_path: Path) -> int:
    """Return the schema_version from wren_project.yml (default 1)."""
    config = load_project_config(project_path)
    raw = config.get("schema_version", 1)
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise SystemExit(
            f"Error: invalid schema_version {raw!r} in {PROJECT_FILE}. Expected an integer."
        )


def require_schema_version(project_path: Path) -> int:
    """Return schema_version or raise SystemExit if unsupported."""
    sv = get_schema_version(project_path)
    if sv not in _SUPPORTED_SCHEMA_VERSIONS:
        raise SystemExit(
            f"Error: unsupported schema_version {sv} in {PROJECT_FILE}. "
            "Please upgrade wren CLI."
        )
    return sv


# ── Loaders (all return snake_case dicts) ─────────────────────────────────


def load_models(project_path: Path) -> list[dict]:
    """Load models — dispatches on schema_version.

    v1 (legacy): models/*.yml (flat files)
    v2-v5: models/<name>/metadata.yml + optional ref_sql.sql (directory-per-model)
    """
    sv = get_schema_version(project_path)
    if sv == 1:
        return _load_models_v1(project_path)
    # sv in {2, 3, 4, 5}: directory-per-model layout
    return _load_models_v2(project_path)


def _load_models_v1(project_path: Path) -> list[dict]:
    """Legacy: load model YAML files from project_path/models/*.yml."""
    models_dir = project_path / "models"
    if not models_dir.is_dir():
        return []
    models = []
    for f in sorted(models_dir.glob("*.yml")):
        data = yaml.safe_load(f.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data["_source_dir"] = f.stem
            models.append(data)
    return models


def _load_models_v2(project_path: Path) -> list[dict]:
    """v2: load models from project_path/models/<model_name>/ directories.

    Each model directory must contain metadata.yml and optionally ref_sql.sql.
    If ref_sql.sql exists, its content is used as the model's `ref_sql` field
    and takes precedence over any `ref_sql` defined inline in metadata.yml.
    """
    models_dir = project_path / "models"
    if not models_dir.is_dir():
        return []
    models = []
    for d in sorted(models_dir.iterdir()):
        if not d.is_dir():
            continue
        meta_file = d / "metadata.yml"
        if not meta_file.exists():
            continue
        model = yaml.safe_load(meta_file.read_text(encoding="utf-8")) or {}
        if not isinstance(model, dict):
            continue
        model["_source_dir"] = d.name

        # Merge ref_sql.sql if present (takes precedence)
        ref_sql_file = d / "ref_sql.sql"
        if ref_sql_file.exists():
            sql_content = ref_sql_file.read_text(encoding="utf-8").strip()
            if sql_content:
                model["ref_sql"] = sql_content

        models.append(model)
    return models


def load_views(project_path: Path) -> list[dict]:
    """Load views — dispatches on schema_version.

    v1 (legacy): views.yml (single file with `views:` list)
    v2-v5: views/<name>/metadata.yml + optional sql.yml (directory-per-view)
    """
    sv = get_schema_version(project_path)
    if sv == 1:
        return _load_views_v1(project_path)
    # sv in {2, 3, 4, 5}: directory-per-view layout
    return _load_views_v2(project_path)


def _load_views_v1(project_path: Path) -> list[dict]:
    """Legacy: load views from project_path/views.yml."""
    views_file = project_path / "views.yml"
    if not views_file.exists():
        return []
    data = yaml.safe_load(views_file.read_text(encoding="utf-8")) or {}
    return data.get("views", []) if isinstance(data, dict) else []


def _load_views_v2(project_path: Path) -> list[dict]:
    """v2: load views from project_path/views/<view_name>/ directories.

    Each view directory must contain metadata.yml and optionally sql.yml.
    If sql.yml exists, its `statement` field takes precedence over any
    `statement` defined inline in metadata.yml.
    """
    views_dir = project_path / "views"
    if not views_dir.is_dir():
        return []
    views = []
    for d in sorted(views_dir.iterdir()):
        if not d.is_dir():
            continue
        meta_file = d / "metadata.yml"
        if not meta_file.exists():
            continue
        view = yaml.safe_load(meta_file.read_text(encoding="utf-8")) or {}
        if not isinstance(view, dict):
            continue
        view["_source_dir"] = d.name

        # Merge sql.yml if present (takes precedence)
        sql_file = d / "sql.yml"
        if sql_file.exists():
            sql_data = yaml.safe_load(sql_file.read_text(encoding="utf-8")) or {}
            if isinstance(sql_data, dict) and sql_data.get("statement"):
                view["statement"] = sql_data["statement"]

        views.append(view)
    return views


def load_cubes(project_path: Path) -> list[dict]:
    """Load cubes — dispatches on schema_version.

    v1 (legacy): cubes/*.yml
    v2-v5: cubes/<name>/metadata.yml (directory-per-cube)
    """
    sv = get_schema_version(project_path)
    if sv == 1:
        return _load_cubes_v1(project_path)
    # sv in {2, 3, 4, 5}: directory-per-cube layout
    return _load_cubes_v2(project_path)


def _load_cubes_v1(project_path: Path) -> list[dict]:
    """Legacy: load cube YAML files from project_path/cubes/*.yml."""
    cubes_dir = project_path / "cubes"
    if not cubes_dir.is_dir():
        return []
    cubes = []
    for f in sorted(cubes_dir.glob("*.yml")):
        data = yaml.safe_load(f.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data["_source_file"] = f.name
            cubes.append(data)
    return cubes


def _load_cubes_v2(project_path: Path) -> list[dict]:
    """v2: load cubes from project_path/cubes/<cube_name>/ directories.

    Each cube directory must contain metadata.yml.
    """
    cubes_dir = project_path / "cubes"
    if not cubes_dir.is_dir():
        return []
    cubes = []
    for d in sorted(cubes_dir.iterdir()):
        if not d.is_dir():
            continue
        meta_file = d / "metadata.yml"
        if not meta_file.exists():
            continue
        data = yaml.safe_load(meta_file.read_text())
        if isinstance(data, dict):
            data["_source_file"] = str(meta_file.relative_to(cubes_dir))
            cubes.append(data)
    return cubes


def _cube_migration_target(cube: dict, source_file: str | None) -> tuple[str, str]:
    """Return (cube_name, target_metadata_path) for a v1 cube migration."""
    name = cube.get("name", Path(source_file).stem if source_file else "unknown")
    return name, f"cubes/{name}/metadata.yml"


def load_relationships(project_path: Path) -> list[dict]:
    """Load relationships from project_path/relationships.yml."""
    rel_file = project_path / "relationships.yml"
    if not rel_file.exists():
        return []
    data = yaml.safe_load(rel_file.read_text(encoding="utf-8")) or {}
    return data.get("relationships", []) if isinstance(data, dict) else []


def load_instructions(project_path: Path) -> str | None:
    """Load the legacy instructions.md as a string.

    Deprecated in favour of knowledge/rules/ — see load_rules().
    """
    inst_file = project_path / "instructions.md"
    if not inst_file.exists():
        return None
    return inst_file.read_text(encoding="utf-8").strip() or None


def load_knowledge_rules(project_path: Path) -> str | None:
    """Concatenate knowledge/rules/*.md (sorted). None if there are none."""
    rules_dir = project_path / "knowledge" / "rules"
    if not rules_dir.is_dir():
        return None
    parts = [
        text
        for f in sorted(rules_dir.glob("*.md"))
        if (text := f.read_text(encoding="utf-8").strip())
    ]
    return "\n\n".join(parts) if parts else None


def load_rules(project_path: Path) -> tuple[str | None, bool]:
    """Load business rules from knowledge/rules/ and the legacy instructions.md.

    Returns ``(content, used_legacy)`` where ``used_legacy`` is True when the
    deprecated instructions.md contributed content, so callers can warn.
    """
    parts: list[str] = []
    rules = load_knowledge_rules(project_path)
    if rules:
        parts.append(rules)
    legacy = load_instructions(project_path)
    if legacy:
        parts.append(legacy)
    content = "\n\n".join(parts) if parts else None
    return content, legacy is not None


def load_knowledge_config(project_path: Path) -> dict:
    """Load knowledge/knowledge.yml (knowledge version axis). Empty dict if absent."""
    kfile = project_path / _KNOWLEDGE_CONFIG_FILE
    if not kfile.exists():
        return {}
    data = yaml.safe_load(kfile.read_text(encoding="utf-8")) or {}
    return data if isinstance(data, dict) else {}


def get_knowledge_schema_version(project_path: Path) -> int:
    """Return the knowledge-axis schema_version (default 1). Decoupled from MDL.

    Returns 0 when there is no knowledge/ at all.
    """
    if not (project_path / "knowledge").is_dir():
        return 0
    cfg = load_knowledge_config(project_path)
    raw = cfg.get("schema_version", _KNOWLEDGE_SCHEMA_VERSION)
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise SystemExit(
            f"Error: invalid schema_version {raw!r} in {_KNOWLEDGE_CONFIG_FILE}. "
            "Expected an integer."
        )


# ── Build ─────────────────────────────────────────────────────────────────


def build_manifest(project_path: Path) -> dict:
    """Build a complete MDL manifest dict from the project directory.

    Returns the manifest in snake_case (YAML-native form).
    Use build_json() to get the camelCase JSON form for the engine.
    Instructions are not included — use load_instructions() separately.
    """
    project_config = load_project_config(project_path)
    models = load_models(project_path)
    views = load_views(project_path)
    relationships = load_relationships(project_path)
    cubes = load_cubes(project_path)

    # Strip internal metadata
    for m in models:
        m.pop("_source_dir", None)
    for v in views:
        v.pop("_source_dir", None)
    for c in cubes:
        c.pop("_source_file", None)

    manifest: dict = {
        "catalog": project_config.get("catalog", "wren"),
        "schema": project_config.get("schema", "public"),
        "models": models,
        "relationships": relationships,
        "views": views,
        "cubes": cubes,
    }
    data_source = project_config.get("data_source")
    if data_source:
        manifest["data_source"] = data_source
    return manifest


def build_json(project_path: Path) -> dict:
    """Build the final camelCase JSON manifest for the engine.

    Stamps layoutVersion based on schema_version mapping.
    """
    manifest = _convert_keys(build_manifest(project_path))
    sv = get_schema_version(project_path)
    manifest["layoutVersion"] = _LAYOUT_VERSION_MAP.get(sv, 1)
    return manifest


def save_target(manifest_json: dict, project_path: Path) -> Path:
    """Write mdl.json to target/ directory. Returns the output path."""
    target_dir = project_path / _TARGET_DIR
    target_dir.mkdir(parents=True, exist_ok=True)
    out = target_dir / _TARGET_FILE
    out.write_text(json.dumps(manifest_json, indent=2, ensure_ascii=False))
    return out


# ── Validation ────────────────────────────────────────────────────────────


class ValidationError:
    """A single validation issue."""

    def __init__(self, level: str, path: str, message: str):
        self.level = level  # "error" | "warning"
        self.path = path  # e.g. "models/orders.yml > column 'foo'"
        self.message = message

    def __str__(self):
        return f"[{self.level.upper()}] {self.path}: {self.message}"


def validate_project(project_path: Path) -> list[ValidationError]:
    """Validate project-level structure.

    Checks:
    0. wren_project.yml exists and has required fields
    1. Every model has a name and at least one column
    2. Every column has name and type
    3. Model has exactly one of table_reference or ref_sql (not both, not neither)
    4. Relationship references existing model names
    5. No duplicate model/view names
    6. Views have a statement
    7. primary_key column exists in the model's columns
    8. table_reference (if used) has at least a table field
    """
    errors: list[ValidationError] = []
    sv = 1  # default; may be overridden below

    # Check project config
    config = load_project_config(project_path)
    if not config:
        errors.append(
            ValidationError(
                "error", PROJECT_FILE, f"'{PROJECT_FILE}' not found or empty"
            )
        )
    else:
        for required in ("name", "data_source"):
            if not config.get(required):
                errors.append(
                    ValidationError(
                        "error", PROJECT_FILE, f"missing required field '{required}'"
                    )
                )
        raw_sv = config.get("schema_version", 1)
        try:
            sv = int(raw_sv)
        except (TypeError, ValueError):
            errors.append(
                ValidationError(
                    "error",
                    PROJECT_FILE,
                    f"schema_version must be an integer, got {raw_sv!r}",
                )
            )
            sv = 1
        if sv not in _SUPPORTED_SCHEMA_VERSIONS:
            errors.append(
                ValidationError(
                    "error",
                    PROJECT_FILE,
                    f"unsupported schema_version {sv} — please upgrade wren CLI",
                )
            )

    if any(e.path == PROJECT_FILE and "schema_version" in e.message for e in errors):
        return errors

    # knowledge/ version axis — independent of the MDL schema_version above.
    if (project_path / "knowledge").is_dir():
        kcfg = load_knowledge_config(project_path)
        raw_kv = kcfg.get("schema_version", _KNOWLEDGE_SCHEMA_VERSION)
        try:
            kv = int(raw_kv)
        except (TypeError, ValueError):
            errors.append(
                ValidationError(
                    "error",
                    _KNOWLEDGE_CONFIG_FILE,
                    f"schema_version must be an integer, got {raw_kv!r}",
                )
            )
        else:
            if kv not in _SUPPORTED_KNOWLEDGE_VERSIONS:
                errors.append(
                    ValidationError(
                        "error",
                        _KNOWLEDGE_CONFIG_FILE,
                        f"unsupported knowledge schema_version {kv} — please upgrade wren CLI",
                    )
                )

    # Load data (snake_case)
    models = load_models(project_path)
    views = load_views(project_path)
    relationships = load_relationships(project_path)
    cubes = load_cubes(project_path)

    model_names: set[str] = set()
    view_names: set[str] = set()

    # Check models
    for i, model in enumerate(models):
        src = model.get("_source_dir", f"models[{i}]")
        src_path = f"models/{src}/metadata.yml"
        name = model.get("name")
        if not name:
            errors.append(ValidationError("error", src_path, "model missing 'name'"))
            continue

        if name in model_names:
            errors.append(
                ValidationError("error", src_path, f"duplicate model name '{name}'")
            )
        model_names.add(name)

        # table_reference vs ref_sql: exactly one required
        has_tref = bool(model.get("table_reference"))
        has_ref_sql = bool(model.get("ref_sql"))
        if has_tref and has_ref_sql:
            errors.append(
                ValidationError(
                    "error",
                    f"{src_path} > {name}",
                    "model has both 'table_reference' and 'ref_sql' — choose one",
                )
            )
        elif not has_tref and not has_ref_sql:
            errors.append(
                ValidationError(
                    "error",
                    f"{src_path} > {name}",
                    "model must define either 'table_reference' or 'ref_sql'",
                )
            )
        elif has_tref:
            tref = model.get("table_reference", {})
            if not tref.get("table"):
                errors.append(
                    ValidationError(
                        "warning",
                        f"{src_path} > {name}",
                        "table_reference.table is empty",
                    )
                )

        columns = model.get("columns", [])
        if not isinstance(columns, list):
            errors.append(
                ValidationError(
                    "error", f"{src_path} > {name}", "columns must be a list"
                )
            )
            columns = []
        if not columns:
            errors.append(
                ValidationError(
                    "warning", f"{src_path} > {name}", "model has no columns"
                )
            )

        col_names = set()
        for j, col in enumerate(columns):
            if not isinstance(col, dict):
                errors.append(
                    ValidationError(
                        "error",
                        f"{src_path} > {name} > columns[{j}]",
                        "column entry must be an object",
                    )
                )
                continue
            col_name = col.get("name")
            if not col_name:
                errors.append(
                    ValidationError(
                        "error",
                        f"{src_path} > {name} > columns[{j}]",
                        "column missing 'name'",
                    )
                )
                continue
            if col_name in col_names:
                errors.append(
                    ValidationError(
                        "error",
                        f"{src_path} > {name}",
                        f"duplicate column '{col_name}'",
                    )
                )
            col_names.add(col_name)

            if not col.get("type"):
                errors.append(
                    ValidationError(
                        "warning",
                        f"{src_path} > {name} > {col_name}",
                        "column missing 'type'",
                    )
                )

        pk = model.get("primary_key")
        if pk is None:
            pk_cols = []
        elif isinstance(pk, str):
            pk_cols = [pk]
        elif isinstance(pk, list) and all(isinstance(c, str) and c for c in pk) and pk:
            pk_cols = pk
        else:
            errors.append(
                ValidationError(
                    "error",
                    f"{src_path} > {name}",
                    "primary_key must be a non-empty string or list of non-empty strings",
                )
            )
            pk_cols = []
        for pk_col in pk_cols:
            if pk_col not in col_names:
                errors.append(
                    ValidationError(
                        "error",
                        f"{src_path} > {name}",
                        f"primary_key '{pk_col}' not found in columns",
                    )
                )

        # Composite (list-form) primary_key is a layoutVersion 3 / schema_version 4
        # wire format that older engines cannot deserialize.
        if isinstance(pk, list) and sv < 4:
            errors.append(
                ValidationError(
                    "warning",
                    f"{src_path} > {name}",
                    f"composite primary_key requires schema_version >= 4 (current: {sv})",
                )
            )

        # Validate dialect (if present)
        model_dialect = model.get("dialect")
        if model_dialect is not None:
            if sv < 3:
                errors.append(
                    ValidationError(
                        "warning",
                        f"{src_path} > {name}",
                        f"'dialect' field requires schema_version >= 3 (current: {sv})",
                    )
                )
            if model_dialect.lower() not in _VALID_DIALECTS:
                errors.append(
                    ValidationError(
                        "error",
                        f"{src_path} > {name}",
                        f"unknown dialect '{model_dialect}'",
                    )
                )

    # Check views
    for i, view in enumerate(views):
        src_dir = view.get("_source_dir", f"views[{i}]")
        name = view.get("name")
        if not name:
            errors.append(
                ValidationError(
                    "error", f"views/{src_dir}/metadata.yml", "view missing 'name'"
                )
            )
            continue
        if name in view_names or name in model_names:
            errors.append(
                ValidationError("error", f"views/{src_dir}", f"duplicate name '{name}'")
            )
        view_names.add(name)

        if not view.get("statement"):
            errors.append(
                ValidationError(
                    "error",
                    f"views/{src_dir}",
                    "view missing 'statement' (define in metadata.yml or sql.yml)",
                )
            )

        # Validate dialect (if present)
        view_dialect = view.get("dialect")
        if view_dialect is not None:
            if sv < 3:
                errors.append(
                    ValidationError(
                        "warning",
                        f"views/{src_dir}",
                        f"'dialect' field requires schema_version >= 3 (current: {sv})",
                    )
                )
            if view_dialect.lower() not in _VALID_DIALECTS:
                errors.append(
                    ValidationError(
                        "error",
                        f"views/{src_dir}",
                        f"unknown dialect '{view_dialect}'",
                    )
                )

    # Check relationships
    all_entity_names = model_names | view_names
    for i, rel in enumerate(relationships):
        if not isinstance(rel, dict):
            errors.append(
                ValidationError(
                    "error",
                    f"relationships[{i}]",
                    "relationship entry must be an object",
                )
            )
            continue
        rel_name = rel.get("name", f"relationships[{i}]")
        ref_models = rel.get("models", [])
        for m in ref_models:
            if m not in all_entity_names:
                errors.append(
                    ValidationError(
                        "error",
                        f"relationships > {rel_name}",
                        f"references unknown model '{m}'",
                    )
                )
        if not rel.get("condition"):
            errors.append(
                ValidationError(
                    "warning", f"relationships > {rel_name}", "missing join condition"
                )
            )
        if not rel.get("join_type"):
            errors.append(
                ValidationError(
                    "warning", f"relationships > {rel_name}", "missing join_type"
                )
            )

    # Check cubes — only structural / reference checks here. Deep validation
    # (measure cycles, hierarchy levels) runs Rust-side in
    # AnalyzedWrenMDL::analyze (see wren-core lineage::validate_cubes).
    cube_names: set[str] = set()
    for i, cube in enumerate(cubes):
        src = cube.get("_source_file", f"cubes[{i}]")
        src_path = f"cubes/{src}"
        name = cube.get("name")
        if not name:
            errors.append(ValidationError("error", src_path, "cube missing 'name'"))
            continue
        if name in cube_names:
            errors.append(
                ValidationError("error", src_path, f"duplicate cube name '{name}'")
            )
        cube_names.add(name)

        base = cube.get("base_object")
        if not base:
            errors.append(
                ValidationError(
                    "error",
                    f"{src_path} > {name}",
                    "cube missing 'base_object'",
                )
            )
        elif base not in all_entity_names:
            errors.append(
                ValidationError(
                    "error",
                    f"{src_path} > {name}",
                    f"base_object '{base}' is not a defined model or view",
                )
            )

        measures = cube.get("measures") or []
        if not measures:
            errors.append(
                ValidationError(
                    "warning",
                    f"{src_path} > {name}",
                    "cube has no measures",
                )
            )

        # Sanity-check hierarchy levels reference declared dimensions /
        # time_dimensions. Rust-side validation does the same check, but
        # surfacing it at YAML time gives faster feedback before build.
        # Only keep string names so a malformed YAML entry doesn't leak a
        # non-hashable value into the set lookup below.
        dim_names = {
            d.get("name")
            for d in (cube.get("dimensions") or [])
            if isinstance(d, dict) and isinstance(d.get("name"), str)
        }
        td_names = {
            td.get("name")
            for td in (cube.get("time_dimensions") or [])
            if isinstance(td, dict) and isinstance(td.get("name"), str)
        }
        known_dims = dim_names | td_names
        hierarchies = cube.get("hierarchies") or {}
        if isinstance(hierarchies, dict):
            for hname, levels in hierarchies.items():
                if not isinstance(levels, list):
                    continue
                for level in levels:
                    if not isinstance(level, str):
                        errors.append(
                            ValidationError(
                                "error",
                                f"{src_path} > {name} > hierarchies.{hname}",
                                "hierarchy levels must be strings",
                            )
                        )
                        continue
                    if level not in known_dims:
                        errors.append(
                            ValidationError(
                                "error",
                                f"{src_path} > {name} > hierarchies.{hname}",
                                f"references unknown dimension '{level}'",
                            )
                        )

    return errors


# ── Upgrade ──────────────────────────────────────────────────────────────────

_LATEST_SCHEMA_VERSION = max(_SUPPORTED_SCHEMA_VERSIONS)


@dataclass
class UpgradeResult:
    """Result of a project schema upgrade."""

    from_version: int
    to_version: int
    files_created: list[str]
    files_deleted: list[str]
    files_modified: list[str]


class UpgradeError(Exception):
    """Raised when a project upgrade cannot proceed."""


def _knowledge_skeleton_targets() -> list[str]:
    """Canonical relative paths of a fresh knowledge/ skeleton.

    Empty subdirectories carry a .gitkeep so the layout survives in git.
    """
    paths = [f"knowledge/{sub}/.gitkeep" for sub in _KNOWLEDGE_SUBDIRS]
    paths.append(_KNOWLEDGE_CONFIG_FILE)
    return paths


def create_knowledge_skeleton(project_path: Path) -> list[str]:
    """Create any missing parts of the knowledge/ skeleton. Idempotent.

    Returns the relative paths actually created (empty if already complete).
    Existing files are never overwritten.
    """
    created: list[str] = []
    for rel in _knowledge_skeleton_targets():
        dest = project_path / rel
        if dest.exists():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if rel == _KNOWLEDGE_CONFIG_FILE:
            dest.write_text(f"schema_version: {_KNOWLEDGE_SCHEMA_VERSION}\n")
        else:
            dest.write_text("")  # .gitkeep
        created.append(rel)
    return created


def plan_upgrade(
    project_path: Path,
    target_version: int | None = None,
) -> UpgradeResult:
    """Compute what an upgrade would do, without touching disk.

    Raises UpgradeError if the upgrade is invalid (e.g. downgrade, unsupported version).
    Returns an UpgradeResult with empty lists if already at target (no-op).
    """
    current = get_schema_version(project_path)
    target = target_version if target_version is not None else _LATEST_SCHEMA_VERSION

    if target not in _SUPPORTED_SCHEMA_VERSIONS:
        raise UpgradeError(f"Unsupported target schema_version {target}")
    if target < current:
        raise UpgradeError(
            f"Cannot downgrade from schema_version {current} to {target}"
        )
    if target == current:
        return UpgradeResult(
            from_version=current,
            to_version=target,
            files_created=[],
            files_deleted=[],
            files_modified=[],
        )

    files_created: list[str] = []
    files_deleted: list[str] = []

    # Apply steps sequentially
    for version in range(current, target):
        if version == 1:
            created, deleted = _plan_v1_to_v2(project_path)
            files_created.extend(created)
            files_deleted.extend(deleted)
        elif version == 4:
            created, deleted = _plan_v4_to_v5(project_path)
            files_created.extend(created)
            files_deleted.extend(deleted)
        # v2→v3 (dialect) and v3→v4 (composite primary_key): no file layout
        # changes needed — only wren_project.yml is restamped.

    return UpgradeResult(
        from_version=current,
        to_version=target,
        files_created=files_created,
        files_deleted=files_deleted,
        files_modified=[PROJECT_FILE],
    )


def _plan_v1_to_v2(project_path: Path) -> tuple[list[str], list[str]]:
    """Plan the v1→v2 file restructuring. Returns (files_created, files_deleted)."""
    created: list[str] = []
    deleted: list[str] = []

    # Models: flat files → directories
    models = _load_models_v1(project_path)
    for model in models:
        source_dir = model.pop("_source_dir", None)
        name = model.get("name", source_dir or "unknown")
        dir_path = f"models/{name}"

        ref_sql = model.get("ref_sql")
        if ref_sql:
            created.append(f"{dir_path}/ref_sql.sql")

        created.append(f"{dir_path}/metadata.yml")

        if source_dir:
            deleted.append(f"models/{source_dir}.yml")

    # Views: single file → directories
    views = _load_views_v1(project_path)
    for view in views:
        name = view.get("name")
        if not name:
            continue
        dir_path = f"views/{name}"

        statement = view.get("statement")
        if statement and "\n" in statement.strip():
            created.append(f"{dir_path}/sql.yml")

        created.append(f"{dir_path}/metadata.yml")

    views_file = project_path / "views.yml"
    if views_file.exists():
        deleted.append("views.yml")

    # Cubes: flat files → directories
    seen_cube_targets: set[str] = set()
    cubes = _load_cubes_v1(project_path)
    for cube in cubes:
        source_file = cube.pop("_source_file", None)
        _, target = _cube_migration_target(cube, source_file)
        if target in seen_cube_targets:
            raise UpgradeError(
                f"Cannot upgrade: multiple legacy cube files map to '{target}'"
            )
        seen_cube_targets.add(target)

        created.append(target)

        if source_file:
            deleted.append(f"cubes/{source_file}")

    return created, deleted


def _plan_v4_to_v5(project_path: Path) -> tuple[list[str], list[str]]:
    """Plan v4→v5: create the knowledge/ skeleton if absent.

    First file-creating step since v1→v2. Idempotent — lists only the
    skeleton paths that don't already exist.
    """
    created = [
        rel
        for rel in _knowledge_skeleton_targets()
        if not (project_path / rel).exists()
    ]
    return created, []


def apply_upgrade(project_path: Path, result: UpgradeResult) -> None:
    """Write upgrade changes to disk, replaying each version step in order."""
    for version in range(result.from_version, result.to_version):
        if version == 1:
            _apply_v1_to_v2(project_path)
        elif version == 4:
            _apply_v4_to_v5(project_path)
        # v2→v3, v3→v4: only the wren_project.yml stamp changes (handled below)

    # Update wren_project.yml
    config = load_project_config(project_path)
    config["schema_version"] = result.to_version
    config_file = project_path / PROJECT_FILE
    config_file.write_text(
        yaml.dump(config, default_flow_style=False, sort_keys=False, allow_unicode=True)
    )


def _apply_v1_to_v2(project_path: Path) -> None:
    """Execute the v1→v2 restructuring: write new files, delete old ones."""
    # Write new model directories
    models = _load_models_v1(project_path)
    for model in models:
        source_dir = model.pop("_source_dir", None)
        name = model.get("name", source_dir or "unknown")
        model_dir = project_path / "models" / name
        model_dir.mkdir(parents=True, exist_ok=True)

        ref_sql = model.pop("ref_sql", None)
        if ref_sql:
            (model_dir / "ref_sql.sql").write_text(ref_sql.strip() + "\n")

        (model_dir / "metadata.yml").write_text(
            yaml.dump(
                model, default_flow_style=False, sort_keys=False, allow_unicode=True
            )
        )

        # Delete old flat file
        if source_dir:
            old_file = project_path / "models" / f"{source_dir}.yml"
            if old_file.exists():
                old_file.unlink()

    # Write new view directories
    views = _load_views_v1(project_path)
    for view in views:
        name = view.get("name")
        if not name:
            continue
        view_dir = project_path / "views" / name
        view_dir.mkdir(parents=True, exist_ok=True)

        statement = view.pop("statement", None)
        if statement and "\n" in statement.strip():
            (view_dir / "sql.yml").write_text(
                yaml.dump(
                    {"statement": statement},
                    default_flow_style=False,
                    sort_keys=False,
                    allow_unicode=True,
                )
            )
        elif statement:
            view["statement"] = statement

        (view_dir / "metadata.yml").write_text(
            yaml.dump(
                view, default_flow_style=False, sort_keys=False, allow_unicode=True
            )
        )

    # Delete old views.yml
    views_file = project_path / "views.yml"
    if views_file.exists():
        views_file.unlink()

    # Write new cube directories
    seen_cube_targets: set[str] = set()
    cubes = _load_cubes_v1(project_path)
    for cube in cubes:
        source_file = cube.pop("_source_file", None)
        name, target = _cube_migration_target(cube, source_file)
        if target in seen_cube_targets:
            raise UpgradeError(
                f"Cannot upgrade: multiple legacy cube files map to '{target}'"
            )
        seen_cube_targets.add(target)

        cube_dir = project_path / "cubes" / name
        cube_dir.mkdir(parents=True, exist_ok=True)

        (cube_dir / "metadata.yml").write_text(
            yaml.dump(cube, default_flow_style=False, sort_keys=False)
        )

        if source_file:
            old_file = project_path / "cubes" / source_file
            if old_file.exists():
                old_file.unlink()


def _apply_v4_to_v5(project_path: Path) -> None:
    """Execute v4→v5: create the knowledge/ skeleton (idempotent)."""
    create_knowledge_skeleton(project_path)


# ── Semantic validation (view dry-plan + description completeness) ─────────

_VALID_LEVELS = frozenset({"error", "warning", "strict"})


def _prop_description(item: dict) -> str | None:
    return (item.get("properties") or {}).get("description")


def _check_descriptions(manifest: dict, *, strict: bool = False) -> list[str]:
    warnings: list[str] = []

    for model in manifest.get("models", []):
        name = model.get("name", "<unknown>")
        if not _prop_description(model):
            warnings.append(
                f"Model '{name}' has no description — "
                "add properties.description to improve memory search and agent comprehension"
            )
        if strict:
            for col in model.get("columns", []):
                col_name = col.get("name", "<unknown>")
                if not _prop_description(col):
                    warnings.append(
                        f"Column '{col_name}' in model '{name}' has no description"
                    )

    for view in manifest.get("views", []):
        view_name = view.get("name", "<unknown>")
        if not _prop_description(view):
            warnings.append(
                f"View '{view_name}' has no description — "
                "views with descriptions are indexed as NL-SQL examples in memory"
            )

    return warnings


def validate_manifest(
    manifest_str: str,
    data_source: str,
    *,
    level: str = "warning",
) -> dict:
    """Semantic validation of a compiled MDL manifest (base64-encoded JSON).

    Args:
        manifest_str: Base64-encoded MDL JSON.
        data_source: Target data source (used for view dry-plan dialect).
        level: Validation level.
            "error"   — view SQL dry-plan only (CI/CD)
            "warning" — + model/view missing description (default)
            "strict"  — + column missing description

    Returns:
        Dict with "errors" (list) and "warnings" (list).
    """
    import base64 as _base64  # noqa: PLC0415

    from wren.engine import WrenEngine  # noqa: PLC0415
    from wren.model.data_source import DataSource  # noqa: PLC0415

    errors: list[str] = []
    warnings: list[str] = []

    if level not in _VALID_LEVELS:
        errors.append(
            f"Invalid level '{level}' — must be one of: {', '.join(sorted(_VALID_LEVELS))}"
        )
        return {"errors": errors, "warnings": warnings}

    try:
        manifest = json.loads(_base64.b64decode(manifest_str))
    except Exception as e:
        errors.append(f"Failed to decode manifest: {e}")
        return {"errors": errors, "warnings": warnings}

    # View SQL dry-plan — always checked (failures are errors)
    views = manifest.get("views", [])
    if views:
        if isinstance(data_source, str):
            try:
                data_source = DataSource(data_source)
            except ValueError:
                errors.append(f"Invalid datasource '{data_source}'")
                return {"errors": errors, "warnings": warnings}
        with WrenEngine(
            manifest_str=manifest_str, data_source=data_source, connection_info={}
        ) as engine:
            for view in views:
                name = view.get("name", "<unknown>")
                stmt = (view.get("statement") or "").strip()
                if not stmt:
                    errors.append(f"View '{name}': empty statement")
                    continue
                try:
                    engine.dry_plan(stmt)
                except Exception as e:
                    errors.append(f"View '{name}': dry-plan failed — {e}")

    # Description checks — only at warning/strict level
    if level in ("warning", "strict"):
        warnings.extend(_check_descriptions(manifest, strict=(level == "strict")))

    return {"errors": errors, "warnings": warnings}
