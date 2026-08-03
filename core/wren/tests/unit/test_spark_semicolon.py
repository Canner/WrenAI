"""Trailing-semicolon stripping + LIMIT pushdown for the Spark connector."""

from unittest.mock import MagicMock

import pandas as pd
import pytest

from wren.connector.base import strip_trailing_semicolon
from wren.connector.spark import SparkConnector


def _make_mock_connector() -> tuple[SparkConnector, MagicMock]:
    connector = SparkConnector.__new__(SparkConnector)
    session = MagicMock()
    connector.connection = session
    connector._closed = False
    return connector, session


def test_query_strips_trailing_semicolon_before_sql() -> None:
    connector, session = _make_mock_connector()
    session.sql.return_value.toPandas.return_value = pd.DataFrame({"x": [1, 2, 3]})
    connector.query("SELECT 1;")
    session.sql.assert_called_once_with("SELECT 1")


def test_query_pushes_limit_into_sql_after_strip() -> None:
    connector, session = _make_mock_connector()
    session.sql.return_value.toPandas.return_value = pd.DataFrame({"x": [1, 2]})
    connector.query("SELECT 1 AS x;", limit=2)
    session.sql.assert_called_once_with(
        "SELECT * FROM (\nSELECT 1 AS x\n) AS _q LIMIT 2"
    )


def test_query_trailing_line_comment_does_not_swallow_wrap() -> None:
    connector, session = _make_mock_connector()
    session.sql.return_value.toPandas.return_value = pd.DataFrame({"x": [1]})
    connector.query("SELECT 1 -- note", limit=10)
    session.sql.assert_called_once_with(
        "SELECT * FROM (\nSELECT 1 -- note\n) AS _q LIMIT 10"
    )


def test_query_limit_zero_pushes_limit_zero() -> None:
    connector, session = _make_mock_connector()
    session.sql.return_value.toPandas.return_value = pd.DataFrame({"x": []})
    connector.query("SELECT 1 AS x", limit=0)
    session.sql.assert_called_once_with(
        "SELECT * FROM (\nSELECT 1 AS x\n) AS _q LIMIT 0"
    )


def test_query_negative_limit_raises() -> None:
    connector, _session = _make_mock_connector()
    with pytest.raises(ValueError, match="non-negative"):
        connector.query("SELECT 1", limit=-1)


def test_query_show_tables_with_limit_uses_dataframe_slice() -> None:
    """Non-subqueryable statements keep DataFrame path (MCP always passes limit)."""
    connector, session = _make_mock_connector()
    frame = session.sql.return_value
    frame.limit.return_value.toPandas.return_value = pd.DataFrame({"tableName": ["t"]})
    connector.query("SHOW TABLES", limit=500)
    session.sql.assert_called_once_with("SHOW TABLES")
    frame.limit.assert_called_once_with(500)


def test_dry_run_validates_via_dataframe_after_strip() -> None:
    connector, session = _make_mock_connector()
    connector.dry_run("SELECT 1;  \n")
    # Validation stays on the DataFrame API so non-subquery statements
    # (SHOW TABLES, DESCRIBE, ...) remain valid; only the trailing ; is stripped.
    session.sql.assert_called_once_with("SELECT 1")
    session.sql.return_value.limit.assert_called_once_with(0)
    session.sql.return_value.limit.return_value.count.assert_called_once_with()


def test_helper_preserves_semicolon_inside_string_literal() -> None:
    sql = "SELECT 'a;b' AS x"
    assert strip_trailing_semicolon(sql) == sql


def test_helper_no_trailing_semicolon_unchanged() -> None:
    assert strip_trailing_semicolon("SELECT 1") == "SELECT 1"
