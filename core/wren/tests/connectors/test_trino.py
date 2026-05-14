"""Trino connector tests.

Combines:
1. Unit-level type parser tests for the native Trino → Arrow mapping (no Docker).
2. Integration tests against a real Trino testcontainer that load TPCH from
   the built-in ``tpch`` catalog into the in-memory ``memory.default`` schema
   so the shared ``WrenQueryTestSuite`` can run against it.
"""

from __future__ import annotations

import base64
import time
from decimal import Decimal

import orjson
import pyarrow as pa
import pytest
from testcontainers.trino import TrinoContainer

from tests.suite.manifests import make_tpch_manifest
from tests.suite.query import WrenQueryTestSuite
from wren import WrenEngine
from wren.connector.trino import (
    _build_trino_column,
    _parse_trino_data_type,
    _parse_trino_url,
    _strip_trailing_semicolon,
)
from wren.model.data_source import DataSource
from wren.model.error import ErrorCode, WrenError

pytestmark = pytest.mark.trino

_CATALOG = "memory"
_SCHEMA = "default"


# ---------------------------------------------------------------------------
# Unit tests — type-string parser and column builder (no Docker required).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("type_str", "expected"),
    [
        # Scalars
        ("boolean", pa.bool_()),
        ("tinyint", pa.int8()),
        ("smallint", pa.int16()),
        ("integer", pa.int32()),
        ("int", pa.int32()),
        ("bigint", pa.int64()),
        ("real", pa.float32()),
        ("double", pa.float64()),
        ("varchar", pa.string()),
        ("varchar(255)", pa.string()),
        ("char(10)", pa.string()),
        ("varbinary", pa.binary()),
        ("date", pa.date32()),
        ("uuid", pa.string()),
        ("ipaddress", pa.string()),
        ("json", pa.string()),
        # Decimal
        ("decimal(10,2)", pa.decimal128(10, 2)),
        ("decimal(38,9)", pa.decimal128(38, 9)),
        ("decimal", pa.decimal128(38, 9)),
        # Time / timestamp
        ("time", pa.time64("us")),
        ("time(3)", pa.time64("us")),
        ("timestamp", pa.timestamp("ms")),
        ("timestamp(6)", pa.timestamp("ms")),
        ("timestamp with time zone", pa.timestamp("ms", tz="UTC")),
        ("timestamp(6) with time zone", pa.timestamp("ms", tz="UTC")),
        # Containers
        ("array(integer)", pa.list_(pa.int32())),
        ("array(decimal(10,2))", pa.list_(pa.decimal128(10, 2))),
        ("array(varchar)", pa.list_(pa.string())),
        # Map
        ("map(varchar,bigint)", pa.map_(pa.string(), pa.int64())),
        ("map(varchar, bigint)", pa.map_(pa.string(), pa.int64())),
        # Row — named and anonymous
        (
            "row(a integer, b varchar)",
            pa.struct([pa.field("a", pa.int32()), pa.field("b", pa.string())]),
        ),
        (
            "row(map(varchar, integer), bigint)",
            pa.struct(
                [
                    pa.field("f0", pa.map_(pa.string(), pa.int32())),
                    pa.field("f1", pa.int64()),
                ]
            ),
        ),
        # Nested array(map(varchar, row(...)))
        (
            "array(map(varchar, row(a integer, b varchar)))",
            pa.list_(
                pa.map_(
                    pa.string(),
                    pa.struct(
                        [
                            pa.field("a", pa.int32()),
                            pa.field("b", pa.string()),
                        ]
                    ),
                )
            ),
        ),
        # Unknown / interval — fall back to string
        ("interval year to month", pa.string()),
        ("interval day to second", pa.string()),
        ("hyperloglog", pa.string()),
    ],
)
def test_parse_trino_data_type(type_str: str, expected: pa.DataType) -> None:
    assert _parse_trino_data_type(type_str) == expected


def test_parse_trino_data_type_handles_none() -> None:
    assert _parse_trino_data_type(None) == pa.string()


def test_parse_trino_data_type_unparseable_falls_back() -> None:
    assert _parse_trino_data_type("not a real type {{") == pa.string()


def test_build_trino_column_map_dict_to_pairs() -> None:
    # Trino driver returns Python dicts; PyArrow map_ wants (k, v) pairs.
    arrow_type = pa.map_(pa.string(), pa.int64())
    arr = _build_trino_column([{"a": 1, "b": 2}, None, {"x": 9}], arrow_type)
    assert arr.type == arrow_type
    assert arr.to_pylist() == [
        [("a", 1), ("b", 2)],
        None,
        [("x", 9)],
    ]


def test_build_trino_column_decimal_string_input() -> None:
    arr = _build_trino_column(["1.23", "4.56", None], pa.decimal128(10, 2))
    assert arr.to_pylist() == [Decimal("1.23"), Decimal("4.56"), None]


def test_build_trino_column_struct_tuple_to_dict() -> None:
    arrow_type = pa.struct([pa.field("a", pa.int32()), pa.field("b", pa.string())])
    arr = _build_trino_column([(1, "x"), None, (2, "y")], arrow_type)
    assert arr.to_pylist() == [{"a": 1, "b": "x"}, None, {"a": 2, "b": "y"}]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("SELECT 1", "SELECT 1"),
        ("SELECT 1;", "SELECT 1"),
        ("SELECT 1  ;  ", "SELECT 1"),
        ("SELECT 1\n;\n", "SELECT 1"),
        ("SELECT 1; -- trailing", "SELECT 1; -- trailing"),
        # Only the final semicolon is stripped — internal ones stay.
        ("SELECT 1; SELECT 2;", "SELECT 1; SELECT 2"),
    ],
)
def test_strip_trailing_semicolon(raw: str, expected: str) -> None:
    assert _strip_trailing_semicolon(raw) == expected


def test_parse_trino_url_rejects_missing_username() -> None:
    with pytest.raises(WrenError) as exc:
        _parse_trino_url("trino://host:8080/catalog/schema", None)
    assert exc.value.error_code == ErrorCode.INVALID_CONNECTION_INFO
    assert "username" in str(exc.value).lower()


def test_parse_trino_url_accepts_explicit_username() -> None:
    out = _parse_trino_url("trino://alice@host:8080/catalog/schema", None)
    assert out["user"] == "alice"
    assert out["host"] == "host"
    assert out["catalog"] == "catalog"
    assert out["schema"] == "schema"


def test_parse_trino_url_rejects_bad_scheme() -> None:
    with pytest.raises(WrenError) as exc:
        _parse_trino_url("http://alice@host:8080/c/s", None)
    assert exc.value.error_code == ErrorCode.INVALID_CONNECTION_INFO


def test_trino_connector_import_error_has_install_hint(monkeypatch) -> None:
    """If ``import trino`` fails, the connector should raise a WrenError with
    a clear ``pip install wren-engine[trino]`` hint rather than a raw
    ImportError.
    """
    import builtins  # noqa: PLC0415
    import sys  # noqa: PLC0415

    from wren.connector import trino as trino_module  # noqa: PLC0415

    # Remove cached trino module so the lazy import re-runs.
    monkeypatch.setitem(sys.modules, "trino", None)
    real_import = builtins.__import__

    def _fake_import(name, *args, **kwargs):
        if name == "trino" or name.startswith("trino."):
            raise ImportError("No module named 'trino'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _fake_import)

    with pytest.raises(WrenError) as exc:
        trino_module._import_trino()
    assert exc.value.error_code == ErrorCode.INVALID_CONNECTION_INFO
    msg = str(exc.value)
    assert "wren-engine[trino]" in msg


def test_native_connector_does_not_import_ibis() -> None:
    # Acceptance criterion: importing the native trino connector must not
    # pull ibis into sys.modules (the new module is independent of
    # ibis-framework[trino]).
    import sys  # noqa: PLC0415

    sys.modules.pop("ibis", None)
    sys.modules.pop("wren.connector.trino", None)
    import wren.connector.trino  # noqa: F401, PLC0415

    assert "ibis" not in sys.modules


# ---------------------------------------------------------------------------
# Integration tests — testcontainer-backed query suite.
# ---------------------------------------------------------------------------


def _create_tpch_tables(host: str, port: int) -> None:
    """Materialise TPCH ``orders`` / ``customer`` into ``memory.default``.

    Trino's bundled ``tpch`` connector provides scale-factor data on demand,
    so we just copy the rows we need into the in-memory catalog rather than
    generating them with DuckDB.
    """
    from trino.dbapi import connect as trino_connect  # noqa: PLC0415

    conn = trino_connect(host=host, port=port, user="test")
    try:
        cur = conn.cursor()
        cur.execute(
            "CREATE TABLE memory.default.orders AS "
            "SELECT orderkey AS o_orderkey, custkey AS o_custkey, "
            "orderstatus AS o_orderstatus, "
            "CAST(totalprice AS DOUBLE) AS o_totalprice, "
            "orderdate AS o_orderdate "
            "FROM tpch.tiny.orders"
        )
        cur.fetchall()
        cur.execute(
            "CREATE TABLE memory.default.customer AS "
            "SELECT custkey AS c_custkey, name AS c_name FROM tpch.tiny.customer"
        )
        cur.fetchall()
    finally:
        conn.close()


class TestTrino(WrenQueryTestSuite):
    """Run the shared connector test suite against a real Trino container."""

    manifest = make_tpch_manifest(table_catalog=_CATALOG, table_schema=_SCHEMA)
    # tpch.tiny is sf=0.01 — same row counts as the other connector tests.
    order_count = 15000
    customer_count = 1500
    # Trino BIGINT → Arrow int64.
    order_id_dtype = "int64"

    @pytest.fixture(scope="class")
    def engine(self) -> WrenEngine:  # type: ignore[override]
        with TrinoContainer() as trino:
            host = trino.get_container_host_ip()
            port = int(trino.get_exposed_port(trino.port))

            # Trino sometimes returns "nodes is empty" if we query before the
            # coordinator has registered a worker; brief wait avoids it.
            time.sleep(5)
            _create_tpch_tables(host, port)

            conn_info = {
                "host": host,
                "port": port,
                "catalog": _CATALOG,
                "schema": _SCHEMA,
                "user": "test",
            }
            manifest_str = base64.b64encode(orjson.dumps(self.manifest)).decode()
            with WrenEngine(
                manifest_str, DataSource.trino, conn_info, fallback=False
            ) as e:
                yield e

    # ------------------------------------------------------------------
    # Trino-specific type coverage — exercises every branch in the native
    # type parser end-to-end against a live coordinator.
    # ------------------------------------------------------------------

    def test_scalar_types(self, engine: WrenEngine) -> None:
        result = engine.query(
            "SELECT "
            "CAST(1 AS BIGINT) AS c_bigint, "
            "CAST(1 AS INTEGER) AS c_integer, "
            "CAST(1 AS SMALLINT) AS c_smallint, "
            "CAST(1 AS TINYINT) AS c_tinyint, "
            "CAST(1.5 AS DOUBLE) AS c_double, "
            "CAST(1.5 AS REAL) AS c_real, "
            "CAST('1.23' AS DECIMAL(10,2)) AS c_decimal, "
            "CAST('abc' AS VARCHAR) AS c_varchar, "
            "CAST('abc' AS CHAR(3)) AS c_char, "
            "CAST(X'AB' AS VARBINARY) AS c_varbinary, "
            "CAST('{\"a\":1}' AS JSON) AS c_json, "
            "CAST('12151fd2-7586-11e9-8f9e-2a86e4085a59' AS UUID) AS c_uuid, "
            "CAST('1.2.3.4' AS IPADDRESS) AS c_ip"
        )
        assert result.num_rows == 1
        assert result.schema.field("c_bigint").type == pa.int64()
        assert result.schema.field("c_integer").type == pa.int32()
        assert result.schema.field("c_smallint").type == pa.int16()
        assert result.schema.field("c_tinyint").type == pa.int8()
        assert result.schema.field("c_double").type == pa.float64()
        assert result.schema.field("c_real").type == pa.float32()
        assert result.schema.field("c_decimal").type == pa.decimal128(10, 2)
        assert result.schema.field("c_varchar").type == pa.string()
        assert result.schema.field("c_char").type == pa.string()
        assert result.schema.field("c_varbinary").type == pa.binary()
        assert result.schema.field("c_json").type == pa.string()
        assert result.schema.field("c_uuid").type == pa.string()
        assert result.schema.field("c_ip").type == pa.string()

    def test_temporal_types(self, engine: WrenEngine) -> None:
        result = engine.query(
            "SELECT "
            "DATE '2024-01-02' AS c_date, "
            "TIME '12:34:56' AS c_time, "
            "TIMESTAMP '2024-01-02 12:34:56' AS c_ts, "
            "TIMESTAMP '2024-01-02 12:34:56 UTC' AS c_tstz"
        )
        assert result.schema.field("c_date").type == pa.date32()
        assert result.schema.field("c_time").type == pa.time64("us")
        assert result.schema.field("c_ts").type == pa.timestamp("ms")
        assert result.schema.field("c_tstz").type == pa.timestamp("ms", tz="UTC")

    def test_array_type(self, engine: WrenEngine) -> None:
        result = engine.query("SELECT ARRAY[1, 2, 3] AS c_array")
        assert result.schema.field("c_array").type == pa.list_(pa.int32())
        assert result["c_array"][0].as_py() == [1, 2, 3]

    def test_map_type(self, engine: WrenEngine) -> None:
        result = engine.query("SELECT MAP(ARRAY['a', 'b'], ARRAY[1, 2]) AS c_map")
        assert result.schema.field("c_map").type == pa.map_(pa.string(), pa.int32())

    def test_row_type(self, engine: WrenEngine) -> None:
        result = engine.query(
            "SELECT CAST(ROW(1, 'x') AS ROW(a INTEGER, b VARCHAR)) AS c_row"
        )
        row_type = result.schema.field("c_row").type
        assert pa.types.is_struct(row_type)
        assert {f.name for f in row_type} == {"a", "b"}

    def test_anonymous_row_type(self, engine: WrenEngine) -> None:
        # Anonymous row(...) result — field names come back as f0/f1.
        result = engine.query("SELECT ROW(1, 'x') AS c_row")
        row_type = result.schema.field("c_row").type
        assert pa.types.is_struct(row_type)
