"""Athena unlimited query strips trailing semicolon like the limit wrap."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from wren.connector.athena import AthenaConnector

pytestmark = pytest.mark.unit


class _CM:
    def __init__(self, obj):
        self.obj = obj

    def __enter__(self):
        return self.obj

    def __exit__(self, *a):
        return False


def _make_mock_connector():
    connector = AthenaConnector.__new__(AthenaConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    cursor.close = MagicMock()
    connector.connection.cursor.return_value = cursor
    return connector, cursor


def test_query_unlimited_path_strips_trailing_semicolon():
    connector, cursor = _make_mock_connector()
    with (
        patch(
            "wren.connector.athena._build_athena_arrow_table", return_value=MagicMock()
        ),
        patch("wren.connector.athena.contextlib.closing", side_effect=lambda c: _CM(c)),
    ):
        connector.query("SELECT 1;")

    cursor.execute.assert_called_once_with("SELECT 1")
