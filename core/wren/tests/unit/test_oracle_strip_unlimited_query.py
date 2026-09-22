"""Oracle `query` must strip a terminating `;` on both the limited and unlimited paths.

The unlimited branch used to pass `sql` through unchanged after the limited branch
stripped it. This asserts the SQL that actually reaches the driver cursor, rather
than grepping the connector's source for a particular call spelling.
"""

from __future__ import annotations

import pytest

import wren.connector.oracle as oracle_mod
from wren.connector.oracle import OracleConnector


class _RecordingCursor:
    def __init__(self, sink: list[str]) -> None:
        self._sink = sink

    def execute(self, sql: str, *args, **kwargs) -> None:
        self._sink.append(sql)

    def __enter__(self) -> _RecordingCursor:
        return self

    def __exit__(self, *exc) -> bool:
        return False


class _RecordingConnection:
    def __init__(self) -> None:
        self.executed: list[str] = []

    def cursor(self) -> _RecordingCursor:
        return _RecordingCursor(self.executed)


@pytest.fixture
def connector(monkeypatch) -> OracleConnector:
    """An OracleConnector wired to a recording connection, without a driver."""
    conn = _RecordingConnection()
    # Built directly so the lazy `oracledb` import is never needed.
    subject = object.__new__(OracleConnector)
    subject.connection = conn
    monkeypatch.setattr(oracle_mod, "_build_oracle_arrow_table", lambda _cursor: None)
    return subject


@pytest.mark.parametrize("raw", ["SELECT 1;", "SELECT 1 ;  \n", "SELECT 1; -- pick", "SELECT 1;;"])
def test_no_terminating_semicolon_reaches_the_driver_unlimited(connector, raw):
    connector.query(raw)
    (executed,) = connector.connection.executed
    assert not executed.rstrip().endswith(";")
    assert executed == "SELECT 1"


@pytest.mark.parametrize("raw", ["SELECT 1;", "SELECT 1; -- pick"])
def test_no_terminating_semicolon_inside_the_rownum_wrap(connector, raw):
    connector.query(raw, limit=10)
    (executed,) = connector.connection.executed
    # The whole point of the wrap: a `;` inside `SELECT * FROM (...)` is rejected.
    assert ";" not in executed.split(") t WHERE")[0]
    assert executed.startswith("SELECT * FROM (\nSELECT 1\n)")


def test_semicolon_inside_a_string_literal_is_still_preserved(connector):
    connector.query("SELECT 'a;b' AS x;")
    (executed,) = connector.connection.executed
    assert executed == "SELECT 'a;b' AS x"


def test_the_connector_uses_its_own_dialect_for_the_strip(connector):
    # Backslash escapes are lexical, not universal: with the oracle dialect the
    # tokenizer still reports the trailing `;` as terminating.
    connector.dialect = "oracle"
    connector.query(r"SELECT 'it\'s' AS x;")
    (executed,) = connector.connection.executed
    assert executed == r"SELECT 'it\'s' AS x"
