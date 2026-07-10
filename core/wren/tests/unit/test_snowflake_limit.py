"""Snowflake LIMIT pushdown + trailing-semicolon strip (mocked cursor)."""

from unittest.mock import MagicMock

import pyarrow as pa

from wren.connector.snowflake import (
    SnowflakeConnector,
    _apply_limit,
    _strip_trailing_semicolon,
)


def _make_mock_connector() -> tuple[SnowflakeConnector, MagicMock]:
    connector = SnowflakeConnector.__new__(SnowflakeConnector)
    cursor = MagicMock()
    cursor.fetch_arrow_all.return_value = pa.table({"x": [1, 2, 3]})
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    connector.connection = conn
    return connector, cursor


def test_query_pushes_limit_and_strips_semicolon() -> None:
    connector, cursor = _make_mock_connector()
    connector.query("SELECT 1;", limit=2)
    cursor.execute.assert_called_once_with("SELECT 1\nLIMIT 2")


def test_query_without_limit_passes_sql_through() -> None:
    connector, cursor = _make_mock_connector()
    connector.query("SELECT 1")
    cursor.execute.assert_called_once_with("SELECT 1")


def test_dry_run_strips_trailing_semicolon() -> None:
    connector, cursor = _make_mock_connector()
    connector.dry_run("SELECT 1;  \n")
    cursor.describe.assert_called_once_with("SELECT 1")


def test_helpers() -> None:
    assert _strip_trailing_semicolon("SELECT ';' AS x") == "SELECT ';' AS x"
    assert _apply_limit("SELECT 1;", 5) == "SELECT 1\nLIMIT 5"
