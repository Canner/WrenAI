"""Unit tests for ``wren.connector.clickhouse`` URL parsing and query wrapping.

Pure-Python — no Docker, no real ClickHouse instance.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pyarrow as pa
import pytest

from wren.connector.clickhouse import (
    ClickHouseConnector,
    _build_clickhouse_arrow_table,
    _build_clickhouse_client_kwargs,
    _parse_clickhouse_type,
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


# ---------------------------------------------------------------------------
# 4. Nullable(...) and LowCardinality(...) type parsing
#
# Regression for Canner/WrenAI#2184: Nullable(T) columns were mapped to
# UNKNOWN in older ibis-server; the current SDK uses sqlglot which strips
# the Nullable wrapper automatically. These tests prevent silent regressions.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "type_str, expected",
    [
        # Core Nullable cases from the bug report
        ("Nullable(String)", pa.string()),
        ("Nullable(Int32)", pa.int32()),
        ("Nullable(Int64)", pa.int64()),
        ("Nullable(UInt32)", pa.uint32()),
        ("Nullable(Float32)", pa.float32()),
        ("Nullable(Float64)", pa.float64()),
        ("Nullable(DateTime)", pa.timestamp("ns")),
        ("Nullable(Date)", pa.date32()),
        ("Nullable(Decimal(18, 4))", pa.decimal128(38, 9)),
        ("Nullable(UUID)", pa.string()),
        # LowCardinality — storage-only hint, inner type must be preserved
        ("LowCardinality(String)", pa.string()),
        ("LowCardinality(Nullable(String))", pa.string()),
        ("LowCardinality(Nullable(Int64))", pa.int64()),
        # Nested: Array of Nullable elements
        ("Array(Nullable(Int32))", pa.list_(pa.int32())),
        # None input falls back to string (driver returns null descriptor)
        (None, pa.string()),
    ],
)
def test_parse_clickhouse_type_nullable(
    type_str: str | None, expected: pa.DataType
) -> None:
    """Nullable(T) and LowCardinality(T) wrappers must resolve to the inner type."""
    assert _parse_clickhouse_type(type_str) == expected


def test_clickhouse_arrow_table_nullable_columns_preserve_none_values() -> None:
    """Nullable columns must round-trip None through _build_clickhouse_arrow_table.

    Verifies that the correct Arrow type is inferred from the type descriptor
    and that None values in the result rows are preserved as null, not coerced
    to a sentinel or dropped.
    """
    fake = MagicMock()
    fake.column_names = ["id", "name", "score"]
    fake.column_types = [
        _FakeChType("Nullable(Int32)"),
        _FakeChType("Nullable(String)"),
        _FakeChType("Nullable(Float64)"),
    ]
    fake.result_rows = [
        [1, "Alice", 9.5],
        [None, "Bob", None],
        [3, None, 7.0],
    ]

    table = _build_clickhouse_arrow_table(fake)

    assert table.schema.field("id").type == pa.int32()
    assert table.schema.field("name").type == pa.string()
    assert table.schema.field("score").type == pa.float64()

    assert table.column("id").to_pylist() == [1, None, 3]
    assert table.column("name").to_pylist() == ["Alice", "Bob", None]
    assert table.column("score").to_pylist() == [9.5, None, 7.0]


# ---------------------------------------------------------------------------
# 5. Default port tracks the effective ``secure`` value (connection_url branch)
#
# Regression for Canner/WrenAI#2412 / #2416: the port-less default must follow
# the *effective* TLS setting (kwargs > query param > scheme), not the scheme
# alone, and string overrides like ``?secure=false`` must not be truthy.
# ---------------------------------------------------------------------------


class TestClickHouseUrlKwargs:
    """Pure-Python tests for the ``connection_url`` branch of the kwargs builder."""

    def test_https_url_without_port_uses_secure_default_port(self) -> None:
        """A port-less clickhouse+https URL must dial 8443 (TLS), not 8123.

        ClickHouse serves HTTPS on 8443 and plaintext HTTP on 8123. Defaulting
        an https URL to 8123 while also setting ``secure=True`` made the TLS
        client connect to the plaintext listener — the handshake fails.
        """
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl("clickhouse+https://user:pw@host/db")
        )
        assert out["secure"] is True
        assert out["port"] == 8443

    def test_http_url_without_port_uses_plaintext_default_port(self) -> None:
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl("clickhouse+http://user:pw@host/db")
        )
        assert "secure" not in out
        assert out["port"] == 8123

    def test_explicit_port_is_respected_for_https(self) -> None:
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl("clickhouse+https://user:pw@host:9440/db")
        )
        assert out["secure"] is True
        assert out["port"] == 9440

    # --- secure enabled after the scheme is inspected (#2416) ---------------

    def test_secure_query_param_uses_secure_default_port(self) -> None:
        """``?secure=true`` on a plain scheme must dial 8443, not 8123.

        The scheme alone said plaintext, so the old code picked 8123 — then
        ``secure=True`` arrived via the query string and the TLS handshake
        hit the plaintext listener.
        """
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl("clickhouse://user:pw@host/db?secure=true")
        )
        assert out["secure"] is True
        assert out["port"] == 8443

    def test_secure_kwargs_override_uses_secure_default_port(self) -> None:
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl(
                "clickhouse://user:pw@host/db", kwargs={"secure": True}
            )
        )
        assert out["secure"] is True
        assert out["port"] == 8443

    def test_secure_false_query_param_uses_plaintext_default_port(self) -> None:
        """``?secure=false`` must not be truthy just because it is a string."""
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl("clickhouse+https://user:pw@host/db?secure=false")
        )
        assert "secure" not in out
        assert out["port"] == 8123

    def test_secure_false_kwargs_override_uses_plaintext_default_port(self) -> None:
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl(
                "clickhouse+https://user:pw@host/db", kwargs={"secure": False}
            )
        )
        assert "secure" not in out
        assert out["port"] == 8123

    def test_explicit_port_wins_over_secure_query_param(self) -> None:
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl("clickhouse://user:pw@host:9000/db?secure=true")
        )
        assert out["secure"] is True
        assert out["port"] == 9000

    def test_explicit_port_wins_over_secure_false_override(self) -> None:
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl(
                "clickhouse+https://user:pw@host:9440/db", kwargs={"secure": "false"}
            )
        )
        assert "secure" not in out
        assert out["port"] == 9440

    def test_secure_kwargs_win_over_query_param(self) -> None:
        """kwargs are merged after query params, so they take precedence."""
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl(
                "clickhouse://user:pw@host/db?secure=true", kwargs={"secure": False}
            )
        )
        assert "secure" not in out
        assert out["port"] == 8123

    @pytest.mark.parametrize("raw", ["1", "true", "TRUE", "yes", "on"])
    def test_truthy_secure_strings(self, raw: str) -> None:
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl(f"clickhouse://user:pw@host/db?secure={raw}")
        )
        assert out["secure"] is True
        assert out["port"] == 8443

    @pytest.mark.parametrize("raw", ["0", "false", "FALSE", "no", "off", ""])
    def test_falsy_secure_strings(self, raw: str) -> None:
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl(
                "clickhouse+https://user:pw@host/db", kwargs={"secure": raw}
            )
        )
        assert "secure" not in out
        assert out["port"] == 8123

    def test_blank_secure_query_param_is_a_falsy_override(self) -> None:
        """``?secure=`` must reach the override handling, not be dropped.

        ``parse_qsl`` discards blank values by default, which silently turned
        ``?secure=`` into "unspecified". Blank is falsy, like everywhere else
        in ``_parse_secure_flag``.
        """
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl("clickhouse+https://user:pw@host/db?secure=")
        )
        assert "secure" not in out
        assert out["port"] == 8123

    def test_blank_statement_timeout_query_param_is_ignored(self) -> None:
        """``?statement_timeout=`` is treated as absent, not ``int("")``."""
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl("clickhouse://user:pw@host/db?statement_timeout=")
        )
        assert out["settings"] == {}
        assert "statement_timeout" not in out

    def test_blank_unhandled_query_param_is_dropped(self) -> None:
        """``?connect_timeout=`` must not reach the client kwargs as ``""``.

        ``keep_blank_values`` exists so ``?secure=`` / ``?statement_timeout=``
        can act as explicit "unset" overrides; every other blank param keeps
        the old dropped behaviour instead of leaking ``key=""`` into
        ``clickhouse_connect.get_client``.
        """
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl("clickhouse://user:pw@host/db?connect_timeout=")
        )
        assert "connect_timeout" not in out

    def test_non_blank_query_param_passes_through(self) -> None:
        out = _build_clickhouse_client_kwargs(
            _FakeConnInfoFromUrl("clickhouse://user:pw@host/db?connect_timeout=10")
        )
        assert out["connect_timeout"] == "10"
