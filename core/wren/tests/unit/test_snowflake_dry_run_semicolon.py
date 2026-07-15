"""dry_run must strip trailing semicolons before cursor.describe."""

from unittest.mock import MagicMock

from wren.connector.snowflake import SnowflakeConnector


def _make_mock_connector() -> tuple[SnowflakeConnector, MagicMock]:
    connector = SnowflakeConnector.__new__(SnowflakeConnector)
    cursor = MagicMock()
    # context-manager cursor
    cm = MagicMock()
    cm.__enter__.return_value = cursor
    cm.__exit__.return_value = False
    conn = MagicMock()
    conn.cursor.return_value = cm
    connector.connection = conn
    return connector, cursor


def test_dry_run_strips_trailing_semicolon_before_describe() -> None:
    connector, cursor = _make_mock_connector()
    connector.dry_run("SELECT 1;")
    (sent,), _ = cursor.describe.call_args
    assert sent == "SELECT 1"
    assert not sent.endswith(";")


def test_dry_run_strips_whitespace_after_semicolon() -> None:
    connector, cursor = _make_mock_connector()
    connector.dry_run("SELECT 1;  \n")
    (sent,), _ = cursor.describe.call_args
    assert sent == "SELECT 1"
