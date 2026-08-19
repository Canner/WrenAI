"""PostgresConnector clears the aborted transaction left by a failed statement.

``postgres`` imports ``psycopg`` at module load. Unit CI does not install the
``postgres`` extra, so stub ``psycopg`` in ``sys.modules`` before importing the
connector module (same pattern as ``test_postgres_semicolon_unlimited``). The
stub also needs ``errors.QueryCanceled``: Python evaluates each ``except``
expression in order, so the connector's first handler is dereferenced even when
the raised error is something else.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pyarrow as pa
import pytest

pytestmark = pytest.mark.unit


def _ensure_psycopg_stub() -> None:
    if "psycopg" in sys.modules:
        return
    mod = types.ModuleType("psycopg")
    errors = types.ModuleType("psycopg.errors")

    class QueryCanceled(Exception):
        """Stand-in for ``psycopg.errors.QueryCanceled``."""

    errors.QueryCanceled = QueryCanceled
    sys.modules["psycopg"] = mod
    sys.modules["psycopg.errors"] = errors
    mod.errors = errors


_ensure_psycopg_stub()

import wren.connector.postgres as postgres_mod  # noqa: E402
from wren.connector.postgres import PostgresConnector  # noqa: E402
from wren.model.error import WrenError  # noqa: E402


def _make_connector(execute_side_effect: BaseException | None = None):
    """Build a connector over a mock connection, bypassing ``psycopg.connect``."""
    connector = PostgresConnector.__new__(PostgresConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor
    if execute_side_effect is not None:
        cursor.execute.side_effect = execute_side_effect
    return connector, cursor


def test_query_rolls_back_after_backend_failure():
    connector, _ = _make_connector(RuntimeError('column "nope" does not exist'))

    with pytest.raises(WrenError):
        connector.query("SELECT nope FROM t")

    connector.connection.rollback.assert_called_once_with()


def test_dry_run_rolls_back_after_backend_failure():
    connector, _ = _make_connector(RuntimeError('column "nope" does not exist'))

    with pytest.raises(WrenError):
        connector.dry_run("SELECT nope FROM t")

    connector.connection.rollback.assert_called_once_with()


def test_query_canceled_rolls_back():
    query_canceled = sys.modules["psycopg"].errors.QueryCanceled
    connector, _ = _make_connector(query_canceled("canceling statement due to timeout"))

    with pytest.raises(query_canceled):
        connector.query("SELECT pg_sleep(10)")

    connector.connection.rollback.assert_called_once_with()


def test_successful_query_does_not_roll_back(monkeypatch):
    connector, _ = _make_connector()
    monkeypatch.setattr(
        postgres_mod, "_build_pg_arrow_table", lambda cur: pa.table({"x": [1]})
    )

    connector.query("SELECT 1 AS x")

    connector.connection.rollback.assert_not_called()


def test_rollback_failure_does_not_mask_original_error():
    connector, _ = _make_connector(RuntimeError("original backend failure"))
    connector.connection.rollback.side_effect = RuntimeError("the connection is closed")

    with pytest.raises(WrenError) as excinfo:
        connector.query("SELECT 1")

    assert "original backend failure" in str(excinfo.value)
