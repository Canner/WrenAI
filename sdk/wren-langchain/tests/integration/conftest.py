"""Integration test fixtures: real DuckDB-backed Wren project."""

from __future__ import annotations

import json

import duckdb
import pytest


@pytest.fixture
def duckdb_project(tmp_path, monkeypatch):
    """Build a real Wren project backed by an attached DuckDB file with sample data.

    Layout:
      tmp_path/
        wren_project.yml
        target/mdl.json
        db/sample.duckdb     (one table: customers)
    """
    db_dir = tmp_path / "db"
    db_dir.mkdir()
    db_path = db_dir / "sample.duckdb"

    con = duckdb.connect(str(db_path))
    con.execute("CREATE TABLE customers(id INTEGER, name VARCHAR);")
    con.execute("INSERT INTO customers VALUES (1, 'Acme'), (2, 'Globex');")
    con.close()

    manifest = {
        "catalog": "wren",
        "schema": "public",
        "models": [
            {
                "name": "customers",
                "tableReference": {
                    "catalog": "sample",
                    "schema": "main",
                    "table": "customers",
                },
                "columns": [
                    {"name": "id", "type": "integer"},
                    {"name": "name", "type": "varchar"},
                ],
                "primaryKey": "id",
                "properties": {"description": "Customer master data"},
            }
        ],
    }

    (tmp_path / "wren_project.yml").write_text("schema_version: 1\n")
    target = tmp_path / "target"
    target.mkdir()
    (target / "mdl.json").write_text(json.dumps(manifest))

    monkeypatch.setattr(
        "wren_langchain._providers.connection.list_profiles",
        lambda: {
            "test": {
                "datasource": "duckdb",
                "url": str(db_dir),
                "format": "duckdb",
            }
        },
    )
    monkeypatch.setattr(
        "wren_langchain._providers.connection.get_active_profile",
        lambda: (
            "test",
            {
                "datasource": "duckdb",
                "url": str(db_dir),
                "format": "duckdb",
            },
        ),
    )

    return tmp_path
