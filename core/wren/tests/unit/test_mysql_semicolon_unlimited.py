"""MySQL unlimited query path strips trailing semicolon (mocked)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from wren.connector.mysql import MySqlConnector

pytestmark = pytest.mark.unit


def _make_connector() -> tuple[MySqlConnector, MagicMock]:
    connector = MySqlConnector.__new__(MySqlConnector)
    cursor = MagicMock()
    cursor.description = (("x", None, None, None, None, None, None),)
    cursor.fetchall.return_value = ((1,),)
    conn = MagicMock()
    conn.cursor.return_value = cursor
    connector.connection = conn
    return connector, cursor


def test_query_strips_semicolon_when_unlimited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "wren.connector.mysql._build_mysql_arrow_table",
        lambda cursor: object(),
    )
    connector, cursor = _make_connector()
    connector.query("SELECT 1;")
    cursor.execute.assert_called_once_with("SELECT 1")


def test_query_limit_path_still_strips_via_apply_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "wren.connector.mysql._build_mysql_arrow_table",
        lambda cursor: object(),
    )
    connector, cursor = _make_connector()
    connector.query("SELECT 1;", limit=2)
    sent = cursor.execute.call_args[0][0]
    assert "LIMIT 2" in sent
    assert not sent.rstrip().endswith(";")
