"""Unit tests for ``wren.connector.clickhouse`` URL parsing and query wrapping.

Pure-Python — no Docker, no real ClickHouse instance.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from wren.connector.clickhouse import (
    ClickHouseConnector,
    _build_clickhouse_arrow_table,
    _build_clickhouse_client_kwargs,
)

pytestmark = pytest.mark.unit


class _FakeConnUrl:
    def __init__(self, url: str) -> None:
        self._url = url

    def get_secret_value(self) -> str:
        return self._url


class _FakeConnInfoFromUrl:
    """Minimal stand-in for ConnectionUrl payloads accepted by the builder."""

    def __init__(self, url: str, **extras) -> None:
        self.connection_url = _FakeConnUrl(url)
        self.kwargs = extras.get("kwargs")


# ---------------------------------------------------------------------------
# 1. URL credentials are percent-decoded
# ---------------------------------------------------------------------------


def test_clickhouse_url_decodes_username_and_password() -> None:
    """user / password from the URL must be unquote_plus'd.

    urlparse leaves ``%40`` (``@``) and ``%20`` (space) literal in the
    userinfo, which would otherwise reach ClickHouse verbatim and fail auth.
    """
    info = _FakeConnInfoFromUrl(
        "clickhouse://us%40er:p%40ss%20word@clickhouse-host:9000/analytics"
    )

    out = _build_clickhouse_client_kwargs(info)

    assert out["username"] == "us@er"
    assert out["password"] == "p@ss word"
    assert out["host"] == "clickhouse-host"
    assert out["port"] == 9000
    assert out["database"] == "analytics"


def test_clickhouse_url_defaults_username_when_omitted() -> None:
    """When the URL has no userinfo, the default ``"default"`` user wins."""
    info = _FakeConnInfoFromUrl("clickhouse://clickhouse-host/analytics")

    out = _build_clickhouse_client_kwargs(info)

    assert out["username"] == "default"
    assert out["password"] == ""


# ---------------------------------------------------------------------------
# 2. Trailing semicolons in caller SQL must not break the subquery wrap
# ---------------------------------------------------------------------------


def _make_connector_with_mock_query() -> tuple[ClickHouseConnector, MagicMock]:
    """Build a ClickHouseConnector bypassing ``__init__`` (no real client)."""
    connector = ClickHouseConnector.__new__(ClickHouseConnector)
    connector._closed = False
    connector.connection = MagicMock()
    # ``query()`` consumes the returned object via ``_build_clickhouse_arrow_table``;
    # arrange a minimal result that produces an empty Arrow table.
    fake_result = MagicMock()
    fake_result.column_names = []
    fake_result.column_types = []
    fake_result.result_columns = []
    connector.connection.query.return_value = fake_result
    return connector, connector.connection


def test_clickhouse_query_strips_trailing_semicolon_before_subquery_wrap() -> None:
    """``SELECT 1;`` must not become ``SELECT * FROM (SELECT 1;) ...``."""
    connector, mock_conn = _make_connector_with_mock_query()

    connector.query("SELECT 1;", limit=5)

    (sent,), _ = mock_conn.query.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _wren_sub LIMIT 5"


def test_clickhouse_query_strips_multiple_trailing_semicolons_and_whitespace() -> None:
    """Trailing whitespace and a stray ``;`` both get trimmed."""
    connector, mock_conn = _make_connector_with_mock_query()

    connector.query("SELECT 1 ;  ", limit=3)

    (sent,), _ = mock_conn.query.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _wren_sub LIMIT 3"


def test_clickhouse_query_without_limit_still_strips_semicolon() -> None:
    """When no limit is supplied the executed SQL is also the stripped form."""
    connector, mock_conn = _make_connector_with_mock_query()

    connector.query("SELECT 1;")

    (sent,), _ = mock_conn.query.call_args
    assert sent == "SELECT 1"


def test_clickhouse_dry_run_strips_trailing_semicolon() -> None:
    """Same fix must apply to dry_run, which also wraps in a subquery."""
    connector, mock_conn = _make_connector_with_mock_query()

    connector.dry_run("SELECT 1;")

    (sent,), _ = mock_conn.query.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _wren_sub LIMIT 0"


# ---------------------------------------------------------------------------
# 3. Duplicate column names survive ``_build_clickhouse_arrow_table``
# ---------------------------------------------------------------------------


class _FakeChType:
    def __init__(self, name: str) -> None:
        self.name = name


def test_clickhouse_arrow_table_preserves_duplicate_column_names() -> None:
    """``SELECT a, a`` must yield a two-column Arrow table, not one column.

    Earlier the table was built via ``dict(zip(names, arrays))`` which
    silently collapsed duplicate names.
    """
    fake = MagicMock()
    fake.column_names = ["a", "a"]
    fake.column_types = [_FakeChType("Int64"), _FakeChType("Int64")]
    fake.result_rows = [[1, 2], [3, 4]]

    table = _build_clickhouse_arrow_table(fake)

    assert table.num_columns == 2
    assert table.column_names == ["a", "a"]
    assert table.column(0).to_pylist() == [1, 3]
    assert table.column(1).to_pylist() == [2, 4]
