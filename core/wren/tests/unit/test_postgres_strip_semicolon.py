"""Unit tests for trailing-semicolon stripping in the Postgres connector.

PostgresConnector.query/dry_run wrap user SQL as
``SELECT * FROM ({sql}) AS _sub LIMIT N``. A trailing ``;`` in the user SQL
made the subquery invalid (``syntax error at or near ";"``). The canner,
trino, and clickhouse connectors already strip it; postgres did not. These
tests use a mocked connection (no live database) and assert on the SQL the
connector actually executes.
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest

from wren.connector.postgres import PostgresConnector, _strip_trailing_semicolon

pytestmark = pytest.mark.unit


def _make_connector() -> tuple[PostgresConnector, MagicMock]:
    """Build a PostgresConnector bypassing __init__ (no real connection)."""
    connector = PostgresConnector.__new__(PostgresConnector)
    connector._closed = False
    cursor = MagicMock()
    cursor.description = None  # _build_pg_arrow_table returns an empty table

    @contextmanager
    def _cursor_cm():
        yield cursor

    conn = MagicMock()
    conn.cursor.side_effect = _cursor_cm
    connector.connection = conn
    return connector, cursor


def test_query_strips_trailing_semicolon_before_subquery_wrap() -> None:
    connector, cursor = _make_connector()
    connector.query("SELECT 1;", limit=5)
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _sub LIMIT 5"
    assert ";)" not in sent


def test_dry_run_strips_trailing_semicolon() -> None:
    connector, cursor = _make_connector()
    connector.dry_run("SELECT 1;  ")
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _sub LIMIT 0"


def test_helper_preserves_semicolon_inside_string_literal() -> None:
    sql = "SELECT 'a;b' AS x"
    assert _strip_trailing_semicolon(sql) == sql


def test_helper_no_trailing_semicolon_unchanged() -> None:
    assert _strip_trailing_semicolon("SELECT 1") == "SELECT 1"
