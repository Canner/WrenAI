"""Trailing-semicolon stripping for the DataFusion connector (mocked ctx).

The DataFusion connector wraps user SQL as ``SELECT * FROM (...) AS _q LIMIT N``
when a limit is supplied. If the user SQL ends in a semicolon, DataFusion
rejects ``SELECT 1;`` inside a subquery
(``sql parser error: Expected: an expression, found: ;``). These tests use a
mocked ``ctx`` and assert on the SQL string the connector builds, so no native
runtime file registration is required. Mirrors the postgres/redshift/duckdb
connector semicolon tests.
"""

from unittest.mock import MagicMock

import pyarrow as pa
import pyarrow.ipc as ipc

from wren.connector.datafusion import (
    DataFusionConnector,
    _strip_trailing_semicolon,
)


def _make_mock_connector() -> tuple[DataFusionConnector, MagicMock]:
    """Build a DataFusionConnector bypassing __init__ (no real runtime)."""
    connector = DataFusionConnector.__new__(DataFusionConnector)
    ctx = MagicMock()

    # ctx.query must return IPC-stream bytes that read back into a table.
    empty = pa.table({"x": pa.array([], type=pa.int64())})
    sink = pa.BufferOutputStream()
    with ipc.new_stream(sink, empty.schema) as writer:
        writer.write_table(empty)
    ctx.query.return_value = sink.getvalue().to_pybytes()

    connector.ctx = ctx
    return connector, ctx


def test_query_strips_trailing_semicolon_before_subquery_wrap() -> None:
    connector, ctx = _make_mock_connector()
    connector.query("SELECT 1;", limit=5)
    (sent,), _ = ctx.query.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _q LIMIT 5"
    assert ";)" not in sent


def test_query_without_limit_is_unwrapped() -> None:
    connector, ctx = _make_mock_connector()
    connector.query("SELECT 1;")
    (sent,), _ = ctx.query.call_args
    # No limit -> no subquery wrapping; passed through verbatim.
    assert sent == "SELECT 1"


def test_helper_preserves_semicolon_inside_string_literal() -> None:
    sql = "SELECT 'a;b' AS x"
    assert _strip_trailing_semicolon(sql) == sql


def test_helper_no_trailing_semicolon_unchanged() -> None:
    assert _strip_trailing_semicolon("SELECT 1") == "SELECT 1"


def test_query_without_limit_strips_trailing_semicolon() -> None:
    connector, ctx = _make_mock_connector()
    connector.query("SELECT 1;")
    (sent,), _ = ctx.query.call_args
    assert sent == "SELECT 1"


def test_dry_run_strips_trailing_semicolon() -> None:
    connector, ctx = _make_mock_connector()
    if not hasattr(ctx, "dry_run"):
        ctx.dry_run = MagicMock()
    connector.dry_run("SELECT 1;")
    (sent,), _ = ctx.dry_run.call_args
    assert sent == "SELECT 1"
