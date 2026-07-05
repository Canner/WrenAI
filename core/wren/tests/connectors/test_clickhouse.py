"""ClickHouse connector tests.

Uses ``testcontainers`` to spin up a real ClickHouse instance. TPCH-shaped
fixture data is fabricated inline in Python (no network downloads) and loaded
over the native ``clickhouse-connect`` HTTP client.
"""

from __future__ import annotations

import base64
import datetime as _dt
import time

import orjson
import pytest
from testcontainers.core.container import DockerContainer

from tests.suite.manifests import make_tpch_manifest
from tests.suite.query import WrenQueryTestSuite
from wren import WrenEngine
from wren.connector.clickhouse import (
    _build_clickhouse_client_kwargs,
    _parse_clickhouse_type,
)
from wren.model.data_source import DataSource

pytestmark = pytest.mark.clickhouse

_SCHEMA = "default"
_ORDER_COUNT = 15000
_CUSTOMER_COUNT = 1500
_ORDER_STATUSES = ("O", "F", "P")
_BASE_DATE = _dt.date(1992, 1, 1)


def _make_fixture_rows() -> tuple[list[tuple], list[tuple]]:
    """Fabricate TPCH-shaped orders + customer rows without network access.

    Row counts match TPCH sf=0.01 so the shared ``WrenQueryTestSuite``
    assertions (15000 orders, 1500 customers, first orderkey == 1) hold.
    """
    customers = [(i, f"Customer#{i:09d}") for i in range(1, _CUSTOMER_COUNT + 1)]
    orders = [
        (
            i,
            ((i - 1) % _CUSTOMER_COUNT) + 1,
            _ORDER_STATUSES[i % len(_ORDER_STATUSES)],
            float(100 + i),
            _BASE_DATE + _dt.timedelta(days=i % 3650),
        )
        for i in range(1, _ORDER_COUNT + 1)
    ]
    return orders, customers


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
        client = None
        try:
            client = clickhouse_connect.get_client(
                host=host, port=port, username="default", password=""
            )
            client.query("SELECT 1")
            return
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1)
        finally:
            if client is not None:
                client.close()
    raise RuntimeError(f"ClickHouse did not become ready: {last_err}")


def _load_tpch(host: str, port: int) -> None:
    """Bulk-load fabricated TPCH-shaped data into ClickHouse."""
    import clickhouse_connect  # noqa: PLC0415

    orders_rows, customer_rows = _make_fixture_rows()

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


class _FakeChInfo:
    """Stand-in for ``ClickHouseConnectionInfo`` used by the kwargs builder.

    Pydantic enforces ``kwargs: dict[str, str]`` on the real model, so we
    bypass it here to exercise the merge logic with nested ``settings``.
    ``_build_clickhouse_client_kwargs`` only reads attributes off the object.
    """

    def __init__(self, **attrs) -> None:
        self.host = attrs.get("host", "localhost")
        self.port = attrs.get("port", "8123")
        self.database = attrs.get("database", "default")
        self.user = attrs.get("user", "default")
        self.password = attrs.get("password")
        self.secure = attrs.get("secure", False)
        self.settings = attrs.get("settings")
        self.kwargs = attrs.get("kwargs")


@pytest.mark.clickhouse
class TestClickHouseClientKwargs:
    """Pure-Python tests for ``_build_clickhouse_client_kwargs``.

    Exercises the kwargs/settings merge logic without spinning up a real
    ClickHouse instance.
    """

    def test_statement_timeout_survives_user_settings(self) -> None:
        """statement_timeout must merge with — not be clobbered by — user settings."""
        info = _FakeChInfo(
            kwargs={
                "statement_timeout": 10,
                "settings": {"max_threads": 4},
            },
        )
        out = _build_clickhouse_client_kwargs(info)
        assert out["settings"] == {
            "max_execution_time": 10,
            "max_threads": 4,
        }

    def test_user_settings_only(self) -> None:
        info = _FakeChInfo(kwargs={"settings": {"max_threads": 4}})
        out = _build_clickhouse_client_kwargs(info)
        assert out["settings"] == {"max_threads": 4}

    def test_statement_timeout_only(self) -> None:
        info = _FakeChInfo(kwargs={"statement_timeout": 10})
        out = _build_clickhouse_client_kwargs(info)
        assert out["settings"] == {"max_execution_time": 10}
