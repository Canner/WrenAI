"""MySQL connector tests.

Uses testcontainers to spin up a real MySQL instance.
TPCH data is generated via DuckDB's built-in extension and loaded via pymysql.
"""

from __future__ import annotations

import base64
from urllib.parse import urlparse

import duckdb
import orjson
import pytest
from testcontainers.mysql import MySqlContainer

from tests.suite.manifests import make_tpch_manifest
from tests.suite.query import WrenQueryTestSuite
from wren import WrenEngine
from wren.model.data_source import DataSource

pytestmark = pytest.mark.mysql

_SCHEMA = "test"  # MySqlContainer default database name


def _load_tpch(conn_str: str) -> None:
    """Generate TPCH sf=0.01 via DuckDB and bulk-load into MySQL."""
    import pymysql  # noqa: PLC0415

    with duckdb.connect() as duck:
        duck.execute("INSTALL tpch; LOAD tpch; CALL dbgen(sf=0.01)")
        orders_rows = duck.execute(
            "SELECT o_orderkey, o_custkey, o_orderstatus, "
            "cast(o_totalprice as double), o_orderdate FROM orders"
        ).fetchall()
        customer_rows = duck.execute(
            "SELECT c_custkey, c_name FROM customer"
        ).fetchall()

    parsed = urlparse(conn_str)
    conn = pymysql.connect(
        host=parsed.hostname,
        port=parsed.port,
        user=parsed.username,
        password=parsed.password,
        database=parsed.path.lstrip("/"),
        autocommit=True,
    )
    with conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE orders (
                    o_orderkey    INT PRIMARY KEY,
                    o_custkey     INT NOT NULL,
                    o_orderstatus CHAR(1) NOT NULL,
                    o_totalprice  DOUBLE NOT NULL,
                    o_orderdate   DATE NOT NULL
                )
            """)
            cur.executemany(
                "INSERT INTO orders VALUES (%s, %s, %s, %s, %s)", orders_rows
            )
            cur.execute("""
                CREATE TABLE customer (
                    c_custkey INT PRIMARY KEY,
                    c_name    VARCHAR(25) NOT NULL
                )
            """)
            cur.executemany("INSERT INTO customer VALUES (%s, %s)", customer_rows)


class TestMySQL(WrenQueryTestSuite):
    manifest = make_tpch_manifest(table_catalog=None, table_schema=_SCHEMA)

    @pytest.fixture(scope="class")
    def engine(self) -> WrenEngine:  # type: ignore[override]
        with MySqlContainer("mysql:8.0.36") as mysql:
            url = mysql.get_connection_url()
            _load_tpch(url)

            parsed = urlparse(url)
            conn_info = {
                "host": parsed.hostname,
                "port": parsed.port,
                "database": parsed.path.lstrip("/"),
                "user": parsed.username,
                "password": parsed.password or "",
            }
            manifest_str = base64.b64encode(orjson.dumps(self.manifest)).decode()
            with WrenEngine(manifest_str, DataSource.mysql, conn_info) as e:
                yield e
