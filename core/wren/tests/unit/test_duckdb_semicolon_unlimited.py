"""DuckDB unlimited query strips trailing semicolon like limit wrap."""

from __future__ import annotations

from unittest.mock import MagicMock

import pyarrow as pa
import pytest

from wren.connector.duckdb import DuckDBConnector

pytestmark = pytest.mark.unit


def test_unlimited_query_strips_trailing_semicolon():
    connector = DuckDBConnector.__new__(DuckDBConnector)
    connector.connection = MagicMock()
    connector.connection.execute.return_value.fetch_arrow_table.return_value = (
        pa.table({"x": [1]})
    )

    connector.query("SELECT 1 AS x;  ")

    connector.connection.execute.assert_called_once_with("SELECT 1 AS x")


def test_limited_query_still_wraps_after_strip():
    connector = DuckDBConnector.__new__(DuckDBConnector)
    connector.connection = MagicMock()
    connector.connection.execute.return_value.fetch_arrow_table.return_value = (
        pa.table({"x": [1]})
    )

    connector.query("SELECT 1 AS x;", limit=2)

    connector.connection.execute.assert_called_once_with(
        "SELECT * FROM (SELECT 1 AS x) AS _q LIMIT 2"
    )
