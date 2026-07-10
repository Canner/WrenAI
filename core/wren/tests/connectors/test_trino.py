"""Trino connector integration tests.

Integration tests against a real Trino testcontainer that load TPCH from the
built-in ``tpch`` catalog into the in-memory ``memory.default`` schema so the
shared ``WrenQueryTestSuite`` can run against it.

The pure, Docker-free unit tests for the native Trino → Arrow type parser,
column builder, and connection-URL parser live in
``tests/unit/test_trino_parser.py`` so they run in the ``test-unit`` CI job
(this file's top-level ``testcontainers.trino`` import keeps it out of that
job).
"""

from __future__ import annotations

import base64
import time

import orjson
import pyarrow as pa
import pytest
from testcontainers.trino import TrinoContainer

from tests.suite.manifests import make_tpch_manifest
from tests.suite.query import WrenQueryTestSuite
from wren import WrenEngine
from wren.model.data_source import DataSource

pytestmark = pytest.mark.trino

_CATALOG = "memory"
_SCHEMA = "default"


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
