"""Import a Wren project from an OpenMetadata catalog.

Reads table entities (columns, descriptions, tags, owners and table
constraints) from the OpenMetadata REST API and turns them into Wren models
plus ``relationships.yml``. Relationships come from FOREIGN_KEY table
constraints only: OpenMetadata lineage describes how data is derived, not how
tables join, so it is deliberately not read here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import yaml

from wren.type_mapping import parse_type

# OpenMetadata server versions this importer was verified against. Other
# versions still run; the CLI prints a warning so drift is visible.
TESTED_SERVER_VERSIONS = ("2.0",)

_TABLE_FIELDS = "columns,tableConstraints,tags,owners"
_PAGE_SIZE = 100

# OpenMetadata names a database "default" for engines without a catalog
# layer (MySQL, MariaDB, Hive, ...); those tables must not be catalog-qualified.
_PLACEHOLDER_DATABASE = "default"

OM_SERVICE_TYPE_TO_WREN_DATASOURCE = {
    "athena": "athena",
    "bigquery": "bigquery",
    "clickhouse": "clickhouse",
    "databricks": "databricks",
    "doris": "doris",
    "duckdb": "duckdb",
    "mariadb": "mysql",
    "mssql": "mssql",
    "mysql": "mysql",
    "oracle": "oracle",
    "postgres": "postgres",
    "redshift": "redshift",
    "snowflake": "snowflake",
    "trino": "trino",
}

_SQLGLOT_DIALECT = {"mssql": "tsql"}


class OpenMetadataError(ValueError):
    """Raised when the OpenMetadata catalog cannot be read or converted."""


class HttpSession(Protocol):
    def get(self, url: str, **kwargs: Any) -> Any: ...


@dataclass(frozen=True)
class OpenMetadataSelection:
    """Which part of the OpenMetadata catalog to import."""

    service: str
    database: str | None = None
    schema: str | None = None
    tables: tuple[str, ...] = ()


@dataclass(frozen=True)
class SkippedRelationship:
    table: str
    columns: tuple[str, ...]
    referred: tuple[str, ...]
    reason: str


@dataclass
class OpenMetadataProjectImport:
    """Project files and summary generated from an OpenMetadata catalog."""

    files: list[Any]
    datasource: str
    server_version: str | None
    model_count: int
    relationship_count: int
    models: list[dict[str, Any]] = field(default_factory=list)
    relationships: list[dict[str, Any]] = field(default_factory=list)
    skipped_relationships: list[SkippedRelationship] = field(default_factory=list)


class OpenMetadataClient:
    """Minimal read-only client for the OpenMetadata REST API."""

    def __init__(
        self,
        host: str,
        token: str,
        *,
        session: HttpSession | None = None,
        timeout: float = 30.0,
    ) -> None:
        if session is None:
            import requests  # noqa: PLC0415

            session = requests.Session()
        self._base = _api_base(host)
        self._headers = {"Authorization": f"Bearer {token}"}
        self._session = session
        self._timeout = timeout

    def server_version(self) -> str | None:
        payload = self._get("/system/version")
        version = payload.get("version")
        return str(version) if version else None

    def get_service(self, name: str) -> dict[str, Any]:
        return self._get(f"/services/databaseServices/name/{_quote_fqn(name)}")

    def list_tables(self, selection: OpenMetadataSelection) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "fields": _TABLE_FIELDS,
            "limit": _PAGE_SIZE,
            "include": "non-deleted",
        }
        if selection.database and selection.schema:
            params["databaseSchema"] = build_fqn(
                selection.service, selection.database, selection.schema
            )
        elif selection.database:
            params["database"] = build_fqn(selection.service, selection.database)
        else:
            params["service"] = selection.service

        tables: list[dict[str, Any]] = []
        while True:
            payload = self._get("/tables", params=params)
            tables.extend(payload.get("data") or [])
            after = (payload.get("paging") or {}).get("after")
            if not after:
                break
            params = {**params, "after": after}
        return tables

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self._base}{path}"
        try:
            response = self._session.get(
                url, headers=self._headers, params=params, timeout=self._timeout
            )
        except Exception as exc:  # noqa: BLE001 — surface any transport failure
            raise OpenMetadataError(
                f"Could not reach OpenMetadata at {self._base}: {exc}"
            ) from exc
        status = getattr(response, "status_code", 200)
        if status in (401, 403):
            raise OpenMetadataError(
                f"OpenMetadata rejected the token (HTTP {status}). Use a bot or "
                "personal access token with read access to the catalog."
            )
        if status == 404:
            raise OpenMetadataError(f"OpenMetadata entity not found: {path}")
        if status >= 400:
            raise OpenMetadataError(
                f"OpenMetadata request failed (HTTP {status}) for {path}: "
                f"{_response_text(response)}"
            )
        try:
            return response.json()
        except ValueError as exc:
            raise OpenMetadataError(
                f"OpenMetadata returned a non-JSON response for {path}."
            ) from exc


def import_openmetadata_project(
    client: OpenMetadataClient,
    selection: OpenMetadataSelection,
    *,
    datasource: str | None = None,
) -> OpenMetadataProjectImport:
    """Fetch the selected catalog slice and convert it to Wren project files."""
    server_version = client.server_version()
    service = client.get_service(selection.service)
    tables = client.list_tables(selection)
    return convert_openmetadata_tables(
        tables,
        selection=selection,
        service_type=str(service.get("serviceType") or ""),
        datasource=datasource,
        server_version=server_version,
    )


def convert_openmetadata_tables(
    tables: list[dict[str, Any]],
    *,
    selection: OpenMetadataSelection,
    service_type: str,
    datasource: str | None = None,
    server_version: str | None = None,
) -> OpenMetadataProjectImport:
    """Convert OpenMetadata table entities into Wren project files."""
    from wren.context import _AGENTS_MD_TEMPLATE, ProjectFile  # noqa: PLC0415

    wren_datasource = datasource or map_service_type_to_wren(service_type)
    dialect = _SQLGLOT_DIALECT.get(wren_datasource, wren_datasource)

    selected = _filter_tables(tables, selection)
    if not selected:
        raise OpenMetadataError(
            "No tables matched the selection "
            f"(service={selection.service!r}, database={selection.database!r}, "
            f"schema={selection.schema!r}, tables={list(selection.tables) or 'all'})."
        )

    models, model_by_table_fqn = _build_models(selected, dialect)
    relationships, skipped = _build_relationships(selected, model_by_table_fqn)

    project_config: dict[str, Any] = {
        "schema_version": 5,
        "name": _project_name(selection),
        "version": "1.0",
        "catalog": "wren",
        "schema": "public",
        "data_source": wren_datasource,
        "openmetadata": _filter_none(
            {
                "service": selection.service,
                "database": selection.database,
                "schema": selection.schema,
                "server_version": server_version,
            }
        ),
    }

    files = [
        ProjectFile(relative_path="wren_project.yml", content=_dump(project_config)),
        ProjectFile(
            relative_path="relationships.yml",
            content=_dump({"relationships": relationships}),
        ),
        ProjectFile(
            relative_path="knowledge/rules/general.md",
            content=_build_base_instructions(selection, server_version),
        ),
        ProjectFile(
            relative_path="knowledge/knowledge.yml", content="schema_version: 1\n"
        ),
        ProjectFile(relative_path="AGENTS.md", content=_AGENTS_MD_TEMPLATE),
    ]
    files.extend(
        ProjectFile(
            relative_path=f"models/{model['name']}/metadata.yml",
            content=_dump(model),
        )
        for model in models
    )

    return OpenMetadataProjectImport(
        files=files,
        datasource=wren_datasource,
        server_version=server_version,
        model_count=len(models),
        relationship_count=len(relationships),
        models=models,
        relationships=relationships,
        skipped_relationships=skipped,
    )


def plan_additive_write(
    imported: OpenMetadataProjectImport, output_dir: Path
) -> tuple[list[Any], list[str]]:
    """Split generated files into ones safe to add and collisions to report.

    A file that already exists is never rewritten, so user edits to model
    descriptions or relationships survive a re-import. Each collision is
    described at the object level (model, relationship, file).
    """
    to_write: list[Any] = []
    collisions: list[str] = []
    for project_file in imported.files:
        target = output_dir / project_file.relative_path
        if not target.exists():
            to_write.append(project_file)
            continue
        parts = Path(project_file.relative_path).parts
        if parts[0] == "models" and len(parts) == 3:
            collisions.append(
                f"model '{parts[1]}' exists ({project_file.relative_path})"
            )
        elif project_file.relative_path == "relationships.yml":
            collisions.extend(_relationship_collisions(imported.relationships, target))
        else:
            collisions.append(f"file '{project_file.relative_path}' exists")
    return to_write, collisions


def _relationship_collisions(
    relationships: list[dict[str, Any]], existing_path: Path
) -> list[str]:
    try:
        existing = yaml.safe_load(existing_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        existing = {}
    by_name = {
        rel.get("name"): rel
        for rel in (existing.get("relationships") or [])
        if isinstance(rel, dict)
    }
    collisions = []
    for rel in relationships:
        current = by_name.get(rel["name"])
        if current is None:
            collisions.append(
                f"relationship '{rel['name']}' not added (relationships.yml exists): "
                f"{rel['condition']}"
            )
        elif (
            current.get("condition") != rel["condition"]
            or current.get("join_type") != rel["join_type"]
        ):
            collisions.append(
                f"relationship '{rel['name']}' differs from OpenMetadata; kept local: "
                f"{current.get('join_type')} {current.get('condition')}"
            )
    return collisions


def map_service_type_to_wren(service_type: str) -> str:
    """Map an OpenMetadata database service type to a Wren datasource."""
    normalized = service_type.strip().lower()
    try:
        return OM_SERVICE_TYPE_TO_WREN_DATASOURCE[normalized]
    except KeyError as exc:
        raise OpenMetadataError(
            f"Unsupported OpenMetadata service type '{service_type}'. "
            "Pass --data-source to choose the Wren datasource explicitly."
        ) from exc


def is_tested_server_version(version: str | None) -> bool:
    if not version:
        return False
    return any(
        version == tested or version.startswith(f"{tested}.")
        for tested in TESTED_SERVER_VERSIONS
    )


def split_fqn(fqn: str) -> list[str]:
    """Split an OpenMetadata fully-qualified name into its parts.

    Parts containing a dot are wrapped in double quotes by OpenMetadata,
    e.g. ``svc.db."my.schema".orders``.
    """
    parts: list[str] = []
    current: list[str] = []
    in_quotes = False
    for char in fqn:
        if char == '"':
            in_quotes = not in_quotes
        elif char == "." and not in_quotes:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    return parts


def build_fqn(*parts: str) -> str:
    return ".".join(f'"{part}"' if "." in part else part for part in parts)


# ── Conversion helpers ────────────────────────────────────────────────────


def _filter_tables(
    tables: list[dict[str, Any]], selection: OpenMetadataSelection
) -> list[dict[str, Any]]:
    wanted = {name.lower() for name in selection.tables}
    selected = []
    for table in tables:
        if table.get("deleted"):
            continue
        parts = split_fqn(str(table.get("fullyQualifiedName") or ""))
        if len(parts) != 4:
            continue
        service, database, schema, name = parts
        if service != selection.service:
            continue
        if selection.database and database != selection.database:
            continue
        if selection.schema and schema != selection.schema:
            continue
        if wanted and name.lower() not in wanted:
            continue
        selected.append(table)
    return sorted(selected, key=lambda t: str(t.get("fullyQualifiedName")))


def _build_models(
    tables: list[dict[str, Any]], dialect: str
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    name_counts: dict[str, int] = {}
    for table in tables:
        name = str(table.get("name"))
        name_counts[name] = name_counts.get(name, 0) + 1

    models: list[dict[str, Any]] = []
    model_by_fqn: dict[str, dict[str, Any]] = {}
    used_names: set[str] = set()
    for table in tables:
        fqn = str(table["fullyQualifiedName"])
        _, database, schema, table_name = split_fqn(fqn)
        name = table_name if name_counts[table_name] == 1 else f"{schema}_{table_name}"
        if name in used_names:
            raise OpenMetadataError(
                f"Duplicate Wren model name '{name}' for OpenMetadata table '{fqn}'. "
                "Narrow the selection with --database / --schema / --table."
            )
        used_names.add(name)

        columns = [
            _build_column(column, dialect) for column in table.get("columns") or []
        ]
        if not columns:
            continue
        model: dict[str, Any] = {
            "name": name,
            "table_reference": {
                "catalog": "" if database == _PLACEHOLDER_DATABASE else database,
                "schema": schema,
                "table": table_name,
            },
            "columns": columns,
        }
        primary_key = _primary_key(table)
        if primary_key:
            model["primary_key"] = (
                primary_key[0] if len(primary_key) == 1 else primary_key
            )
        model["cached"] = False
        model["properties"] = _filter_none(
            {
                "description": _clean_description(table.get("description")),
                "om_fqn": fqn,
                "om_table_type": table.get("tableType"),
                "om_tags": _tag_fqns(table.get("tags")) or None,
                "om_owners": _owner_names(table.get("owners")) or None,
            }
        )
        models.append(model)
        model_by_fqn[fqn] = model
    return models, model_by_fqn


def _build_column(column: dict[str, Any], dialect: str) -> dict[str, Any]:
    constraint = str(column.get("constraint") or "").upper()
    raw_type = column.get("dataTypeDisplay") or column.get("dataType") or "VARCHAR"
    return {
        "name": str(column["name"]),
        "type": parse_type(str(raw_type), dialect),
        "is_calculated": False,
        "not_null": constraint in {"NOT_NULL", "PRIMARY_KEY"},
        "properties": _filter_none(
            {
                "description": _clean_description(column.get("description")),
                "om_fqn": column.get("fullyQualifiedName"),
                "om_tags": _tag_fqns(column.get("tags")) or None,
            }
        ),
    }


def _primary_key(table: dict[str, Any]) -> list[str]:
    for constraint in table.get("tableConstraints") or []:
        if str(constraint.get("constraintType")).upper() == "PRIMARY_KEY":
            return [str(c) for c in constraint.get("columns") or []]
    return [
        str(column["name"])
        for column in table.get("columns") or []
        if str(column.get("constraint") or "").upper() == "PRIMARY_KEY"
    ]


def _build_relationships(
    tables: list[dict[str, Any]], model_by_fqn: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[SkippedRelationship]]:
    relationships: list[dict[str, Any]] = []
    skipped: list[SkippedRelationship] = []
    seen: set[tuple[str, tuple[str, ...], str, tuple[str, ...]]] = set()
    used_names: set[str] = set()

    for table in tables:
        fqn = str(table["fullyQualifiedName"])
        model = model_by_fqn.get(fqn)
        for constraint in table.get("tableConstraints") or []:
            if str(constraint.get("constraintType")).upper() != "FOREIGN_KEY":
                continue
            columns = tuple(str(c) for c in constraint.get("columns") or [])
            referred = tuple(str(c) for c in constraint.get("referredColumns") or [])
            if model is None:
                continue
            if not columns or len(columns) != len(referred):
                skipped.append(
                    SkippedRelationship(
                        fqn, columns, referred, "column count does not match"
                    )
                )
                continue

            referred_tables = {build_fqn(*split_fqn(c)[:-1]) for c in referred}
            if len(referred_tables) != 1:
                skipped.append(
                    SkippedRelationship(
                        fqn, columns, referred, "references more than one table"
                    )
                )
                continue
            target = model_by_fqn.get(referred_tables.pop())
            if target is None:
                skipped.append(
                    SkippedRelationship(
                        fqn, columns, referred, "referenced table is not imported"
                    )
                )
                continue

            target_columns = tuple(split_fqn(c)[-1] for c in referred)
            key = (model["name"], columns, target["name"], target_columns)
            if key in seen:
                continue
            seen.add(key)

            base = f"{model['name']}_to_{target['name']}"
            rel_name, suffix = base, 2
            while rel_name in used_names:
                rel_name = f"{base}_{suffix}"
                suffix += 1
            used_names.add(rel_name)

            relationships.append(
                {
                    "name": rel_name,
                    "models": [model["name"], target["name"]],
                    "join_type": _foreign_key_join_type(table, columns),
                    "condition": " AND ".join(
                        f"{model['name']}.{src} = {target['name']}.{dst}"
                        for src, dst in zip(columns, target_columns, strict=True)
                    ),
                    "properties": {"source": "openmetadata_foreign_key"},
                }
            )

    relationships.sort(key=lambda rel: rel["name"])
    return relationships, skipped


def _foreign_key_join_type(table: dict[str, Any], columns: tuple[str, ...]) -> str:
    """Join type implied by a foreign key.

    A foreign key always references a primary or unique key, so the target
    side is "one"; the source side is "one" only when the foreign-key columns
    are themselves unique. OpenMetadata's own ``relationshipType`` is not used:
    2.0.x reports MANY_TO_MANY for every composite foreign key.
    """
    fk = set(columns)
    unique_keys = [set(_primary_key(table))]
    unique_keys.extend(
        {str(c) for c in constraint.get("columns") or []}
        for constraint in table.get("tableConstraints") or []
        if str(constraint.get("constraintType")).upper() == "UNIQUE"
    )
    unique_keys.extend(
        {str(column["name"])}
        for column in table.get("columns") or []
        if str(column.get("constraint") or "").upper() == "UNIQUE"
    )
    return "ONE_TO_ONE" if fk in unique_keys else "MANY_TO_ONE"


def _build_base_instructions(
    selection: OpenMetadataSelection, server_version: str | None
) -> str:
    scope = ".".join(
        part
        for part in (selection.service, selection.database, selection.schema)
        if part
    )
    lines = [
        "# Imported from OpenMetadata",
        "",
        f"- Source: OpenMetadata catalog `{scope}`"
        + (f" (server {server_version})" if server_version else ""),
        "- Model and column descriptions are the curated OpenMetadata descriptions.",
        "- `properties.om_fqn` records each object's OpenMetadata fully-qualified name.",
        "- Relationships come from foreign-key constraints recorded in OpenMetadata;"
        " lineage is not used to infer joins.",
        "",
    ]
    return "\n".join(lines)


def _project_name(selection: OpenMetadataSelection) -> str:
    parts = [selection.service, selection.database, selection.schema]
    return "_".join(p for p in parts if p).replace(".", "_").replace("-", "_")


def _tag_fqns(tags: Any) -> list[str]:
    return [str(t["tagFQN"]) for t in tags or [] if t.get("tagFQN")]


def _owner_names(owners: Any) -> list[str]:
    if isinstance(owners, dict):
        owners = [owners]
    return [
        str(o.get("name") or o.get("displayName"))
        for o in owners or []
        if o.get("name") or o.get("displayName")
    ]


def _clean_description(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _filter_none(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


def _dump(payload: dict[str, Any]) -> str:
    return yaml.dump(
        payload, default_flow_style=False, sort_keys=False, allow_unicode=True
    )


def _api_base(host: str) -> str:
    base = host.strip().rstrip("/")
    if not base:
        raise OpenMetadataError("OpenMetadata host is empty.")
    if not base.startswith(("http://", "https://")):
        base = f"http://{base}"
    if base.endswith("/api/v1"):
        return base
    if base.endswith("/api"):
        return f"{base}/v1"
    return f"{base}/api/v1"


def _quote_fqn(name: str) -> str:
    from urllib.parse import quote  # noqa: PLC0415

    return quote(name, safe="")


def _response_text(response: Any) -> str:
    text = str(getattr(response, "text", "") or "")
    return text[:300]
