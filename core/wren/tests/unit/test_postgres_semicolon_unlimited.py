"""Postgres unlimited query strips trailing semicolon.

``postgres`` imports ``psycopg`` at module load. Unit CI does not install the
``postgres`` extra, so stub ``psycopg`` in ``sys.modules`` before importing the
connector module (same pattern as canner unit tests for lazy import).
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pyarrow as pa
import pytest

pytestmark = pytest.mark.unit


def _ensure_psycopg_stub() -> None:
    if "psycopg" in sys.modules:
        return
    mod = types.ModuleType("psycopg")
    errors = types.ModuleType("psycopg.errors")
    sys.modules["psycopg"] = mod
    sys.modules["psycopg.errors"] = errors
    mod.errors = errors


_ensure_psycopg_stub()

import wren.connector.postgres as postgres_mod  # noqa: E402
from wren.connector.postgres import PostgresConnector  # noqa: E402


def test_unlimited_query_strips_trailing_semicolon(monkeypatch):
    connector = PostgresConnector.__new__(PostgresConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor
    monkeypatch.setattr(
        postgres_mod, "_build_pg_arrow_table", lambda cur: pa.table({"x": [1]})
    )

    connector.query("SELECT 1 AS x; \n")

    cursor.execute.assert_called_once_with("SELECT 1 AS x")


def test_limited_query_wraps_after_strip(monkeypatch):
    connector = PostgresConnector.__new__(PostgresConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor
    monkeypatch.setattr(
        postgres_mod, "_build_pg_arrow_table", lambda cur: pa.table({"x": [1]})
    )

    connector.query("SELECT 1 AS x;", limit=9)

    cursor.execute.assert_called_once_with(
        "SELECT * FROM (SELECT 1 AS x) AS _sub LIMIT 9"
    )
