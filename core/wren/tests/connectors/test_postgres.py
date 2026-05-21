"""PostgreSQL connector tests.

Uses testcontainers to spin up a real Postgres instance.
TPCH data is generated via DuckDB's built-in extension and loaded via psycopg.
"""

from __future__ import annotations

import base64
from decimal import Decimal
from urllib.parse import urlparse

import duckdb
import orjson
import psycopg
import pyarrow as pa
import pytest
from testcontainers.postgres import PostgresContainer

from tests.suite.manifests import make_tpch_manifest
from tests.suite.query import WrenQueryTestSuite
from wren import WrenEngine
from wren.connector.postgres import PostgresConnector
from wren.model.data_source import DataSource

pytestmark = pytest.mark.postgres

_SCHEMA = "public"


def _load_tpch(conn_str: str) -> None:
    """Generate TPCH sf=0.01 via DuckDB and bulk-load into Postgres."""
    duck = duckdb.connect()
    duck.execute("INSTALL tpch; LOAD tpch; CALL dbgen(sf=0.01)")

    orders_rows = duck.execute(
        "SELECT o_orderkey, o_custkey, o_orderstatus, "
        "cast(o_totalprice as double), o_orderdate FROM orders"
    ).fetchall()
    customer_rows = duck.execute("SELECT c_custkey, c_name FROM customer").fetchall()
    duck.close()

    with psycopg.connect(conn_str) as pg:
        with pg.cursor() as cur:
            cur.execute("""
                CREATE TABLE orders (
                    o_orderkey   INTEGER PRIMARY KEY,
                    o_custkey    INTEGER NOT NULL,
                    o_orderstatus CHAR(1) NOT NULL,
                    o_totalprice  DOUBLE PRECISION NOT NULL,
                    o_orderdate   DATE NOT NULL
                )
            """)
            cur.executemany(
                "INSERT INTO orders VALUES (%s, %s, %s, %s, %s)", orders_rows
            )

            cur.execute("""
                CREATE TABLE customer (
                    c_custkey INTEGER PRIMARY KEY,
                    c_name    VARCHAR(25) NOT NULL
                )
            """)
            cur.executemany("INSERT INTO customer VALUES (%s, %s)", customer_rows)


class TestPostgres(WrenQueryTestSuite):
    manifest = make_tpch_manifest(table_catalog=None, table_schema=_SCHEMA)

    @pytest.fixture(scope="class")
    def engine(self) -> WrenEngine:  # type: ignore[override]
        with PostgresContainer("postgres:16") as pg:
            # testcontainers returns a SQLAlchemy-style URL; psycopg wants
            # the plain postgresql:// form.
            url = pg.get_connection_url().replace("+psycopg2", "")
            _load_tpch(url)

            parsed = urlparse(url)
            conn_info = {
                "host": parsed.hostname,
                "port": parsed.port,
                "database": parsed.path.lstrip("/"),
                "user": parsed.username,
                "password": parsed.password,
            }
            manifest_str = base64.b64encode(orjson.dumps(self.manifest)).decode()
            with WrenEngine(
                manifest_str, DataSource.postgres, conn_info, fallback=False
            ) as e:
                yield e


# ---------------------------------------------------------------------------
# Direct PostgresConnector type-coverage tests (no MDL / engine layer)
# ---------------------------------------------------------------------------


def _build_type_table(conn_str: str) -> None:
    with psycopg.connect(conn_str) as pg:
        with pg.cursor() as cur:
            cur.execute("""
                CREATE TABLE type_zoo (
                    c_int4        INTEGER,
                    c_int8        BIGINT,
                    c_numeric     NUMERIC(38, 9),
                    c_text        TEXT,
                    c_bool        BOOLEAN,
                    c_bytea       BYTEA,
                    c_uuid        UUID,
                    c_jsonb       JSONB,
                    c_ts          TIMESTAMP,
                    c_tstz        TIMESTAMPTZ,
                    c_int4_arr    INTEGER[],
                    c_text_arr    TEXT[],
                    c_numeric_arr NUMERIC(38, 9)[]
                )
            """)
            cur.execute(
                """
                INSERT INTO type_zoo VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s::jsonb,
                    %s::timestamp, %s::timestamptz,
                    %s::int[], %s::text[], %s::numeric[]
                )
                """,
                (
                    42,
                    9_000_000_000,
                    Decimal("12345.123456789"),
                    "hello",
                    True,
                    b"\x01\x02\x03",
                    "00000000-0000-0000-0000-000000000001",
                    '{"a": 1, "b": "two"}',
                    "2024-01-02 03:04:05",
                    "2024-01-02 03:04:05+00",
                    [1, 2, 3],
                    ["a", "b", "c"],
                    [Decimal("1.5"), Decimal("2.25")],
                ),
            )
            cur.execute("INSERT INTO type_zoo (c_int4) VALUES (NULL)")
            pg.commit()


class TestPostgresConnectorTypes:
    """End-to-end type coverage for the native PostgresConnector."""

    @pytest.fixture(scope="class")
    def connector(self):
        with PostgresContainer("postgres:16") as pg:
            url = pg.get_connection_url().replace("+psycopg2", "")
            _build_type_table(url)

            parsed = urlparse(url)
            raw_info = {
                "host": parsed.hostname,
                "port": parsed.port,
                "database": parsed.path.lstrip("/"),
                "user": parsed.username,
                "password": parsed.password,
            }
            conn_info = DataSource.postgres.get_connection_info(raw_info)
            connector = PostgresConnector(conn_info)
            try:
                yield connector
            finally:
                connector.close()

    def test_arrow_schema(self, connector: PostgresConnector) -> None:
        result = connector.query("SELECT * FROM type_zoo ORDER BY c_int4 NULLS LAST")
        assert isinstance(result, pa.Table)
        assert result.num_rows == 2

        expected_types = {
            "c_int4": pa.int32(),
            "c_int8": pa.int64(),
            "c_numeric": pa.decimal128(38, 9),
            "c_text": pa.string(),
            "c_bool": pa.bool_(),
            "c_bytea": pa.binary(),
            "c_uuid": pa.string(),
            "c_jsonb": pa.string(),
            "c_ts": pa.timestamp("us"),
            "c_tstz": pa.timestamp("us", tz="UTC"),
            "c_int4_arr": pa.list_(pa.int32()),
            "c_text_arr": pa.list_(pa.string()),
            "c_numeric_arr": pa.list_(pa.decimal128(38, 9)),
        }
        for name, expected in expected_types.items():
            assert result.schema.field(name).type == expected, (
                f"unexpected Arrow type for {name}: {result.schema.field(name).type}"
            )

    def test_value_round_trip(self, connector: PostgresConnector) -> None:
        result = connector.query("SELECT * FROM type_zoo WHERE c_int4 = 42")
        assert result.num_rows == 1
        row = result.to_pylist()[0]
        assert row["c_int4"] == 42
        assert row["c_int8"] == 9_000_000_000
        assert row["c_numeric"] == Decimal("12345.123456789")
        assert row["c_text"] == "hello"
        assert row["c_bool"] is True
        assert bytes(row["c_bytea"]) == b"\x01\x02\x03"
        assert row["c_uuid"] == "00000000-0000-0000-0000-000000000001"
        # jsonb comes back as JSON string
        assert '"a"' in row["c_jsonb"] and '"b"' in row["c_jsonb"]
        assert row["c_int4_arr"] == [1, 2, 3]
        assert row["c_text_arr"] == ["a", "b", "c"]
        assert row["c_numeric_arr"] == [Decimal("1.500000000"), Decimal("2.250000000")]

    def test_nulls(self, connector: PostgresConnector) -> None:
        # Row inserted as `(NULL)` should produce a NULL in every column.
        result = connector.query("SELECT * FROM type_zoo WHERE c_int4 IS NULL")
        assert result.num_rows == 1
        row = result.to_pylist()[0]
        for col in result.column_names:
            assert row[col] is None, f"expected NULL for {col}, got {row[col]!r}"

    def test_query_limit_parameter(self, connector: PostgresConnector) -> None:
        result = connector.query("SELECT c_int4 FROM type_zoo", limit=1)
        assert result.num_rows == 1

    def test_dry_run(self, connector: PostgresConnector) -> None:
        # Should not raise and should not return rows.
        connector.dry_run("SELECT c_int4 FROM type_zoo")

    def test_dry_run_invalid_sql_raises(self, connector: PostgresConnector) -> None:
        from wren.model.error import WrenError

        with pytest.raises(WrenError):
            connector.dry_run("SELECT * FROM nope_does_not_exist")

    def test_duplicate_column_names_preserved(
        self, connector: PostgresConnector
    ) -> None:
        # ``pa.table({...})`` silently drops duplicate keys, which trashes
        # join results like ``SELECT a.id, b.id FROM t a, t b``. The
        # connector must preserve both fields positionally.
        # The previous ``test_dry_run_invalid_sql_raises`` aborts the shared
        # class-scoped connection's transaction; reset it before running.
        connector.connection.rollback()
        result = connector.query(
            "SELECT a.c_int4 AS id, b.c_int4 AS id "
            "FROM type_zoo a, type_zoo b "
            "WHERE a.c_int4 = 42 AND b.c_int4 = 42"
        )
        assert result.num_rows == 1
        assert result.num_columns == 2
        assert [field.name for field in result.schema] == ["id", "id"]
        assert result.column(0).to_pylist() == [42]
        assert result.column(1).to_pylist() == [42]
