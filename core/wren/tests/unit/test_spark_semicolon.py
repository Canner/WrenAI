"""Trailing-semicolon stripping for the Spark connector (mocked session)."""

from unittest.mock import MagicMock

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
    # pandas DF mock for pa.Table.from_pandas
    import pandas as pd

    session.sql.return_value.toPandas.return_value = pd.DataFrame({"x": [1, 2, 3]})
    connector.query("SELECT 1;", limit=2)
    session.sql.assert_called_once_with("SELECT 1")


def test_dry_run_strips_trailing_semicolon() -> None:
    connector, session = _make_mock_connector()
    connector.dry_run("SELECT 1;  \n")
    session.sql.assert_called_once_with("SELECT 1")
    session.sql.return_value.limit.assert_called_once_with(0)


def test_helper_preserves_semicolon_inside_string_literal() -> None:
    sql = "SELECT 'a;b' AS x"
    assert strip_trailing_semicolon(sql) == sql


def test_helper_no_trailing_semicolon_unchanged() -> None:
    assert strip_trailing_semicolon("SELECT 1") == "SELECT 1"
