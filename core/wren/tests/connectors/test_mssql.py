"""MSSQL connector tests.

Uses testcontainers to spin up a real SQL Server instance.
TPCH data is generated via DuckDB's built-in extension and loaded via pyodbc.
"""

from __future__ import annotations

import base64
import datetime as dtlib
from decimal import Decimal as PyDecimal

import duckdb
import orjson
import pyarrow as pa
import pytest

pyodbc = pytest.importorskip("pyodbc", reason="pyodbc not installed (mssql extra)")
testcontainers_mssql = pytest.importorskip(
    "testcontainers.mssql", reason="testcontainers[mssql] not installed"
)
SqlServerContainer = testcontainers_mssql.SqlServerContainer

from tests.suite.manifests import make_tpch_manifest  # noqa: E402
from tests.suite.query import WrenQueryTestSuite  # noqa: E402
from wren import WrenEngine  # noqa: E402
from wren.connector.mssql import MSSqlConnector  # noqa: E402
from wren.model import MSSqlConnectionInfo  # noqa: E402
from wren.model.data_source import DataSource  # noqa: E402
from wren.model.error import WrenError  # noqa: E402

_SCHEMA = "dbo"
_MSSQL_IMAGE = "mcr.microsoft.com/mssql/server:2022-latest"
_DRIVER = "ODBC Driver 18 for SQL Server"


def _have_mssql_driver() -> bool:
    try:
        return _DRIVER in pyodbc.drivers()
    except Exception:
        return False


pytestmark = [
    pytest.mark.mssql,
    pytest.mark.skipif(
        not _have_mssql_driver(),
        reason=f"{_DRIVER} not installed",
    ),
]


def _pyodbc_connect(container: SqlServerContainer) -> pyodbc.Connection:
    host = container.get_container_host_ip()
    port = container.get_exposed_port(container.port)
    password = container.password
    user = container.username
    database = container.dbname
    conn_str = (
        f"DRIVER={{{_DRIVER}}};"
        f"SERVER={host},{port};"
        f"DATABASE={database};"
        f"UID={user};PWD={password};"
        "TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str)


def _load_tpch(container: SqlServerContainer) -> None:
    """Generate TPCH sf=0.01 via DuckDB and bulk-load into SQL Server."""
    duck = duckdb.connect()
    duck.execute("INSTALL tpch; LOAD tpch; CALL dbgen(sf=0.01)")
    orders_rows = duck.execute(
        "SELECT o_orderkey, o_custkey, o_orderstatus, "
        "cast(o_totalprice as double), o_orderdate FROM orders"
    ).fetchall()
    customer_rows = duck.execute("SELECT c_custkey, c_name FROM customer").fetchall()
    duck.close()

    conn = _pyodbc_connect(container)
    conn.autocommit = True
    with conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE orders (
                o_orderkey    INT PRIMARY KEY,
                o_custkey     INT NOT NULL,
                o_orderstatus CHAR(1) NOT NULL,
                o_totalprice  FLOAT NOT NULL,
                o_orderdate   DATE NOT NULL
            )
        """)
        cur.fast_executemany = True
        cur.executemany(
            "INSERT INTO orders VALUES (?, ?, ?, ?, ?)",
            [(k, c, s, float(p), d) for (k, c, s, p, d) in orders_rows],
        )
        cur.execute("""
            CREATE TABLE customer (
                c_custkey INT PRIMARY KEY,
                c_name    VARCHAR(25) NOT NULL
            )
        """)
        cur.executemany("INSERT INTO customer VALUES (?, ?)", customer_rows)
        cur.close()


@pytest.fixture(scope="module")
def mssql_container():
    with SqlServerContainer(_MSSQL_IMAGE, dialect="mssql+pyodbc") as ms:
        _load_tpch(ms)
        yield ms


@pytest.fixture(scope="module")
def conn_info(mssql_container: SqlServerContainer) -> dict:
    return {
        "host": mssql_container.get_container_host_ip(),
        "port": str(mssql_container.get_exposed_port(mssql_container.port)),
        "database": mssql_container.dbname,
        "user": mssql_container.username,
        "password": mssql_container.password,
        "driver": _DRIVER,
        "kwargs": {"TrustServerCertificate": "yes"},
    }


class TestMSSqlEngine(WrenQueryTestSuite):
    manifest = make_tpch_manifest(table_catalog=None, table_schema=_SCHEMA)
    # SQL Server INT → Arrow int32 with our value-sampling inference
    order_id_dtype = "int32"

    @pytest.fixture(scope="class")
    def engine(self, conn_info) -> WrenEngine:  # type: ignore[override]
        manifest_str = base64.b64encode(orjson.dumps(self.manifest)).decode()
        with WrenEngine(manifest_str, DataSource.mssql, conn_info, fallback=False) as e:
            yield e


# ----------------------------------------------------------------------
# Type-specific tests (no MDL — directly via the connector)
# ----------------------------------------------------------------------


@pytest.fixture(scope="module")
def types_table(mssql_container: SqlServerContainer) -> str:
    conn = _pyodbc_connect(mssql_container)
    conn.autocommit = True
    table = "mssql_types"
    with conn:
        cur = conn.cursor()
        cur.execute(f"""
            CREATE TABLE {table} (
                c_int       INT,
                c_smallint  SMALLINT,
                c_bigint    BIGINT,
                c_tinyint   TINYINT,
                c_bit       BIT,
                c_varchar   VARCHAR(50),
                c_decimal   DECIMAL(18,4),
                c_datetime  DATETIME,
                c_datetime2 DATETIME2,
                c_dto       DATETIMEOFFSET,
                c_dto_utc   DATETIMEOFFSET,
                c_uuid      UNIQUEIDENTIFIER,
                c_varbinary VARBINARY(16)
            )
        """)
        cur.execute(
            f"INSERT INTO {table} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                42,
                7,
                10_000_000_000,
                255,
                1,
                "hello",
                PyDecimal("123.4500"),
                dtlib.datetime(2024, 1, 2, 3, 4, 5),
                dtlib.datetime(2024, 1, 2, 3, 4, 5, 678900),
                "2024-06-15 12:00:00 +05:30",
                "2024-06-15 12:00:00 +00:00",
                "00000000-0000-0000-0000-000000000001",
                b"\x01\x02\x03",
            ),
        )
        cur.close()
    return table


@pytest.fixture(scope="module")
def connector(conn_info) -> MSSqlConnector:
    info = MSSqlConnectionInfo.model_validate(conn_info)
    c = MSSqlConnector(info)
    try:
        yield c
    finally:
        c.close()


def test_int_types(connector: MSSqlConnector, types_table: str) -> None:
    result = connector.query(
        f"SELECT c_int, c_smallint, c_bigint, c_tinyint FROM {types_table}"
    )
    assert str(result.schema.field("c_int").type) == "int32"
    assert str(result.schema.field("c_smallint").type) == "int16"
    assert str(result.schema.field("c_bigint").type) == "int64"
    # TINYINT is unsigned in SQL Server; sampled non-negative
    assert str(result.schema.field("c_tinyint").type) == "uint8"
    assert result["c_int"][0].as_py() == 42
    assert result["c_tinyint"][0].as_py() == 255


def test_bit_and_varchar(connector: MSSqlConnector, types_table: str) -> None:
    result = connector.query(f"SELECT c_bit, c_varchar FROM {types_table}")
    assert result.schema.field("c_bit").type == pa.bool_()
    assert result["c_bit"][0].as_py() is True
    assert result["c_varchar"][0].as_py() == "hello"


def test_decimal_as_string(connector: MSSqlConnector, types_table: str) -> None:
    result = connector.query(f"SELECT c_decimal FROM {types_table}")
    # Decimals serialise as strings to avoid arrow decimal precision pitfalls
    assert str(result.schema.field("c_decimal").type) == "string"
    assert result["c_decimal"][0].as_py() == "123.4500"


def test_datetime_columns(connector: MSSqlConnector, types_table: str) -> None:
    result = connector.query(f"SELECT c_datetime, c_datetime2 FROM {types_table}")
    assert str(result.schema.field("c_datetime").type) == "timestamp[ns]"
    assert str(result.schema.field("c_datetime2").type) == "timestamp[ns]"


def test_datetimeoffset_non_utc(connector: MSSqlConnector, types_table: str) -> None:
    result = connector.query(f"SELECT c_dto FROM {types_table}")
    assert str(result.schema.field("c_dto").type) == "timestamp[ns, tz=+05:30]"
    value = result["c_dto"][0].as_py()
    assert isinstance(value, dtlib.datetime)
    assert value.utcoffset() == dtlib.timedelta(hours=5, minutes=30)


def test_datetimeoffset_utc(connector: MSSqlConnector, types_table: str) -> None:
    result = connector.query(f"SELECT c_dto_utc FROM {types_table}")
    assert str(result.schema.field("c_dto_utc").type) == "timestamp[ns, tz=UTC]"
    value = result["c_dto_utc"][0].as_py()
    assert value.utcoffset() == dtlib.timedelta(0)


def test_uuid_as_string(connector: MSSqlConnector, types_table: str) -> None:
    result = connector.query(f"SELECT c_uuid FROM {types_table}")
    assert str(result.schema.field("c_uuid").type) == "string"
    # SQL Server returns uppercase UUIDs
    assert result["c_uuid"][0].as_py().lower() == (
        "00000000-0000-0000-0000-000000000001"
    )


def test_varbinary_as_binary(connector: MSSqlConnector, types_table: str) -> None:
    result = connector.query(f"SELECT c_varbinary FROM {types_table}")
    assert str(result.schema.field("c_varbinary").type) == "binary"
    assert result["c_varbinary"][0].as_py() == b"\x01\x02\x03"


def test_dry_run_invalid_column_returns_describe_error(
    connector: MSSqlConnector, types_table: str
) -> None:
    with pytest.raises(WrenError) as exc:
        connector.dry_run(f"SELECT not_a_column FROM {types_table}")
    assert "dry run failed" in str(exc.value).lower()


def test_raw_cursor_sql_injects_fetch_next() -> None:
    rewritten = MSSqlConnector._raw_cursor_sql("SELECT * FROM orders", 10)
    # sqlglot emits OFFSET 0 ROWS FETCH NEXT n ROWS ONLY for tsql with LIMIT
    lower = rewritten.lower()
    assert "fetch next 10 rows only" in lower
    assert "offset 0 rows" in lower


def test_raw_cursor_sql_no_limit_passthrough() -> None:
    sql = "SELECT * FROM orders"
    assert MSSqlConnector._raw_cursor_sql(sql, None) == sql


def test_url_connection(mssql_container: SqlServerContainer) -> None:
    host = mssql_container.get_container_host_ip()
    port = mssql_container.get_exposed_port(mssql_container.port)
    password = mssql_container.password
    user = mssql_container.username
    database = mssql_container.dbname

    url = (
        f"mssql://{user}:{password}@{host}:{port}/{database}?TrustServerCertificate=yes"
    )
    info = {"connectionUrl": url}

    parsed = DataSource.mssql.get_connection_info(info)
    conn = DataSource.mssql.get_connection(parsed)
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 AS x")
        assert cur.fetchone()[0] == 1
        cur.close()
    finally:
        conn.close()
