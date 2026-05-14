"""ClickHouse connector tests.

Uses ``testcontainers`` to spin up a real ClickHouse instance.
TPCH data is generated via DuckDB's built-in extension and loaded over
the native ``clickhouse-connect`` HTTP client.
"""

from __future__ import annotations

import base64
import time

import duckdb
import orjson
import pytest
from testcontainers.core.container import DockerContainer

from tests.suite.manifests import make_tpch_manifest
from tests.suite.query import WrenQueryTestSuite
from wren import WrenEngine
from wren.connector.clickhouse import _parse_clickhouse_type
from wren.model.data_source import DataSource

pytestmark = pytest.mark.clickhouse

_SCHEMA = "default"


class _ClickHouseContainer(DockerContainer):
    """Minimal ClickHouse container wrapper — exposes HTTP port 8123."""

    def __init__(self, image: str = "clickhouse/clickhouse-server:24.3-alpine"):
        super().__init__(image)
        self.with_exposed_ports(8123, 9000)
        # Use the default tcp_port_secure-free defaults; no auth.
        self.with_env("CLICKHOUSE_DB", _SCHEMA)
        self.with_env("CLICKHOUSE_USER", "default")
        self.with_env("CLICKHOUSE_PASSWORD", "")
        # Allow empty password (the default user already has it; this is for
        # any user clickhouse-connect tries to authenticate as).
        self.with_env("CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT", "1")

    def start(self):  # type: ignore[override]
        super().start()
        # The alpine image redirects ClickHouse logs to file, so we cannot rely
        # on ``wait_for_logs``. ``_wait_for_http_ready`` polls the HTTP endpoint
        # instead.
        return self

    def get_host_ip(self) -> str:
        return self.get_container_host_ip()

    def get_http_port(self) -> int:
        return int(self.get_exposed_port(8123))


def _wait_for_http_ready(host: str, port: int, timeout: float = 120.0) -> None:
    """Poll the ClickHouse HTTP endpoint until it responds to a trivial query."""
    import clickhouse_connect  # noqa: PLC0415

    deadline = time.time() + timeout
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            client = clickhouse_connect.get_client(
                host=host, port=port, username="default", password=""
            )
            client.query("SELECT 1")
            client.close()
            return
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1)
    raise RuntimeError(f"ClickHouse did not become ready: {last_err}")


def _load_tpch(host: str, port: int) -> None:
    """Generate TPCH sf=0.01 via DuckDB and bulk-load into ClickHouse."""
    import clickhouse_connect  # noqa: PLC0415

    with duckdb.connect() as duck:
        duck.execute("INSTALL tpch; LOAD tpch; CALL dbgen(sf=0.01)")
        orders_rows = duck.execute(
            "SELECT o_orderkey, o_custkey, o_orderstatus, "
            "cast(o_totalprice as double), o_orderdate FROM orders"
        ).fetchall()
        customer_rows = duck.execute(
            "SELECT c_custkey, c_name FROM customer"
        ).fetchall()

    client = clickhouse_connect.get_client(
        host=host, port=port, username="default", password="", database=_SCHEMA
    )
    try:
        client.command(
            "CREATE TABLE IF NOT EXISTS orders ("
            "  o_orderkey    Int32,"
            "  o_custkey     Int32,"
            "  o_orderstatus String,"
            "  o_totalprice  Float64,"
            "  o_orderdate   Date"
            ") ENGINE = MergeTree ORDER BY o_orderkey"
        )
        client.command(
            "CREATE TABLE IF NOT EXISTS customer ("
            "  c_custkey Int32,"
            "  c_name    String"
            ") ENGINE = MergeTree ORDER BY c_custkey"
        )
        client.insert(
            "orders",
            orders_rows,
            column_names=[
                "o_orderkey",
                "o_custkey",
                "o_orderstatus",
                "o_totalprice",
                "o_orderdate",
            ],
        )
        client.insert("customer", customer_rows, column_names=["c_custkey", "c_name"])
    finally:
        client.close()


class TestClickHouse(WrenQueryTestSuite):
    manifest = make_tpch_manifest(table_catalog=None, table_schema=_SCHEMA)
    # ClickHouse `Int32` round-trips to Arrow as ``int32`` via the native
    # connector's sqlglot-driven type mapping.
    order_id_dtype = "int32"

    @pytest.fixture(scope="class")
    def engine(self) -> WrenEngine:  # type: ignore[override]
        with _ClickHouseContainer() as ch:
            host = ch.get_host_ip()
            port = ch.get_http_port()
            _wait_for_http_ready(host, port)
            _load_tpch(host, port)

            conn_info = {
                "host": host,
                "port": port,
                "database": _SCHEMA,
                "user": "default",
                "password": "",
            }
            manifest_str = base64.b64encode(orjson.dumps(self.manifest)).decode()
            with WrenEngine(
                manifest_str, DataSource.clickhouse, conn_info, fallback=False
            ) as e:
                yield e


@pytest.mark.clickhouse
class TestClickHouseTypeParser:
    """Pure-Python tests for the ClickHouse type-string → Arrow mapping.

    Runs without Docker — exercises ``_parse_clickhouse_type`` directly.
    """

    @pytest.mark.parametrize(
        ("type_str", "expected"),
        [
            ("String", "string"),
            ("FixedString(8)", "string"),
            ("Int8", "int8"),
            ("Int16", "int16"),
            ("Int32", "int32"),
            ("Int64", "int64"),
            ("UInt8", "uint8"),
            ("UInt16", "uint16"),
            ("UInt32", "uint32"),
            ("UInt64", "uint64"),
            ("Int128", "string"),
            ("Int256", "string"),
            ("UInt128", "string"),
            ("UInt256", "string"),
            ("Float32", "float"),
            ("Float64", "double"),
            ("Bool", "bool"),
            ("UUID", "string"),
            ("IPv4", "string"),
            ("IPv6", "string"),
            ("Date", "date32[day]"),
            ("Date32", "date32[day]"),
            ("DateTime", "timestamp[ns]"),
            ("Decimal(18, 4)", "decimal128(38, 9)"),
            ("Nullable(Int32)", "int32"),
            ("Nullable(String)", "string"),
            ("LowCardinality(String)", "string"),
            ("LowCardinality(Nullable(String))", "string"),
            ("Array(Int32)", "list<item: int32>"),
            ("Array(Nullable(String))", "list<item: string>"),
            ("Map(String, Int32)", "map<string, int32>"),
            ("Tuple(a Int32, b String)", "string"),
            ("Enum8('a' = 1, 'b' = 2)", "string"),
        ],
    )
    def test_type_parse(self, type_str: str, expected: str) -> None:
        result = _parse_clickhouse_type(type_str)
        assert str(result) == expected

    def test_datetime64_with_tz(self) -> None:
        result = _parse_clickhouse_type("DateTime64(3, 'UTC')")
        assert str(result) == "timestamp[ns, tz=UTC]"

    def test_datetime_with_tz(self) -> None:
        result = _parse_clickhouse_type("DateTime('Asia/Taipei')")
        assert str(result) == "timestamp[ns, tz=Asia/Taipei]"

    def test_unknown_type_defaults_to_string(self) -> None:
        result = _parse_clickhouse_type("SomethingExotic")
        assert str(result) == "string"

    def test_none_type_defaults_to_string(self) -> None:
        result = _parse_clickhouse_type(None)
        assert str(result) == "string"
