"""PostgresConnector connects with autocommit on by default.

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

    PostgresConnector(_connection_info())

    assert captured["autocommit"] is True


def test_explicit_autocommit_kwarg_wins(monkeypatch):
    captured = _capture_connect(monkeypatch)

    PostgresConnector(_connection_info(kwargs={"autocommit": False}))

    assert captured["autocommit"] is False


def test_other_connection_kwargs_are_preserved(monkeypatch):
    captured = _capture_connect(monkeypatch)

    PostgresConnector(_connection_info(kwargs={"connect_timeout": 7}))

    assert captured["connect_timeout"] == 7
    assert captured["autocommit"] is True
