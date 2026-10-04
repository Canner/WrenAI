"""PostgresConnector owns one connection per operation, with autocommit by default.

``postgres`` imports ``psycopg`` at module load. Unit CI does not install the
``postgres`` extra, so stub ``psycopg`` in ``sys.modules`` before importing the
connector module (same pattern as ``test_postgres_semicolon_unlimited``).
"""

from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from wren.model.error import ErrorPhase, WrenError

pytestmark = pytest.mark.unit


def _ensure_psycopg_stub() -> None:
    if "psycopg" in sys.modules:
        return
    mod = types.ModuleType("psycopg")
    errors = types.ModuleType("psycopg.errors")

    class QueryCanceled(Exception):
        """Stand-in for ``psycopg.errors.QueryCanceled``."""

    errors.QueryCanceled = QueryCanceled
    mod.errors = errors
    mod.connect = lambda **kwargs: MagicMock()
    sys.modules["psycopg"] = mod
    sys.modules["psycopg.errors"] = errors


_ensure_psycopg_stub()

import wren.connector.postgres as postgres_mod  # noqa: E402
from wren.connector.postgres import PostgresConnector  # noqa: E402


def _connection_info(**overrides):
    base = {
        "host": "localhost",
        "port": 5432,
        "database": "wren",
        "user": "wren",
        "password": None,
        "kwargs": None,
        "connection_url": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _capture_connect(monkeypatch) -> dict:
    """Replace ``psycopg.connect`` and return the dict it records kwargs into."""
    captured: dict = {}

    def fake_connect(**kwargs):
        captured.update(kwargs)
        return MagicMock()

    monkeypatch.setattr(postgres_mod.psycopg, "connect", fake_connect)
    return captured


def test_connect_defaults_to_autocommit(monkeypatch):
    captured = _capture_connect(monkeypatch)

    PostgresConnector(_connection_info()).dry_run("SELECT 1")

    assert captured["autocommit"] is True


def test_explicit_autocommit_kwarg_wins(monkeypatch):
    captured = _capture_connect(monkeypatch)

    PostgresConnector(_connection_info(kwargs={"autocommit": False})).dry_run(
        "SELECT 1"
    )

    assert captured["autocommit"] is False


def test_other_connection_kwargs_are_preserved(monkeypatch):
    captured = _capture_connect(monkeypatch)

    PostgresConnector(_connection_info(kwargs={"connect_timeout": 7})).dry_run(
        "SELECT 1"
    )

    assert captured["connect_timeout"] == 7
    assert captured["autocommit"] is True


def _mock_connection():
    connection = MagicMock()
    connection.__enter__.return_value = connection
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.description = [SimpleNamespace(name="n", type_code=23)]
    cursor.fetchall.return_value = [(1,)]
    return connection


@pytest.mark.parametrize("method", ["query", "dry_run"])
def test_each_operation_opens_and_closes_its_own_connection(monkeypatch, method):
    connections = [_mock_connection(), _mock_connection()]
    connect = MagicMock(side_effect=connections)
    monkeypatch.setattr(postgres_mod.psycopg, "connect", connect)

    connector = PostgresConnector(_connection_info())
    connect.assert_not_called()
    for connection in connections:
        result = getattr(connector, method)("SELECT 1 AS n")
        if method == "query":
            assert result.to_pydict() == {"n": [1]}
        connection.cursor.return_value.__exit__.assert_called_once_with(
            None, None, None
        )
        connection.__exit__.assert_called_once_with(None, None, None)
    assert connect.call_count == 2

    connector.close()
    connector.close()
    assert connect.call_count == 2


@pytest.mark.parametrize(
    ("method", "failure_stage", "phase"),
    [
        ("query", "execute", ErrorPhase.SQL_EXECUTION),
        ("query", "fetchall", ErrorPhase.SQL_EXECUTION),
        ("dry_run", "execute", ErrorPhase.SQL_DRY_RUN),
    ],
)
def test_failed_operation_closes_connection_and_next_call_recovers(
    monkeypatch, method, failure_stage, phase
):
    failed, healthy = _mock_connection(), _mock_connection()
    error = RuntimeError("connection is closed")
    cursor = failed.cursor.return_value.__enter__.return_value
    getattr(cursor, failure_stage).side_effect = error
    connect = MagicMock(side_effect=[failed, healthy])
    monkeypatch.setattr(postgres_mod.psycopg, "connect", connect)
    connector = PostgresConnector(_connection_info())

    with pytest.raises(WrenError, match="connection is closed") as caught:
        getattr(connector, method)("SELECT 1 AS n")

    assert caught.value.phase == phase
    assert caught.value.__cause__ is error
    assert failed.__exit__.call_args.args[1] is error
    assert failed.cursor.return_value.__exit__.call_args.args[1] is error
    result = connector.query("SELECT 1 AS n")
    assert result.to_pydict() == {"n": [1]}
    assert connect.call_count == 2
    healthy.__exit__.assert_called_once_with(None, None, None)


@pytest.mark.parametrize("method", ["query", "dry_run"])
def test_connection_failure_does_not_poison_next_call(monkeypatch, method):
    connection = _mock_connection()
    connect = MagicMock(side_effect=[RuntimeError("database unavailable"), connection])
    monkeypatch.setattr(postgres_mod.psycopg, "connect", connect)
    connector = PostgresConnector(_connection_info())

    with pytest.raises(WrenError, match="database unavailable"):
        getattr(connector, method)("SELECT 1 AS n")
    assert connector.query("SELECT 1 AS n").to_pydict() == {"n": [1]}
    assert connect.call_count == 2
    connection.__exit__.assert_called_once_with(None, None, None)
