"""Unit tests for the MSSQL pyodbc connection plumbing.

These tests mock out ``pyodbc`` so they run without ODBC Driver 18
installed; they cover behaviours called out in PR #2274 review:

1. ``mssql://`` URL components are URL-decoded round-trip.
2. Asymmetric ``user`` / ``password`` combinations raise instead of
   leaking a half-built ODBC connection string.
3. A non-numeric ``statement_timeout`` raises BEFORE ``pyodbc.connect``
   is called, so the connection can't be leaked.
4. SQL Server ``TINYINT`` (``internal_size == 1``) maps unconditionally
   to ``pa.uint8()``.
5. ``_decode_mssql_datetimeoffset`` validates payload length explicitly.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pyarrow as pa
import pytest

from wren.connector.mssql import MSSqlConnector
from wren.model.data_source import DataSourceExtension
from wren.model.error import ErrorCode, WrenError

pytestmark = pytest.mark.unit


class _FakePyodbc:
    """Stand-in for the ``pyodbc`` module used by ``_connect_mssql_pyodbc``."""

    def __init__(self) -> None:
        self.connect = MagicMock(return_value=MagicMock(timeout=0))


def _parse_conn_str(connect_call) -> dict[str, str]:
    """Split an ODBC connection string from a ``connect`` call into a dict."""
    (conn_str,), _ = connect_call
    parts: dict[str, str] = {}
    for piece in conn_str.split(";"):
        if not piece:
            continue
        key, _, value = piece.partition("=")
        # Strip the {value} escaping used by _escape_odbc_value
        if value.startswith("{") and value.endswith("}"):
            value = value[1:-1].replace("}}", "}")
        parts[key] = value
    return parts


# ---------------------------------------------------------------------------
# 1. URL decoding round-trip
# ---------------------------------------------------------------------------


def test_mssql_url_decodes_user_database_and_password() -> None:
    """user, database path, and password should all be URL-decoded."""
    fake = _FakePyodbc()
    url = (
        "mssql://us%40er:p%40ss%20word@host:1433/"
        "my%20db?TrustServerCertificate=yes&app%20name=wren"
    )

    with patch("wren.model.data_source.pyodbc", fake):
        DataSourceExtension.get_mssql_connection_from_url(url)

    fake.connect.assert_called_once()
    parts = _parse_conn_str(fake.connect.call_args)
    assert parts["UID"] == "us@er"
    assert parts["PWD"] == "p@ss word"
    assert parts["DATABASE"] == "my db"
    assert parts["SERVER"] == "host,1433"
    # parse_qsl handles query-string decoding; the key keeps its space.
    assert parts["TrustServerCertificate"] == "yes"
    assert parts["app name"] == "wren"


# ---------------------------------------------------------------------------
# 2. Auth combination validation
# ---------------------------------------------------------------------------


def test_mssql_user_without_password_raises() -> None:
    fake = _FakePyodbc()
    with patch("wren.model.data_source.pyodbc", fake):
        with pytest.raises(WrenError) as exc:
            DataSourceExtension._connect_mssql_pyodbc(
                host="h",
                port="1433",
                database="db",
                user="alice",
                password=None,
                driver="ODBC Driver 18 for SQL Server",
            )
    assert exc.value.error_code == ErrorCode.INVALID_CONNECTION_INFO
    fake.connect.assert_not_called()


def test_mssql_password_without_user_raises() -> None:
    fake = _FakePyodbc()
    with patch("wren.model.data_source.pyodbc", fake):
        with pytest.raises(WrenError) as exc:
            DataSourceExtension._connect_mssql_pyodbc(
                host="h",
                port="1433",
                database="db",
                user=None,
                password="secret",
                driver="ODBC Driver 18 for SQL Server",
            )
    assert exc.value.error_code == ErrorCode.INVALID_CONNECTION_INFO
    fake.connect.assert_not_called()


def test_mssql_no_credentials_uses_trusted_connection() -> None:
    fake = _FakePyodbc()
    with patch("wren.model.data_source.pyodbc", fake):
        DataSourceExtension._connect_mssql_pyodbc(
            host="h",
            port="1433",
            database="db",
            user=None,
            password=None,
            driver="ODBC Driver 18 for SQL Server",
        )

    parts = _parse_conn_str(fake.connect.call_args)
    assert parts.get("Trusted_Connection") == "yes"
    assert "UID" not in parts
    assert "PWD" not in parts


def test_mssql_both_credentials_emits_uid_and_pwd() -> None:
    fake = _FakePyodbc()
    with patch("wren.model.data_source.pyodbc", fake):
        DataSourceExtension._connect_mssql_pyodbc(
            host="h",
            port="1433",
            database="db",
            user="alice",
            password="secret",
            driver="ODBC Driver 18 for SQL Server",
        )

    parts = _parse_conn_str(fake.connect.call_args)
    assert parts["UID"] == "alice"
    assert parts["PWD"] == "secret"
    assert "Trusted_Connection" not in parts


# ---------------------------------------------------------------------------
# 3. statement_timeout validated before connect()
# ---------------------------------------------------------------------------


def test_mssql_invalid_statement_timeout_does_not_leak_connection() -> None:
    fake = _FakePyodbc()
    with patch("wren.model.data_source.pyodbc", fake):
        with pytest.raises(WrenError) as exc:
            DataSourceExtension._connect_mssql_pyodbc(
                host="h",
                port="1433",
                database="db",
                user="alice",
                password="secret",
                driver="ODBC Driver 18 for SQL Server",
                kwargs={"statement_timeout": "not-a-number"},
            )

    assert exc.value.error_code == ErrorCode.INVALID_CONNECTION_INFO
    # The crucial assertion: connect() must not be called when the
    # timeout is invalid, otherwise the connection would leak.
    fake.connect.assert_not_called()


def test_mssql_valid_statement_timeout_is_applied() -> None:
    fake = _FakePyodbc()
    conn = MagicMock()
    conn.timeout = 0
    fake.connect.return_value = conn

    with patch("wren.model.data_source.pyodbc", fake):
        result = DataSourceExtension._connect_mssql_pyodbc(
            host="h",
            port="1433",
            database="db",
            user="alice",
            password="secret",
            driver="ODBC Driver 18 for SQL Server",
            kwargs={"statement_timeout": "42"},
        )

    fake.connect.assert_called_once()
    assert result.timeout == 42
    parts = _parse_conn_str(fake.connect.call_args)
    # statement_timeout is popped, never sent to the ODBC string
    assert "statement_timeout" not in parts


# ---------------------------------------------------------------------------
# 4. TINYINT maps unconditionally to uint8
# ---------------------------------------------------------------------------


def test_mssql_tinyint_maps_to_uint8_regardless_of_sample_sign() -> None:
    """SQL Server TINYINT is unsigned (0..255); the Arrow type must be
    ``uint8`` regardless of the sampled values (which can never legitimately
    be negative, but the helper must not branch on sign)."""
    # internal_size == 1 is what pyodbc reports for TINYINT columns.
    column_desc = ("c_tinyint", int, None, 1, 3, 0, True)

    # Non-negative sample → uint8.
    assert MSSqlConnector._mssql_arrow_type(column_desc, [0, 255]) == pa.uint8()
    # All-None sample → still uint8 (driver-declared internal_size wins).
    assert MSSqlConnector._mssql_arrow_type(column_desc, [None, None]) == pa.uint8()


def test_mssql_tinyint_round_trips_through_build_column() -> None:
    """A TINYINT column with 0 and 255 must survive the column build path."""
    arr = MSSqlConnector._build_mssql_column([0, 255, None], pa.uint8())
    assert arr.type == pa.uint8()
    assert arr.to_pylist() == [0, 255, None]


# ---------------------------------------------------------------------------
# 5. datetimeoffset payload length validation
# ---------------------------------------------------------------------------


def test_mssql_decode_datetimeoffset_rejects_truncated_payload() -> None:
    """A short DATETIMEOFFSET payload must raise a clear error, not the
    cryptic ``month must be in 1..12`` that bubbles up from datetime()."""
    truncated = b"\x00" * 10
    with pytest.raises(ValueError) as exc:
        DataSourceExtension._decode_mssql_datetimeoffset(truncated)
    msg = str(exc.value)
    assert "datetimeoffset" in msg.lower()
    assert "20" in msg
    assert "10" in msg


def test_mssql_decode_datetimeoffset_accepts_none() -> None:
    """``None`` continues to pass through (NULL values from pyodbc)."""
    assert DataSourceExtension._decode_mssql_datetimeoffset(None) is None


# ---------------------------------------------------------------------------
# 6. Duplicate column names survive ``query()``
# ---------------------------------------------------------------------------


def test_mssql_query_preserves_duplicate_column_names() -> None:
    """``SELECT a, a`` must yield a two-column Arrow table, not one column.

    Earlier the result was built via ``dict(zip(names, arrays))`` which
    silently collapsed duplicate names. Build the table from arrays + schema
    directly to keep each projection.
    """
    cursor = MagicMock()
    # internal_size 4 → int32. Two columns both named ``a`` with distinct values.
    cursor.description = [
        ("a", int, None, 4, 10, 0, True),
        ("a", int, None, 4, 10, 0, True),
    ]
    cursor.fetchall.return_value = [(1, 2), (3, 4)]
    cursor.fetchmany.return_value = [(1, 2), (3, 4)]

    fake_conn = MagicMock()
    fake_conn.cursor.return_value = cursor

    connector = MSSqlConnector.__new__(MSSqlConnector)
    connector.connection = fake_conn

    table = connector.query("SELECT a, a FROM t")

    assert table.num_columns == 2
    assert table.column_names == ["a", "a"]
    assert table.column(0).to_pylist() == [1, 3]
    assert table.column(1).to_pylist() == [2, 4]
