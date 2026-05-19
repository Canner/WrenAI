"""Snowflake connector tests — mocked snowflake.connector.

Live integration tests are out of scope (no testcontainer available).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pyarrow as pa
import pytest
from pydantic import SecretStr

from wren.connector.snowflake import (
    SnowflakeConnector,
    _build_connection_params,
    create_connector,
)
from wren.model import SnowflakeConnectionInfo
from wren.model.error import ErrorCode, ErrorPhase, WrenError

pytestmark = pytest.mark.snowflake


def _password_info(**overrides) -> SnowflakeConnectionInfo:
    data = {
        "user": "admin",
        "password": "secret",
        "account": "acct",
        "database": "db",
        "schema": "sch",
    }
    data.update(overrides)
    return SnowflakeConnectionInfo.model_validate(data)


def _private_key_info(**overrides) -> SnowflakeConnectionInfo:
    data = {
        "user": "admin",
        "private_key": "PRIV-KEY",
        "account": "acct",
        "database": "db",
        "schema": "sch",
    }
    data.update(overrides)
    return SnowflakeConnectionInfo.model_validate(data)


class TestBuildConnectionParams:
    def test_password_auth(self):
        info = _password_info(warehouse="WH")
        params = _build_connection_params(info)
        assert params == {
            "user": "admin",
            "account": "acct",
            "database": "db",
            "schema": "sch",
            "password": "secret",
            "warehouse": "WH",
        }

    def test_private_key_auth_takes_precedence(self):
        info = _private_key_info(password=SecretStr("ignored"))
        params = _build_connection_params(info)
        assert params["private_key"] == "PRIV-KEY"
        assert "password" not in params

    def test_password_only(self):
        info = _password_info()
        params = _build_connection_params(info)
        assert params["password"] == "secret"
        assert "private_key" not in params
        assert "warehouse" not in params

    def test_statement_timeout_extracted_to_session_parameters(self):
        info = _password_info(kwargs={"statement_timeout": "120", "role": "MYROLE"})
        params = _build_connection_params(info)
        assert params["session_parameters"] == {"STATEMENT_TIMEOUT_IN_SECONDS": 120}
        assert params["role"] == "MYROLE"
        assert "statement_timeout" not in params

    def test_kwargs_no_statement_timeout(self):
        info = _password_info(kwargs={"role": "MYROLE"})
        params = _build_connection_params(info)
        assert params["role"] == "MYROLE"
        assert "session_parameters" not in params


class TestSnowflakeConnector:
    def _make_connector(self, mock_connection: MagicMock) -> SnowflakeConnector:
        with patch(
            "wren.connector.snowflake.snowflake.connector.connect",
            return_value=mock_connection,
        ):
            return SnowflakeConnector(_password_info())

    def test_init_uses_password_auth(self):
        mock_conn = MagicMock()
        with patch(
            "wren.connector.snowflake.snowflake.connector.connect",
            return_value=mock_conn,
        ) as connect:
            connector = SnowflakeConnector(_password_info(warehouse="WH"))
        assert connector.connection is mock_conn
        kwargs = connect.call_args.kwargs
        assert kwargs["password"] == "secret"
        assert "private_key" not in kwargs
        assert kwargs["warehouse"] == "WH"

    def test_init_uses_private_key_auth(self):
        mock_conn = MagicMock()
        with patch(
            "wren.connector.snowflake.snowflake.connector.connect",
            return_value=mock_conn,
        ) as connect:
            SnowflakeConnector(_private_key_info())
        kwargs = connect.call_args.kwargs
        assert kwargs["private_key"] == "PRIV-KEY"
        assert "password" not in kwargs

    def test_create_connector_returns_snowflake_connector(self):
        mock_conn = MagicMock()
        with patch(
            "wren.connector.snowflake.snowflake.connector.connect",
            return_value=mock_conn,
        ):
            connector = create_connector(_password_info())
        assert isinstance(connector, SnowflakeConnector)

    def _build_cursor(self, table: pa.Table | None) -> MagicMock:
        cursor = MagicMock()
        cursor.__enter__ = lambda self: self
        cursor.__exit__ = lambda *args: None
        cursor.fetch_arrow_all.return_value = table
        return cursor

    def test_query_returns_arrow_table(self):
        expected = pa.table({"a": [1, 2, 3]})
        mock_conn = MagicMock()
        cursor = self._build_cursor(expected)
        mock_conn.cursor.return_value = cursor

        connector = self._make_connector(mock_conn)
        result = connector.query("SELECT a FROM t")

        cursor.execute.assert_called_once_with("SELECT a FROM t")
        assert result.equals(expected)

    def test_query_with_limit_slices_result(self):
        expected = pa.table({"a": [1, 2, 3, 4, 5]})
        mock_conn = MagicMock()
        cursor = self._build_cursor(expected)
        mock_conn.cursor.return_value = cursor

        connector = self._make_connector(mock_conn)
        result = connector.query("SELECT a FROM t", limit=2)

        assert result.num_rows == 2
        assert result["a"].to_pylist() == [1, 2]

    def test_query_handles_none_arrow_result(self):
        mock_conn = MagicMock()
        cursor = self._build_cursor(None)
        mock_conn.cursor.return_value = cursor

        connector = self._make_connector(mock_conn)
        result = connector.query("SELECT 1 WHERE FALSE")

        assert isinstance(result, pa.Table)
        assert result.num_rows == 0

    def test_query_wraps_programming_error(self):
        import snowflake.connector  # noqa: PLC0415

        mock_conn = MagicMock()
        cursor = MagicMock()
        cursor.__enter__ = lambda self: self
        cursor.__exit__ = lambda *args: None
        cursor.execute.side_effect = snowflake.connector.errors.ProgrammingError(
            "bad sql"
        )
        mock_conn.cursor.return_value = cursor

        connector = self._make_connector(mock_conn)
        with pytest.raises(WrenError) as exc_info:
            connector.query("BAD SQL")
        assert exc_info.value.error_code == ErrorCode.INVALID_SQL
        assert exc_info.value.phase == ErrorPhase.SQL_EXECUTION

    def test_dry_run_calls_describe(self):
        mock_conn = MagicMock()
        cursor = MagicMock()
        cursor.__enter__ = lambda self: self
        cursor.__exit__ = lambda *args: None
        mock_conn.cursor.return_value = cursor

        connector = self._make_connector(mock_conn)
        connector.dry_run("SELECT 1")

        cursor.describe.assert_called_once_with("SELECT 1")
        cursor.execute.assert_not_called()

    def test_dry_run_wraps_programming_error(self):
        import snowflake.connector  # noqa: PLC0415

        mock_conn = MagicMock()
        cursor = MagicMock()
        cursor.__enter__ = lambda self: self
        cursor.__exit__ = lambda *args: None
        cursor.describe.side_effect = snowflake.connector.errors.ProgrammingError(
            "bad sql"
        )
        mock_conn.cursor.return_value = cursor

        connector = self._make_connector(mock_conn)
        with pytest.raises(WrenError) as exc_info:
            connector.dry_run("BAD SQL")
        assert exc_info.value.error_code == ErrorCode.INVALID_SQL
        assert exc_info.value.phase == ErrorPhase.SQL_DRY_RUN

    def test_close_closes_connection(self):
        mock_conn = MagicMock()
        connector = self._make_connector(mock_conn)
        connector.close()
        mock_conn.close.assert_called_once()
        assert connector.connection is None

    def test_close_idempotent(self):
        mock_conn = MagicMock()
        connector = self._make_connector(mock_conn)
        connector.close()
        connector.close()
        mock_conn.close.assert_called_once()
