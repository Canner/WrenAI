"""Canner connector strips trailing ; on limited and unlimited query paths."""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pyarrow as pa
import pytest

from wren.connector.base import strip_trailing_semicolon as _strip_trailing_semicolon
from wren.connector.canner import CannerConnector

pytestmark = pytest.mark.unit


def test_strip_helper():
    assert _strip_trailing_semicolon("SELECT 1; ; \n") == "SELECT 1"
    assert _strip_trailing_semicolon("SELECT 'a;b'") == "SELECT 'a;b'"


@pytest.fixture
def fake_psycopg(monkeypatch):
    """CannerConnector.query() does ``import psycopg`` at call time.

    The unit-test image doesn't install psycopg, so provide a stub with the
    ``errors.QueryCanceled`` attribute the except-clause references.
    """
    mod = types.ModuleType("psycopg")
    errors = types.ModuleType("psycopg.errors")

    class QueryCanceled(Exception):
        pass

    errors.QueryCanceled = QueryCanceled
    mod.errors = errors
    monkeypatch.setitem(sys.modules, "psycopg", mod)
    monkeypatch.setitem(sys.modules, "psycopg.errors", errors)
    return mod


def _make_connector():
    connector = CannerConnector.__new__(CannerConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor
    return connector, cursor


def test_query_unlimited_strips_trailing_semicolon(monkeypatch, fake_psycopg):
    connector, cursor = _make_connector()
    monkeypatch.setattr(
        "wren.connector.canner._build_arrow_table",
        lambda cur: pa.table({"x": [1]}),
    )

    connector.query("SELECT 1 AS x;")

    cursor.execute.assert_called_once_with("SELECT 1 AS x")


def test_query_limited_strips_before_wrap(monkeypatch, fake_psycopg):
    connector, cursor = _make_connector()
    monkeypatch.setattr(
        "wren.connector.canner._build_arrow_table",
        lambda cur: pa.table({"x": [1]}),
    )

    connector.query("SELECT 1 AS x;", limit=3)

    cursor.execute.assert_called_once_with(
        "SELECT * FROM (SELECT 1 AS x) AS _t LIMIT 3"
    )
