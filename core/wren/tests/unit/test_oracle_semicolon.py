"""Trailing-semicolon stripping for the Oracle connector (mocked, no live DB).

Both ``OracleConnector.query`` (with a limit) and ``dry_run`` wrap user SQL as
``SELECT * FROM ({sql}) t WHERE ROWNUM <= N``. Oracle rejects a trailing
semicolon inside a subquery (``ORA-00911``). These tests use a mocked cursor
and assert on the executed SQL, so no Oracle connection is required.
"""

from unittest.mock import MagicMock

import pyarrow as pa
import pytest

# The oracle connector imports oracledb at module load; skip cleanly when the
# oracle extra is not installed (e.g. the base unit-test job).
pytest.importorskip("oracledb")

from wren.connector import oracle as oracle_mod  # noqa: E402
from wren.connector.oracle import (  # noqa: E402
    OracleConnector,
    _strip_trailing_semicolon,
)


def _make_mock_connector() -> tuple[OracleConnector, MagicMock]:
    """Build an OracleConnector bypassing __init__ (no real connection)."""
    connector = OracleConnector.__new__(OracleConnector)
    cursor = MagicMock()

    cursor_cm = MagicMock()
    cursor_cm.__enter__.return_value = cursor
    cursor_cm.__exit__.return_value = False

    conn = MagicMock()
    conn.cursor.return_value = cursor_cm
    connector.connection = conn
    return connector, cursor


def test_query_strips_trailing_semicolon_before_subquery_wrap(monkeypatch) -> None:
    connector, cursor = _make_mock_connector()
    monkeypatch.setattr(
        oracle_mod, "_build_oracle_arrow_table", lambda c: pa.table({})
    )
    connector.query("SELECT 1;", limit=5)
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) t WHERE ROWNUM <= 5"
    assert ";)" not in sent


def test_dry_run_strips_trailing_semicolon() -> None:
    connector, cursor = _make_mock_connector()
    connector.dry_run("SELECT 1;  ")
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) t WHERE ROWNUM <= 0"
    assert ";)" not in sent


def test_helper_preserves_semicolon_inside_string_literal() -> None:
    sql = "SELECT 'a;b' AS x"
    assert _strip_trailing_semicolon(sql) == sql


def test_helper_no_trailing_semicolon_unchanged() -> None:
    assert _strip_trailing_semicolon("SELECT 1") == "SELECT 1"
