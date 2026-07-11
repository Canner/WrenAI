"""Trailing-semicolon stripping for the Databricks connector (mocked, no live DB).

``DatabricksConnector.dry_run`` wraps user SQL as
``SELECT * FROM ({sql}) AS sub LIMIT 0``. A trailing semicolon (``SELECT 1;``)
becomes a syntax error inside the subquery. These tests use a mocked cursor
and assert on the executed SQL, so no Databricks connection is required.
"""

from unittest.mock import MagicMock

from wren.connector.databricks import DatabricksConnector
from wren.connector.base import strip_trailing_semicolon as _strip_trailing_semicolon


def _make_mock_connector() -> tuple[DatabricksConnector, MagicMock]:
    """Build a DatabricksConnector bypassing __init__ (no real connection)."""
    connector = DatabricksConnector.__new__(DatabricksConnector)
    cursor = MagicMock()
    conn = MagicMock()
    conn.cursor.return_value = cursor
    connector.connection = conn
    return connector, cursor


def test_dry_run_strips_trailing_semicolon_before_subquery_wrap() -> None:
    connector, cursor = _make_mock_connector()
    connector.dry_run("SELECT 1;")
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS sub LIMIT 0"
    assert ";)" not in sent


def test_dry_run_strips_semicolon_and_whitespace() -> None:
    connector, cursor = _make_mock_connector()
    connector.dry_run("SELECT 1;  \n")
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS sub LIMIT 0"


def test_helper_preserves_semicolon_inside_string_literal() -> None:
    sql = "SELECT 'a;b' AS x"
    assert _strip_trailing_semicolon(sql) == sql


def test_helper_no_trailing_semicolon_unchanged() -> None:
    assert _strip_trailing_semicolon("SELECT 1") == "SELECT 1"


def test_query_strips_trailing_semicolon_before_execute() -> None:
    connector, cursor = _make_mock_connector()
    cursor.fetchall_arrow.return_value = None
    cursor.fetchmany_arrow.return_value = None
    # Anything truthy so limit branch not needed
    mconn_cursor = cursor
    # execute should observe stripped SQL - fetchall path when limit None
    try:
        connector.query("SELECT 1;;")
    except Exception:
        # mock may return None from fetchall_arrow — only care about execute SQL
        pass
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT 1"
