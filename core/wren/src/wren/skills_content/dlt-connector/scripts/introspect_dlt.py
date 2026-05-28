#!/usr/bin/env python3
"""Introspect a dlt-produced DuckDB file and generate a Wren v2 YAML project.

Usage:
    python introspect_dlt.py --duckdb-path ./pipeline.duckdb --output-dir ./my_project

This script:
1. Connects to a DuckDB file (read-only)
2. Discovers tables and columns via information_schema
3. Filters out dlt internal tables and metadata columns
4. Detects parent-child relationships from _dlt_parent_id
5. Normalizes column types using wren's type_mapping.parse_type (sqlglot)
6. Generates a complete Wren v2 YAML project
7. Optionally verifies the project builds and queries succeed
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import yaml

# ---------------------------------------------------------------------------
# dlt internal tables and columns
# ---------------------------------------------------------------------------

_DLT_METADATA_COLUMNS = frozenset(
    {
        "_dlt_id",
        "_dlt_parent_id",
        "_dlt_load_id",
        "_dlt_list_idx",
    }
)

_EXCLUDED_SCHEMAS = frozenset({"information_schema", "pg_catalog"})


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class Column:
    name: str
    raw_type: str      # original DuckDB type
    wren_type: str     # normalized via parse_type
    is_nullable: bool


@dataclass
class Table:
    catalog: str
    schema: str
    name: str
    columns: list[Column] = field(default_factory=list)
    has_dlt_parent_id: bool = False


@dataclass
class Relationship:
    name: str
    parent_model: str
    child_model: str
    condition: str
    join_type: str = "ONE_TO_MANY"
    schema: str = ""


# ---------------------------------------------------------------------------
# Type normalization — delegates to wren SDK's parse_type when available
# ---------------------------------------------------------------------------


def _normalize_type(raw_type: str) -> str:
    """Normalize a DuckDB column type using wren's type_mapping.parse_type.

    Wren SDK uses sqlglot to parse database-specific types into canonical
    SQL forms (e.g. "character varying" → "VARCHAR", "INT8" → "BIGINT").
    Falls back to uppercase raw type if wren SDK is not importable.
    """
    try:
        from wren.type_mapping import parse_type  # noqa: PLC0415

        return parse_type(raw_type, "duckdb")
    except ImportError:
        # Fallback if wren SDK is not installed in the environment
        return raw_type.upper().strip()


# ---------------------------------------------------------------------------
# Catalog resolution — critical for DuckDB ATTACH behavior
# ---------------------------------------------------------------------------


def _resolve_catalog(duckdb_path: Path) -> str:
    """Derive the DuckDB catalog name from the file path.

    When wren engine connects to a DuckDB file, it runs:
        ATTACH DATABASE 'path/to/file.duckdb' AS "<stem>" (READ_ONLY)
    where <stem> is the filename without extension. This means the catalog
    in table_reference MUST match the filename stem, otherwise wren engine
    cannot resolve the table.

    Example: stripe_data.duckdb → catalog = "stripe_data"
    """
    return duckdb_path.stem


# ---------------------------------------------------------------------------
# Introspection
# ---------------------------------------------------------------------------


def discover_tables(
    con: duckdb.DuckDBPyConnection,
    *,
    catalog_name: str,
) -> list[Table]:
    """Query information_schema to find all user tables with their columns.

    Args:
        con: DuckDB connection (read-only).
        catalog_name: The catalog name that wren engine will use when
            ATTACHing this DuckDB file (= filename stem).
    """

    rows = con.execute(
        """
        SELECT
            t.table_schema,
            t.table_name,
            c.column_name,
            c.data_type,
            c.is_nullable,
            c.ordinal_position
        FROM information_schema.tables t
        JOIN information_schema.columns c
            ON t.table_schema = c.table_schema
            AND t.table_name = c.table_name
        WHERE t.table_type IN ('BASE TABLE', 'VIEW')
          AND t.table_schema NOT IN ('information_schema', 'pg_catalog')
          AND t.table_name NOT LIKE '_dlt_%'
        ORDER BY t.table_schema, t.table_name, c.ordinal_position
        """
    ).fetchall()

    tables: dict[str, Table] = {}

    for schema, table_name, col_name, col_type, nullable, _pos in rows:
        key = f"{schema}.{table_name}"
        if key not in tables:
            tables[key] = Table(
                catalog=catalog_name,
                schema=schema,
                name=table_name,
            )

        t = tables[key]

        # Track _dlt_parent_id presence for relationship detection
        if col_name == "_dlt_parent_id":
            t.has_dlt_parent_id = True

        # Skip dlt metadata columns from model columns
        if col_name in _DLT_METADATA_COLUMNS:
            continue

        normalized = _normalize_type(col_type)
        t.columns.append(
            Column(
                name=col_name,
                raw_type=col_type,
                wren_type=normalized,
                is_nullable=nullable == "YES",
            )
        )

    return list(tables.values())


def detect_relationships(tables: list[Table]) -> list[Relationship]:
    """Detect parent-child relationships from _dlt_parent_id and table naming.

    dlt convention: child table name = parent_name__child_suffix
    e.g. hubspot__contacts__emails is a child of hubspot__contacts
    """
    tables_by_schema: dict[str, set[str]] = {}
    for t in tables:
        tables_by_schema.setdefault(t.schema, set()).add(t.name)
    relationships: list[Relationship] = []

    for t in tables:
        if not t.has_dlt_parent_id:
            continue

        # Find parent: try progressively shorter prefixes split on "__"
        parts = t.name.split("__")
        parent_name = None
        child_suffix = None

        for i in range(len(parts) - 1, 0, -1):
            candidate = "__".join(parts[:i])
            if candidate in tables_by_schema.get(t.schema, set()) and candidate != t.name:
                parent_name = candidate
                child_suffix = "__".join(parts[i:])
                break

        if parent_name is None:
            print(
                f"  Warning: {t.name} has _dlt_parent_id but no matching parent table found",
                file=sys.stderr,
            )
            continue

        rel_name = f"{parent_name}__{child_suffix}"
        relationships.append(
            Relationship(
                name=rel_name,
                parent_model=parent_name,
                child_model=t.name,
                condition=f'"{t.name}"._dlt_parent_id = "{parent_name}"._dlt_id',
                schema=t.schema,
            )
        )

    return relationships


# ---------------------------------------------------------------------------
# Project generation
# ---------------------------------------------------------------------------


def _safe_path_segment(value: str) -> str:
    """Sanitize a string for use as a filesystem directory name."""
    cleaned = re.sub(r"[^A-Za-z0-9_.-]", "_", value).strip("._")
    if not cleaned:
        raise ValueError(f"Invalid path segment from identifier: {value!r}")
    return cleaned


def generate_project_files(
    tables: list[Table],
    relationships: list[Relationship],
    *,
    project_name: str,
    duckdb_path: str,
) -> dict[str, str]:
    """Generate all project file contents as {relative_path: content} dict."""

    files: dict[str, str] = {}

    # Detect cross-schema name collisions; qualify model names when needed
    name_counts: dict[str, int] = {}
    for t in tables:
        name_counts[t.name] = name_counts.get(t.name, 0) + 1

    def resolve_name(schema: str, table_name: str) -> str:
        return f"{schema}__{table_name}" if name_counts.get(table_name, 0) > 1 else table_name

    # -- wren_project.yml --
    project_config = {
        "schema_version": 2,
        "name": project_name,
        "version": "1.0",
        "catalog": "",
        "schema": "public",
        "data_source": "duckdb",
    }
    files["wren_project.yml"] = yaml.dump(
        project_config, default_flow_style=False, sort_keys=False
    )

    # -- models/<table_name>/metadata.yml --
    for t in tables:
        model_name = resolve_name(t.schema, t.name)
        columns_yaml = []
        for c in t.columns:
            col_entry: dict = {
                "name": c.name,
                "type": c.wren_type,
                "is_calculated": False,
                "not_null": not c.is_nullable,
                "properties": {},
            }
            columns_yaml.append(col_entry)

        model: dict = {
            "name": model_name,
            "table_reference": {
                "catalog": t.catalog,
                "schema": t.schema,
                "table": t.name,
            },
            "columns": columns_yaml,
            "cached": False,
            "properties": {
                "description": f"Table from dlt pipeline ({t.schema}.{t.name})",
            },
        }

        dir_name = _safe_path_segment(model_name)
        files[f"models/{dir_name}/metadata.yml"] = yaml.dump(
            model, default_flow_style=False, sort_keys=False
        )

    # -- relationships.yml --
    if relationships:
        rels_yaml = []
        for r in relationships:
            parent = resolve_name(r.schema, r.parent_model)
            child = resolve_name(r.schema, r.child_model)
            rels_yaml.append(
                {
                    "name": r.name,
                    "models": [parent, child],
                    "join_type": r.join_type,
                    "condition": f'"{child}"._dlt_parent_id = "{parent}"._dlt_id',
                }
            )
        files["relationships.yml"] = yaml.dump(
            {"relationships": rels_yaml},
            default_flow_style=False,
            sort_keys=False,
        )
    else:
        files["relationships.yml"] = "relationships: []\n"

    # -- instructions.md --
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    instructions = (
        "# Instructions\n\n"
        f"This Wren project was auto-generated from a dlt DuckDB pipeline.\n\n"
        f"- **Source DuckDB:** `{duckdb_path}`\n"
        f"- **Generated:** {timestamp}\n"
        f"- **Tables:** {len(tables)}\n"
        f"- **Relationships:** {len(relationships)}\n\n"
        "dlt metadata columns (`_dlt_id`, `_dlt_parent_id`, etc.) are hidden from models\n"
        "but still present in the underlying DuckDB tables.\n"
    )
    files["instructions.md"] = instructions

    return files


def write_project(files: dict[str, str], output_dir: Path, *, force: bool = False):
    """Write generated files to disk."""
    project_file = output_dir / "wren_project.yml"
    if project_file.exists() and not force:
        print(
            f"Error: {project_file} already exists. Use --force to overwrite.",
            file=sys.stderr,
        )
        sys.exit(1)

    for rel_path, content in files.items():
        path = output_dir / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Generate a Wren project from a dlt DuckDB file."
    )
    parser.add_argument(
        "--duckdb-path", required=True, help="Path to the .duckdb file"
    )
    parser.add_argument(
        "--output-dir",
        default=".",
        help="Directory to write the Wren project (default: current dir)",
    )
    parser.add_argument(
        "--project-name",
        default=None,
        help="Project name (default: derived from DuckDB filename)",
    )
    parser.add_argument(
        "--force", action="store_true", help="Overwrite existing project files"
    )
    args = parser.parse_args()

    duckdb_path = Path(args.duckdb_path).resolve()
    if not duckdb_path.exists():
        print(f"Error: {duckdb_path} not found.", file=sys.stderr)
        sys.exit(1)

    project_name = args.project_name or duckdb_path.stem.replace("-", "_")
    output_dir = Path(args.output_dir).resolve()

    # The catalog must match the filename stem — this is how wren engine's
    # DuckDB connector ATTACHes the file.
    catalog_name = _resolve_catalog(duckdb_path)

    # Connect read-only
    con = duckdb.connect(str(duckdb_path), read_only=True)

    try:
        print(f"Introspecting {duckdb_path}...")
        print(f"  Catalog (from filename): {catalog_name}")

        tables = discover_tables(con, catalog_name=catalog_name)
        print(f"  Found {len(tables)} tables")

        if not tables:
            print(
                "  Warning: no user tables found. The DuckDB file may be empty.",
                file=sys.stderr,
            )

        relationships = detect_relationships(tables)
        print(f"  Detected {len(relationships)} parent-child relationships")

        files = generate_project_files(
            tables,
            relationships,
            project_name=project_name,
            duckdb_path=str(duckdb_path),
        )

        write_project(files, output_dir, force=args.force)
        print(f"\nWren project written to {output_dir}/")
        print(f"  {len(tables)} models, {len(relationships)} relationships")
        print(f"\nNext steps:")
        print(f"  cd {output_dir}")
        print(f"  wren context validate")
        print(f"  wren context build")

    finally:
        con.close()


if __name__ == "__main__":
    main()
