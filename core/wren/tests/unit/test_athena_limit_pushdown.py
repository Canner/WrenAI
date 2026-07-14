"""Athena connector pushes LIMIT into SQL instead of Python slicing."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from wren.connector.athena import AthenaConnector
from wren.connector.base import strip_trailing_semicolon as _strip_trailing_semicolon

pytestmark = pytest.mark.unit


def test_strip_trailing_semicolon_preserves_interior():
    assert _strip_trailing_semicolon("SELECT 'a;b';") == "SELECT 'a;b'"


def test_query_pushes_limit_into_sql():
    connector = AthenaConnector.__new__(AthenaConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    cursor.description = []
    # builder path for empty description
    connector.connection.cursor.return_value = cursor

    with patch(
        "wren.connector.athena._build_athena_arrow_table", return_value=MagicMock()
    ) as builder:
        # contextlib.closing expects .close()
        cursor.close = MagicMock()
        # wrap closing: connection.cursor() is used as CM via closing()
        with patch(
            "wren.connector.athena.contextlib.closing", side_effect=lambda c: _CM(c)
        ):
            connector.query("SELECT 1;", limit=3)

    cursor.execute.assert_called_once_with(
        "SELECT * FROM (\nSELECT 1\n) AS _wren_sub LIMIT 3"
    )
    builder.assert_called_once()


class _CM:
    def __init__(self, obj):
        self.obj = obj

    def __enter__(self):
        return self.obj

    def __exit__(self, *a):
        return False


def test_query_without_limit_runs_original_sql():
    connector = AthenaConnector.__new__(AthenaConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    cursor.close = MagicMock()
    with (
        patch(
            "wren.connector.athena._build_athena_arrow_table", return_value=MagicMock()
        ),
        patch("wren.connector.athena.contextlib.closing", side_effect=lambda c: _CM(c)),
    ):
        connector.connection.cursor.return_value = cursor
        connector.query("SELECT 1")
    cursor.execute.assert_called_once_with("SELECT 1")


def test_query_limit_survives_trailing_line_comment():
    """Trailing `--` must not eat the wrap (goldmedal #2457)."""
    connector = AthenaConnector.__new__(AthenaConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    cursor.close = MagicMock()
    with (
        patch(
            "wren.connector.athena._build_athena_arrow_table", return_value=MagicMock()
        ),
        patch("wren.connector.athena.contextlib.closing", side_effect=lambda c: _CM(c)),
    ):
        connector.connection.cursor.return_value = cursor
        connector.query("SELECT 1 -- pick", limit=3)
    cursor.execute.assert_called_once_with(
        "SELECT * FROM (\nSELECT 1 -- pick\n) AS _wren_sub LIMIT 3"
    )
