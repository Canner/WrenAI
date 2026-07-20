"""Snowflake connector pushes LIMIT into SQL instead of Python slicing."""

from __future__ import annotations

from unittest.mock import MagicMock

import pyarrow as pa
import pytest

from wren.connector.base import strip_trailing_semicolon as _strip_trailing_semicolon
from wren.connector.snowflake import SnowflakeConnector

pytestmark = pytest.mark.unit


def test_strip_trailing_semicolon_preserves_interior():
    assert _strip_trailing_semicolon("SELECT 'a;b' FROM t;  ") == "SELECT 'a;b' FROM t"


def test_query_pushes_limit_into_sql_and_strips_semicolon():
    connector = SnowflakeConnector.__new__(SnowflakeConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor
    cursor.fetch_arrow_all.return_value = pa.table({"x": [1, 2]})

    table = connector.query("SELECT 1 AS x;", limit=5)

    cursor.execute.assert_called_once_with(
        "SELECT * FROM (\nSELECT 1 AS x\n) AS _wren_sub LIMIT 5"
    )
    assert table.num_rows == 2


def test_query_limit_survives_trailing_line_comment():
    # A trailing `-- comment` in the user SQL must not swallow the wrapper's
    # closing paren, alias, or LIMIT clause; the newline terminates it.
    connector = SnowflakeConnector.__new__(SnowflakeConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor
    cursor.fetch_arrow_all.return_value = pa.table({"x": [1]})

    connector.query("SELECT 1 AS x  -- pick one", limit=5)

    cursor.execute.assert_called_once_with(
        "SELECT * FROM (\nSELECT 1 AS x  -- pick one\n) AS _wren_sub LIMIT 5"
    )


def test_query_without_limit_runs_original_sql():
    connector = SnowflakeConnector.__new__(SnowflakeConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor
    cursor.fetch_arrow_all.return_value = pa.table({})

    connector.query("SELECT 1")

    cursor.execute.assert_called_once_with("SELECT 1")


def test_dry_run_strips_trailing_semicolon_before_describe():
    connector = SnowflakeConnector.__new__(SnowflakeConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor

    connector.dry_run("SELECT 1 AS x;")

    cursor.describe.assert_called_once_with("SELECT 1 AS x")


def test_dry_run_preserves_interior_semicolon_in_literal():
    connector = SnowflakeConnector.__new__(SnowflakeConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor

    connector.dry_run("SELECT 'a;b' FROM t;  \n")

    cursor.describe.assert_called_once_with("SELECT 'a;b' FROM t")
