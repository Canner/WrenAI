"""Canner connector strips trailing ; on limited and unlimited query paths."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from wren.connector.canner import CannerConnector, _strip_trailing_semicolon

pytestmark = pytest.mark.unit


def test_strip_helper():
    assert _strip_trailing_semicolon("SELECT 1; ; \n") == "SELECT 1"
    assert _strip_trailing_semicolon("SELECT 'a;b'") == "SELECT 'a;b'"


def test_query_unlimited_strips_trailing_semicolon():
    connector = CannerConnector.__new__(CannerConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor
    # Build arrow path may need description - mock _build if used
    # Patch cursor execute only and short-circuit table build via side effect
    import wren.connector.canner as canner_mod

    def _fake_table(cur):
        import pyarrow as pa

        return pa.table({"x": [1]})

    # Find helper name used
    # Use elev: make fetch via execute and intercept
    # Simpler: mock _build_arrow_table if exists
    if hasattr(canner_mod, "_build_arrow_table"):
        canner_mod._build_arrow_table = _fake_table  # type: ignore
    elif hasattr(canner_mod, "_build_pg_arrow_table"):
        canner_mod._build_pg_arrow_table = _fake_table  # type: ignore
    else:
        # last resort: fail loudly with attrs
        raise AssertionError(dir(canner_mod)[:50])

    connector.query("SELECT 1 AS x;")

    cursor.execute.assert_called_once_with("SELECT 1 AS x")


def test_query_limited_strips_before_wrap():
    connector = CannerConnector.__new__(CannerConnector)
    connector.connection = MagicMock()
    cursor = MagicMock()
    connector.connection.cursor.return_value.__enter__.return_value = cursor
    import wren.connector.canner as canner_mod
    import pyarrow as pa

    def _fake_table(cur):
        return pa.table({"x": [1]})

    if hasattr(canner_mod, "_build_arrow_table"):
        canner_mod._build_arrow_table = _fake_table  # type: ignore
    else:
        canner_mod._build_pg_arrow_table = _fake_table  # type: ignore

    connector.query("SELECT 1 AS x;", limit=3)

    cursor.execute.assert_called_once_with(
        "SELECT * FROM (SELECT 1 AS x) AS _t LIMIT 3"
    )
