"""RedshiftConnector must coerce limit before SQL interpolation."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from wren.connector.redshift import RedshiftConnector, _coerce_limit

pytestmark = pytest.mark.unit


def test_coerce_limit_rejects_injection() -> None:
    with pytest.raises(ValueError):
        _coerce_limit("1; drop")


def test_coerce_limit_rejects_negative() -> None:
    with pytest.raises(ValueError):
        _coerce_limit(-1)


def _make_mock_connector() -> tuple[RedshiftConnector, MagicMock]:
    connector = RedshiftConnector.__new__(RedshiftConnector)
    cursor = MagicMock()
    cursor.description = []
    cursor.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value = cursor
    connector.connection = conn
    return connector, cursor


def test_query_uses_coerced_limit() -> None:
    connector, cursor = _make_mock_connector()
    connector.query("SELECT 1;", limit="3")
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _q LIMIT 3"
