"""Trailing-semicolon stripping for the Athena connector (mocked, no live DB).

``AthenaConnector.dry_run`` runs ``EXPLAIN {sql}``. Athena's engine is
Trino-flavoured and rejects a trailing semicolon there
(``EXPLAIN SELECT 1;`` -> syntax error). These tests use a mocked cursor and
assert on the executed SQL, so no AWS connection is required.
"""

from unittest.mock import MagicMock

from wren.connector.athena import AthenaConnector, _strip_trailing_semicolon


def _make_mock_connector() -> tuple[AthenaConnector, MagicMock]:
    """Build an AthenaConnector bypassing __init__ (no real connection)."""
    connector = AthenaConnector.__new__(AthenaConnector)
    cursor = MagicMock()
    conn = MagicMock()
    conn.cursor.return_value = cursor
    connector.connection = conn
    return connector, cursor


def test_dry_run_strips_trailing_semicolon_before_explain() -> None:
    connector, cursor = _make_mock_connector()
    connector.dry_run("SELECT 1;")
    (sent,), _ = cursor.execute.call_args
    assert sent == "EXPLAIN SELECT 1"
    assert not sent.endswith(";")


def test_dry_run_strips_trailing_semicolon_and_whitespace() -> None:
    connector, cursor = _make_mock_connector()
    connector.dry_run("SELECT 1;  \n")
    (sent,), _ = cursor.execute.call_args
    assert sent == "EXPLAIN SELECT 1"


def test_helper_preserves_semicolon_inside_string_literal() -> None:
    sql = "SELECT 'a;b' AS x"
    assert _strip_trailing_semicolon(sql) == sql


def test_helper_no_trailing_semicolon_unchanged() -> None:
    assert _strip_trailing_semicolon("SELECT 1") == "SELECT 1"
