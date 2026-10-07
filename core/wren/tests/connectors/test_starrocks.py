"""StarRocks connector tests.

Uses ``testcontainers`` to spin up a real single-node StarRocks (FE + BE in one
``allin1-ubuntu`` image). TPCH-shaped fixture data is fabricated inline in
Python (no network downloads) and loaded over the MySQL protocol (FE query port
9030), the same way the connector talks to the server.

The StarRocks-specific tests at the bottom guard the reason ``starrocks`` is its
own data source: SQL must be transpiled with the sqlglot ``starrocks`` dialect,
not ``doris`` (``DATE_TRUNC`` argument order, ``ARRAY_AGG``, ``GROUP_CONCAT``).
"""

from __future__ import annotations

import base64
import datetime as _dt
import json
import time

import orjson
import pytest
from testcontainers.core.container import DockerContainer

from tests.suite.manifests import make_tpch_manifest
from tests.suite.query import WrenQueryTestSuite
from wren import WrenEngine
from wren.model.data_source import DataSource

pytestmark = pytest.mark.starrocks

_IMAGE = "starrocks/allin1-ubuntu:3.5.21"
_DATABASE = "wren_test"
_QUERY_PORT = 9030
_ORDER_COUNT = 15000
_CUSTOMER_COUNT = 1500
_ORDER_STATUSES = ("O", "F", "P")
_BASE_DATE = _dt.date(1992, 1, 1)
_INSERT_BATCH = 1000


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


class _StarRocksContainer(DockerContainer):
    """Minimal single-node StarRocks container — exposes the FE query port."""

    def __init__(self, image: str = _IMAGE):
        super().__init__(image)
        self.with_exposed_ports(_QUERY_PORT)

    def get_host_ip(self) -> str:
        return self.get_container_host_ip()

    def get_query_port(self) -> int:
        return int(self.get_exposed_port(_QUERY_PORT))


def _connect(host: str, port: int, database: str | None = None):
    import MySQLdb  # noqa: PLC0415

    kwargs = {"host": host, "port": port, "user": "root", "passwd": ""}
    if database:
        kwargs["db"] = database
    conn = MySQLdb.connect(**kwargs)
    conn.autocommit(True)
    return conn


def _wait_until_ready(host: str, port: int, timeout: float = 300.0) -> None:
    """Wait for the FE to accept connections and for the BE to register alive.

    The FE answers on 9030 well before a backend is available; creating a table
    before then fails with "no alive backend", so poll ``SHOW BACKENDS``.
    """
    deadline = time.time() + timeout
    last_err: Exception | None = None
    while time.time() < deadline:
        conn = None
        try:
            conn = _connect(host, port)
            cur = conn.cursor()
            cur.execute("SHOW BACKENDS")
            columns = [d[0] for d in cur.description]
            alive = columns.index("Alive")
            rows = cur.fetchall()
            if rows and all(str(r[alive]).lower() == "true" for r in rows):
                return
            last_err = RuntimeError(f"backends not alive yet: {rows!r}")
        except Exception as e:  # noqa: BLE001
            last_err = e
        finally:
            if conn is not None:
                conn.close()
        time.sleep(2)
    raise RuntimeError(f"StarRocks did not become ready: {last_err}")


def _load_tpch(host: str, port: int) -> None:
    """Create the schema and bulk-load fabricated TPCH-shaped data."""
    orders_rows, customer_rows = _make_fixture_rows()

    conn = _connect(host, port)
    try:
        cur = conn.cursor()
        cur.execute(f"CREATE DATABASE IF NOT EXISTS {_DATABASE}")
        cur.execute(f"USE {_DATABASE}")
        cur.execute(
            "CREATE TABLE orders ("
            "  o_orderkey    INT NOT NULL,"
            "  o_custkey     INT NOT NULL,"
            "  o_orderstatus VARCHAR(1) NOT NULL,"
            "  o_totalprice  DOUBLE NOT NULL,"
            "  o_orderdate   DATE NOT NULL"
            ") DUPLICATE KEY (o_orderkey) "
            "DISTRIBUTED BY HASH (o_orderkey) BUCKETS 1 "
            'PROPERTIES ("replication_num" = "1")'
        )
        cur.execute(
            "CREATE TABLE customer ("
            "  c_custkey INT NOT NULL,"
            "  c_name    VARCHAR(25) NOT NULL"
            ") DUPLICATE KEY (c_custkey) "
            "DISTRIBUTED BY HASH (c_custkey) BUCKETS 1 "
            'PROPERTIES ("replication_num" = "1")'
        )
        for i in range(0, len(orders_rows), _INSERT_BATCH):
            cur.executemany(
                "INSERT INTO orders VALUES (%s, %s, %s, %s, %s)",
                orders_rows[i : i + _INSERT_BATCH],
            )
        cur.executemany("INSERT INTO customer VALUES (%s, %s)", customer_rows)
    finally:
        conn.close()


@pytest.fixture(scope="module")
def _starrocks_endpoint():
    """Start StarRocks once per module and load the fixture data."""
    with _StarRocksContainer() as sr:
        host = sr.get_host_ip()
        port = sr.get_query_port()
        _wait_until_ready(host, port)
        _load_tpch(host, port)
        yield host, port


class TestStarRocks(WrenQueryTestSuite):
    manifest = make_tpch_manifest(table_catalog=None, table_schema=_DATABASE)

    @pytest.fixture(scope="class")
    def engine(self, _starrocks_endpoint) -> WrenEngine:  # type: ignore[override]
        host, port = _starrocks_endpoint
        conn_info = {
            "host": host,
            "port": port,
            "database": _DATABASE,
            "user": "root",
            "password": "",
        }
        manifest_str = base64.b64encode(orjson.dumps(self.manifest)).decode()
        with WrenEngine(
            manifest_str, DataSource.starrocks, conn_info, fallback=False
        ) as e:
            yield e

    # ------------------------------------------------------------------
    # StarRocks-specific dialect tests (these fail with the ``doris`` dialect)
    # ------------------------------------------------------------------

    def test_date_trunc_uses_starrocks_argument_order(self, engine: WrenEngine) -> None:
        result = engine.query(
            "SELECT date_trunc('month', o_orderdate) AS m FROM \"orders\" "
            "WHERE o_orderkey = 1"
        )
        assert result.num_rows == 1
        value = result["m"][0].as_py()
        expected = _make_fixture_rows()[0][0][4].replace(day=1)
        # StarRocks returns DATE for a DATE input; tolerate a datetime too.
        assert getattr(value, "date", lambda: value)() == expected

    def test_array_agg_is_not_rewritten_to_collect_list(
        self, engine: WrenEngine
    ) -> None:
        planned = engine.dry_plan(
            'SELECT array_agg(o_orderkey) AS a FROM "orders" WHERE o_orderkey <= 3'
        )
        assert "collect_list" not in planned.lower()

        result = engine.query(
            'SELECT array_agg(o_orderkey) AS a FROM "orders" WHERE o_orderkey <= 3'
        )
        value = result["a"][0].as_py()
        if isinstance(value, str):
            value = json.loads(value)
        assert sorted(int(v) for v in value) == [1, 2, 3]

    def test_group_concat_has_a_single_separator(self, engine: WrenEngine) -> None:
        result = engine.query(
            'SELECT group_concat(o_orderstatus) AS s FROM "orders" '
            "WHERE o_orderkey <= 3"
        )
        value = result["s"][0].as_py()
        assert ",," not in value
        assert len(value.split(",")) == 3
