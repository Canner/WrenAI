"""Trino unlimited query strips trailing semicolons before execute."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pyarrow as pa
import pytest


@pytest.fixture
def connector():
    with patch("wren.connector.trino._import_trino") as imp:
        mod = MagicMock()
        imp.return_value = mod
        from wren.connector.trino import TrinoConnector

        c = TrinoConnector.__new__(TrinoConnector)
        c.connection = MagicMock()
        c._closed = False
        yield c, mod


def test_query_without_limit_strips_trailing_semicolon(connector) -> None:
    c, _mod = connector
    cursor = MagicMock()
    c.connection.cursor.return_value = cursor
    # _build_trino_arrow_table path — mock fetch
    with patch("wren.connector.trino._build_trino_arrow_table", return_value=pa.table({"x": [1]})):
        c.query("SELECT 1;")
    cursor.execute.assert_called_once_with("SELECT 1")


def test_query_with_limit_strips_inside_wrap(connector) -> None:
    c, _mod = connector
    cursor = MagicMock()
    c.connection.cursor.return_value = cursor
    with patch("wren.connector.trino._build_trino_arrow_table", return_value=pa.table({"x": [1]})):
        c.query("SELECT 1;", limit=5)
    sent = cursor.execute.call_args[0][0]
    assert "SELECT 1;" not in sent
    assert "LIMIT 5" in sent
