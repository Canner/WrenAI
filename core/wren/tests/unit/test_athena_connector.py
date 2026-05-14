"""Unit tests for the native pyathena-backed Athena connector.

These tests stub out :mod:`pyathena` and :mod:`boto3` so they can run without
any AWS credentials or network access.
"""

from __future__ import annotations

import datetime as dtlib
import sys
import types
from decimal import Decimal as PyDecimal
from unittest.mock import MagicMock

import pyarrow as pa
import pytest
from pydantic import SecretStr

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# stub pyathena module before importing the connector under test
# ---------------------------------------------------------------------------

_pyathena_connect_calls: list[dict] = []
_pyathena_connection_mock = MagicMock(name="pyathena_connection")


def _fake_pyathena_connect(**kwargs):
    _pyathena_connect_calls.append(kwargs)
    return _pyathena_connection_mock


_pyathena_module = types.ModuleType("pyathena")
_pyathena_module.connect = _fake_pyathena_connect  # type: ignore[attr-defined]
sys.modules.setdefault("pyathena", _pyathena_module)

from wren.connector.athena import (  # noqa: E402
    AthenaConnector,
    _build_athena_arrow_table,
    _parse_athena_type,
)
from wren.model import AthenaConnectionInfo  # noqa: E402
from wren.model.data_source import DataSourceExtension  # noqa: E402
from wren.model.error import ErrorCode, ErrorPhase, WrenError  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_connect_calls():
    _pyathena_connect_calls.clear()
    _pyathena_connection_mock.reset_mock(return_value=True, side_effect=True)
    _pyathena_connection_mock.close.reset_mock()
    yield


# ---------------------------------------------------------------------------
# type lexer
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("type_str", "expected"),
    [
        ("varchar", pa.string()),
        ("integer", pa.int32()),
        ("bigint", pa.int64()),
        ("boolean", pa.bool_()),
        ("double", pa.float64()),
        ("date", pa.date32()),
        ("varbinary", pa.binary()),
    ],
)
def test_parse_athena_type_primitives(type_str, expected):
    assert _parse_athena_type(type_str) == expected


def test_parse_athena_type_decimal():
    assert _parse_athena_type("decimal(12,4)") == pa.decimal128(12, 4)


def test_parse_athena_type_array():
    assert _parse_athena_type("array(varchar)") == pa.list_(pa.string())


def test_parse_athena_type_map():
    assert _parse_athena_type("map(varchar,bigint)") == pa.map_(pa.string(), pa.int64())


def test_parse_athena_type_row():
    parsed = _parse_athena_type("row(a integer, b varchar)")
    assert pa.types.is_struct(parsed)
    fields = {
        parsed.field(i).name: parsed.field(i).type for i in range(parsed.num_fields)
    }
    assert fields["a"] == pa.int32()
    assert fields["b"] == pa.string()


def test_parse_athena_type_unknown_falls_back_to_string():
    assert _parse_athena_type("totally not a type") == pa.string()


def test_parse_athena_type_none_returns_string():
    assert _parse_athena_type(None) == pa.string()


# ---------------------------------------------------------------------------
# cursor → arrow table
# ---------------------------------------------------------------------------


def _make_cursor(description, rows):
    cursor = MagicMock()
    cursor.description = description
    cursor.fetchall.return_value = rows
    cursor.execute.return_value = cursor
    return cursor


def test_build_athena_arrow_table_mixed_types():
    description = [
        ("id", "bigint"),
        ("name", "varchar"),
        ("price", "decimal(10,2)"),
        ("tags", "array(varchar)"),
        ("ordered_at", "timestamp"),
        ("ordered_on", "date"),
    ]
    rows = [
        (
            1,
            "alice",
            PyDecimal("9.99"),
            ["a", "b"],
            dtlib.datetime(2024, 1, 2, 3, 4, 5),
            dtlib.date(2024, 1, 2),
        ),
        (2, "bob", PyDecimal("1.50"), [], None, None),
    ]
    cursor = _make_cursor(description, rows)
    table = _build_athena_arrow_table(cursor)
    assert table.num_rows == 2
    assert table.schema.field("id").type == pa.int64()
    assert table.schema.field("name").type == pa.string()
    assert table.schema.field("price").type == pa.decimal128(10, 2)
    assert table.schema.field("tags").type == pa.list_(pa.string())
    assert table.schema.field("ordered_at").type == pa.timestamp("ms")
    assert table.schema.field("ordered_on").type == pa.date32()


def test_build_athena_arrow_table_empty():
    cursor = _make_cursor([("a", "varchar")], [])
    table = _build_athena_arrow_table(cursor)
    assert table.num_rows == 0
    assert table.schema.field("a").type == pa.string()


# ---------------------------------------------------------------------------
# AthenaConnector — happy path & error mapping
# ---------------------------------------------------------------------------


def _info(**overrides) -> AthenaConnectionInfo:
    data = {
        "s3_staging_dir": SecretStr("s3://bucket/staging/"),
        "region_name": "us-west-2",
        "schema_name": "default",
    }
    data.update(overrides)
    return AthenaConnectionInfo(**data)


def test_connector_query_passes_kwargs_and_kills_on_interrupt():
    AthenaConnector(_info())
    assert _pyathena_connect_calls, "pyathena.connect was not invoked"
    kwargs = _pyathena_connect_calls[-1]
    assert kwargs["s3_staging_dir"] == "s3://bucket/staging/"
    assert kwargs["region_name"] == "us-west-2"
    assert kwargs["schema_name"] == "default"
    assert kwargs["kill_on_interrupt"] is True


def test_connector_query_returns_arrow_table_and_respects_limit():
    cursor = _make_cursor(
        [("id", "integer"), ("name", "varchar")],
        [(1, "a"), (2, "b"), (3, "c")],
    )
    _pyathena_connection_mock.cursor.return_value = cursor

    conn = AthenaConnector(_info())
    table = conn.query("SELECT id, name FROM t", limit=2)
    assert table.num_rows == 2
    assert table.column("id").to_pylist() == [1, 2]
    cursor.execute.assert_called_once_with("SELECT id, name FROM t")


def test_connector_query_wraps_driver_errors():
    cursor = MagicMock()
    cursor.execute.side_effect = RuntimeError("boom")
    _pyathena_connection_mock.cursor.return_value = cursor

    conn = AthenaConnector(_info())
    with pytest.raises(WrenError) as exc:
        conn.query("SELECT 1")
    assert exc.value.error_code == ErrorCode.INVALID_SQL
    assert exc.value.phase == ErrorPhase.SQL_EXECUTION


def test_connector_dry_run_emits_explain():
    cursor = MagicMock()
    cursor.execute.return_value = cursor
    _pyathena_connection_mock.cursor.return_value = cursor

    conn = AthenaConnector(_info())
    conn.dry_run("SELECT 1")
    cursor.execute.assert_called_once_with("EXPLAIN SELECT 1")


def test_connector_dry_run_wraps_driver_errors():
    cursor = MagicMock()
    cursor.execute.side_effect = RuntimeError("parse error")
    _pyathena_connection_mock.cursor.return_value = cursor

    conn = AthenaConnector(_info())
    with pytest.raises(WrenError) as exc:
        conn.dry_run("SELECT bogus")
    assert exc.value.error_code == ErrorCode.INVALID_SQL
    assert exc.value.phase == ErrorPhase.SQL_DRY_RUN


def test_connector_close_calls_underlying_connection():
    conn = AthenaConnector(_info())
    underlying = conn.connection
    conn.close()
    underlying.close.assert_called_once()
    assert conn.connection is None
    # Idempotent.
    conn.close()


# ---------------------------------------------------------------------------
# credential resolution
# ---------------------------------------------------------------------------


def test_connector_uses_access_key_when_provided():
    AthenaConnector(
        _info(
            aws_access_key_id=SecretStr("AKIA"),
            aws_secret_access_key=SecretStr("SECRET"),
            aws_session_token=SecretStr("TOKEN"),
        )
    )
    kwargs = _pyathena_connect_calls[-1]
    assert kwargs["aws_access_key_id"] == "AKIA"
    assert kwargs["aws_secret_access_key"] == "SECRET"
    assert kwargs["aws_session_token"] == "TOKEN"


def test_connector_uses_oidc_when_web_identity_token_provided(monkeypatch):
    sts_client = MagicMock()
    sts_client.assume_role_with_web_identity.return_value = {
        "Credentials": {
            "AccessKeyId": "OIDC_AK",
            "SecretAccessKey": "OIDC_SK",
            "SessionToken": "OIDC_TK",
        }
    }
    boto_module = MagicMock()
    boto_module.client.return_value = sts_client
    monkeypatch.setattr("boto3.client", boto_module.client)

    AthenaConnector(
        _info(
            web_identity_token=SecretStr("token-xyz"),
            role_arn=SecretStr("arn:aws:iam::123:role/wren"),
            role_session_name="custom-session",
        )
    )

    boto_module.client.assert_called_once_with("sts", region_name="us-west-2")
    sts_client.assume_role_with_web_identity.assert_called_once_with(
        RoleArn="arn:aws:iam::123:role/wren",
        RoleSessionName="custom-session",
        WebIdentityToken="token-xyz",
    )
    kwargs = _pyathena_connect_calls[-1]
    assert kwargs["aws_access_key_id"] == "OIDC_AK"
    assert kwargs["aws_secret_access_key"] == "OIDC_SK"
    assert kwargs["aws_session_token"] == "OIDC_TK"


def test_connector_falls_back_to_default_chain_when_no_credentials():
    AthenaConnector(_info())
    kwargs = _pyathena_connect_calls[-1]
    assert "aws_access_key_id" not in kwargs
    assert "aws_secret_access_key" not in kwargs
    assert "aws_session_token" not in kwargs


# ---------------------------------------------------------------------------
# data_source.get_athena_connection still works end-to-end
# ---------------------------------------------------------------------------


def test_data_source_get_athena_connection_returns_pyathena_connection():
    DataSourceExtension.get_athena_connection(_info())
    assert _pyathena_connect_calls, "pyathena.connect should be called"


def test_data_source_get_athena_connection_propagates_schema_and_kwargs():
    """Regression: data_source.get_athena_connection must funnel through the
    same kwargs builder as AthenaConnector so schema_name, kill_on_interrupt,
    and any user-supplied info.kwargs reach pyathena.connect consistently.
    """
    info = _info(schema_name="analytics")
    # AthenaConnectionInfo currently has no ``kwargs`` field, but the shared
    # builder reads it defensively. Simulate a future/user-provided value.
    object.__setattr__(info, "kwargs", {"work_group": "wg-1", "kill_on_interrupt": False})

    DataSourceExtension.get_athena_connection(info)

    kwargs = _pyathena_connect_calls[-1]
    assert kwargs["schema_name"] == "analytics"
    assert kwargs["work_group"] == "wg-1"
    # User-supplied kwargs override the default.
    assert kwargs["kill_on_interrupt"] is False


def test_data_source_get_athena_connection_defaults_kill_on_interrupt():
    DataSourceExtension.get_athena_connection(_info())
    kwargs = _pyathena_connect_calls[-1]
    assert kwargs["kill_on_interrupt"] is True
    assert kwargs["schema_name"] == "default"
