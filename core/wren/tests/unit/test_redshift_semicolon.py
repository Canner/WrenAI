"""Trailing-semicolon stripping for the Redshift connector (mocked, no live DB).

The Redshift connector wraps user SQL as ``SELECT * FROM (...) AS _q LIMIT N``.
When the user SQL ends in a semicolon, Redshift rejects ``SELECT 1;`` inside a
subquery (``syntax error at or near ";"``). These tests use a mocked
connection and assert on the SQL the connector executes, so no container is
required. Mirrors the postgres connector's semicolon tests.
"""

from contextlib import closing  # noqa: F401  (kept for parity / import safety)
from unittest.mock import MagicMock

from wren.connector.redshift import RedshiftConnector, _strip_trailing_semicolon


def _make_mock_connector() -> tuple[RedshiftConnector, MagicMock]:
    """Build a RedshiftConnector bypassing __init__ (no real connection)."""
    connector = RedshiftConnector.__new__(RedshiftConnector)
    cursor = MagicMock()
    cursor.description = []
    cursor.fetchall.return_value = []

    conn = MagicMock()
    conn.cursor.return_value = cursor
    connector.connection = conn
    return connector, cursor


def test_query_strips_trailing_semicolon_before_subquery_wrap() -> None:
    connector, cursor = _make_mock_connector()
    connector.query("SELECT 1;", limit=5)
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _q LIMIT 5"
    assert ";)" not in sent


def test_dry_run_strips_trailing_semicolon() -> None:
    connector, cursor = _make_mock_connector()
    connector.dry_run("SELECT 1;  ")
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS sub LIMIT 0"
    assert ";)" not in sent


def test_helper_preserves_semicolon_inside_string_literal() -> None:
    sql = "SELECT 'a;b' AS x"
    assert _strip_trailing_semicolon(sql) == sql


def test_helper_no_trailing_semicolon_unchanged() -> None:
    assert _strip_trailing_semicolon("SELECT 1") == "SELECT 1"


def test_query_without_limit_strips_trailing_semicolon() -> None:
    connector, cursor = _make_mock_connector()
    connector.query("SELECT 1;")
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT 1"
    assert not sent.endswith(";")
