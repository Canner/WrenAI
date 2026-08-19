"""PostgreSQL connector tests.

Uses testcontainers to spin up a real Postgres instance.
TPCH data is generated via DuckDB's built-in extension and loaded via psycopg.
"""

from __future__ import annotations

import base64
from decimal import Decimal
from types import SimpleNamespace
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
from wren.connector.postgres import (
    PostgresConnector,
    _build_pg_arrow_table,
    _build_pg_column,
)
from wren.model.data_source import DataSource

pytestmark = pytest.mark.postgres

_SCHEMA = "public"


def _column(
    type_code: int,
    precision: int | None = None,
    scale: int | None = None,
    name: str = "value",
):
    return SimpleNamespace(
        name=name,
        type_code=type_code,
        precision=precision,
        scale=scale,
    )


def _cursor(columns: list, rows: list[tuple]):
    return SimpleNamespace(description=columns, fetchall=lambda: rows)


@pytest.mark.parametrize(
    ("value", "expected_type"),
    [
        (Decimal("1.123456789012345"), pa.decimal128(16, 15)),
        (
            Decimal("12345678901234567890.123456789012345"),
            pa.decimal128(35, 15),
        ),
    ],
)
def test_unconstrained_numeric_infers_exact_decimal_type(
    value: Decimal, expected_type: pa.DataType
) -> None:
    result = _build_pg_arrow_table(_cursor([_column(1700)], [(value,), (None,)]))

    assert result.schema.field("value").type == expected_type
    assert result.column("value").to_pylist() == [value, None]


def test_unconstrained_zero_numeric_preserves_scale() -> None:
    value = Decimal("0.00")

    result = _build_pg_arrow_table(_cursor([_column(1700)], [(value,)]))

    assert result.schema.field("value").type == pa.decimal128(2, 2)
    assert result.column("value").to_pylist() == [value]


def test_unconstrained_numeric_array_infers_exact_decimal_type() -> None:
    values = [Decimal("1.123456789012345"), Decimal("20.5"), None]

    result = _build_pg_arrow_table(_cursor([_column(1231)], [(values,)]))

    assert result.schema.field("value").type == pa.list_(pa.decimal128(17, 15))
    assert result.column("value").to_pylist() == [values]


def test_constrained_numeric_above_decimal128_uses_decimal256() -> None:
    value = Decimal("12345678901234567890123456789012345.123456789012345")

    result = _build_pg_arrow_table(
        _cursor([_column(1700, precision=50, scale=15)], [(value,)])
    )

    assert result.schema.field("value").type == pa.decimal256(50, 15)
    assert result.column("value").to_pylist() == [value]


@pytest.mark.parametrize(
    "value",
    [Decimal("NaN"), Decimal("Infinity"), Decimal("-Infinity")],
)
def test_constrained_non_finite_numeric_falls_back_to_exact_string(
    value: Decimal,
) -> None:
    result = _build_pg_arrow_table(
        _cursor([_column(1700, precision=38, scale=9)], [(value,)])
    )

    assert result.schema.field("value").type == pa.string()
    assert result.column("value").to_pylist() == [str(value)]


@pytest.mark.parametrize(
    "value",
    [Decimal("NaN"), Decimal("Infinity"), Decimal("-Infinity")],
)
def test_constrained_non_finite_numeric_array_falls_back_to_exact_strings(
    value: Decimal,
) -> None:
    values = [Decimal("1.5"), value, None]

    result = _build_pg_arrow_table(
        _cursor([_column(1231, precision=38, scale=9)], [(values,)])
    )

    assert result.schema.field("value").type == pa.list_(pa.string())
    assert result.column("value").to_pylist() == [["1.5", str(value), None]]


def test_unrepresentable_numeric_falls_back_to_exact_string() -> None:
    value = Decimal("1" * 77)

    result = _build_pg_arrow_table(_cursor([_column(1700)], [(value,)]))

    assert result.schema.field("value").type == pa.string()
    assert result.column("value").to_pylist() == [str(value)]


def test_unrepresentable_numeric_array_falls_back_to_exact_strings() -> None:
    value = Decimal("1" * 77)
    arrow_type = pa.list_(pa.string())

    result = _build_pg_column([[value, None]], arrow_type, 1231)

    assert result.to_pylist() == [[str(value), None]]


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
                    c_numeric_arr NUMERIC(38, 9)[],
                    c_numeric_wide NUMERIC(50, 15),
                    c_numeric_scale_gt_precision NUMERIC(3, 5),
                    c_numeric_negative_scale NUMERIC(3, -2)
                )
            """)
            cur.execute(
                """
                INSERT INTO type_zoo VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s::jsonb,
                    %s::timestamp, %s::timestamptz,
                    %s::int[], %s::text[], %s::numeric[], %s, %s, %s
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
                    Decimal("12345678901234567890123456789012345.123456789012345"),
                    Decimal("0.00123"),
                    Decimal("12345"),
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
            "c_numeric_wide": pa.decimal256(50, 15),
            "c_numeric_scale_gt_precision": pa.decimal128(5, 5),
            "c_numeric_negative_scale": pa.decimal128(5, 0),
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
        assert row["c_numeric_wide"] == Decimal(
            "12345678901234567890123456789012345.123456789012345"
        )
        assert row["c_numeric_scale_gt_precision"] == Decimal("0.00123")
        assert row["c_numeric_negative_scale"] == Decimal("12300")

    def test_computed_numeric_expressions_remain_decimal(
        self, connector: PostgresConnector
    ) -> None:
        result = connector.query(
            "SELECT SUM(c_numeric) AS total, AVG(c_numeric) AS average, "
            "c_numeric * 2 AS doubled FROM type_zoo "
            "WHERE c_numeric IS NOT NULL GROUP BY c_numeric"
        )

        assert result.schema.field("total").type == pa.decimal128(14, 9)
        assert result.schema.field("average").type == pa.decimal128(21, 16)
        assert result.schema.field("doubled").type == pa.decimal128(14, 9)
        assert result.to_pylist() == [
            {
                "total": Decimal("12345.123456789"),
                "average": Decimal("12345.123456789"),
                "doubled": Decimal("24690.246913578"),
            }
        ]

    def test_unconstrained_numeric_array_remains_decimal(
        self, connector: PostgresConnector
    ) -> None:
        values = [
            Decimal("1.123456789012345"),
            Decimal("12345678901234567890.123456789012345"),
        ]

        result = connector.query(
            "SELECT ARRAY["
            "1.123456789012345::numeric, "
            "12345678901234567890.123456789012345::numeric"
            "] AS values"
        )

        assert result.schema.field("values").type == pa.list_(pa.decimal128(35, 15))
        assert result.column("values").to_pylist() == [values]

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


# ---------------------------------------------------------------------------
# Trailing-semicolon stripping (mocked — no live database).
#
# These live in the postgres-marked module so they actually run in the
# ``postgres tests`` CI job (which installs psycopg). They use a mocked
# connection and assert on the SQL the connector executes, so no container
# is required.
# ---------------------------------------------------------------------------

from contextlib import contextmanager
from unittest.mock import MagicMock

from wren.connector.base import strip_trailing_semicolon as _strip_trailing_semicolon


def _make_mock_connector() -> tuple[PostgresConnector, MagicMock]:
    """Build a PostgresConnector bypassing __init__ (no real connection)."""
    connector = PostgresConnector.__new__(PostgresConnector)
    connector._closed = False
    cursor = MagicMock()
    cursor.description = None  # _build_pg_arrow_table returns an empty table

    @contextmanager
    def _cursor_cm():
        yield cursor

    conn = MagicMock()
    conn.cursor.side_effect = _cursor_cm
    connector.connection = conn
    return connector, cursor


def test_query_strips_trailing_semicolon_before_subquery_wrap() -> None:
    connector, cursor = _make_mock_connector()
    connector.query("SELECT 1;", limit=5)
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _sub LIMIT 5"
    assert ";)" not in sent


def test_dry_run_strips_trailing_semicolon() -> None:
    connector, cursor = _make_mock_connector()
    connector.dry_run("SELECT 1;  ")
    (sent,), _ = cursor.execute.call_args
    assert sent == "SELECT * FROM (SELECT 1) AS _sub LIMIT 0"


def test_helper_preserves_semicolon_inside_string_literal() -> None:
    sql = "SELECT 'a;b' AS x"
    assert _strip_trailing_semicolon(sql) == sql


def test_helper_no_trailing_semicolon_unchanged() -> None:
    assert _strip_trailing_semicolon("SELECT 1") == "SELECT 1"


class TestPostgresConnectorTransactionRecovery:
    """A failed statement must not poison the connector's long-lived connection.

    ``WrenEngine._get_connector`` caches one connector per engine and the MCP
    server shares one engine per process, so a connection left ``idle in
    transaction (aborted)`` fails every later query until the process restarts.
    The fixture is class-scoped on purpose: both tests reuse the same connection.
    """

    @pytest.fixture(scope="class")
    def connector(self):
        with PostgresContainer("postgres:16") as pg:
            url = pg.get_connection_url().replace("+psycopg2", "")
            with psycopg.connect(url) as setup:
                setup.execute("CREATE TABLE recovery (id integer)")
                setup.execute("INSERT INTO recovery VALUES (1), (2)")
                setup.commit()

            parsed = urlparse(url)
            conn_info = DataSource.postgres.get_connection_info(
                {
                    "host": parsed.hostname,
                    "port": parsed.port,
                    "database": parsed.path.lstrip("/"),
                    "user": parsed.username,
                    "password": parsed.password,
                }
            )
            connector = PostgresConnector(conn_info)
            try:
                yield connector
            finally:
                connector.close()

    def test_query_succeeds_after_failed_query(
        self, connector: PostgresConnector
    ) -> None:
        from wren.model.error import WrenError

        with pytest.raises(WrenError):
            connector.query("SELECT no_such_column FROM recovery")

        result = connector.query("SELECT count(*) AS n FROM recovery")
        assert result.column("n").to_pylist() == [2]

    def test_query_succeeds_after_failed_dry_run(
        self, connector: PostgresConnector
    ) -> None:
        from wren.model.error import WrenError

        with pytest.raises(WrenError):
            connector.dry_run("SELECT no_such_column FROM recovery")

        result = connector.query("SELECT count(*) AS n FROM recovery")
        assert result.column("n").to_pylist() == [2]
