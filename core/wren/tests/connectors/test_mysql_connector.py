"""MySQL native connector type-coverage tests.

Spins up a real MySQL via testcontainers and exercises every field-type
to Arrow conversion path that the native ``MySqlConnector`` supports.
"""

from __future__ import annotations

from contextlib import closing
from decimal import Decimal

import pyarrow as pa
import pytest
from testcontainers.mysql import MySqlContainer

from wren.connector.mysql import MySqlConnector
from wren.model import MySqlConnectionInfo

pytestmark = pytest.mark.mysql


@pytest.fixture(scope="module")
def mysql_container():
    with MySqlContainer("mysql:8.0.36") as mysql:
        yield mysql


@pytest.fixture(scope="module")
def connector(mysql_container):
    info = MySqlConnectionInfo(
        host=mysql_container.get_container_host_ip(),
        port=mysql_container.get_exposed_port(3306),
        database=mysql_container.dbname,
        user=mysql_container.username,
        password=mysql_container.password,
        sslMode="disabled",
    )
    c = MySqlConnector(info)
    try:
        yield c
    finally:
        c.close()


def _exec(connector: MySqlConnector, sql: str) -> None:
    with closing(connector.connection.cursor()) as cur:
        cur.execute(sql)


def test_tinyint_signed_and_unsigned(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_tiny")
    _exec(
        connector,
        "CREATE TABLE t_tiny (a TINYINT, b TINYINT UNSIGNED)",
    )
    _exec(connector, "INSERT INTO t_tiny VALUES (-1, 200)")
    tbl = connector.query("SELECT a, b FROM t_tiny")
    assert tbl.schema.field("a").type == pa.int8()
    assert tbl.schema.field("b").type == pa.uint8()
    assert tbl.column("a").to_pylist() == [-1]
    assert tbl.column("b").to_pylist() == [200]


def test_smallint(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_small")
    _exec(connector, "CREATE TABLE t_small (a SMALLINT, b SMALLINT UNSIGNED)")
    _exec(connector, "INSERT INTO t_small VALUES (-32000, 65000)")
    tbl = connector.query("SELECT a, b FROM t_small")
    assert tbl.schema.field("a").type == pa.int16()
    assert tbl.schema.field("b").type == pa.uint16()


def test_int_and_bigint(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_int")
    _exec(
        connector,
        "CREATE TABLE t_int (a INT, b INT UNSIGNED, c BIGINT, d BIGINT UNSIGNED)",
    )
    _exec(
        connector, "INSERT INTO t_int VALUES (-1, 4000000000, -1, 18000000000000000000)"
    )
    tbl = connector.query("SELECT a, b, c, d FROM t_int")
    assert tbl.schema.field("a").type == pa.int32()
    assert tbl.schema.field("b").type == pa.uint32()
    assert tbl.schema.field("c").type == pa.int64()
    assert tbl.schema.field("d").type == pa.uint64()


def test_decimal(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_dec")
    _exec(connector, "CREATE TABLE t_dec (a DECIMAL(12, 4))")
    _exec(connector, "INSERT INTO t_dec VALUES (1234.5678)")
    tbl = connector.query("SELECT a FROM t_dec")
    arrow_type = tbl.schema.field("a").type
    assert pa.types.is_decimal(arrow_type)
    # Precision/scale now reflect the column definition instead of the previous
    # hard-coded ``decimal128(38, 9)``.
    assert arrow_type.precision == 12
    assert arrow_type.scale == 4
    assert tbl.column("a").to_pylist()[0] == Decimal("1234.5678")


def test_decimal_large_scale(connector: MySqlConnector) -> None:
    """DECIMAL with scale > 9 must round-trip without truncating digits.

    The previous hard-coded ``pa.decimal128(38, 9)`` silently dropped digits
    beyond the 9th decimal place. We now derive precision/scale from
    ``cursor.description``.
    """
    _exec(connector, "DROP TABLE IF EXISTS t_dec_big")
    _exec(connector, "CREATE TABLE t_dec_big (a DECIMAL(30, 15))")
    _exec(connector, "INSERT INTO t_dec_big VALUES (12345.123456789012345)")
    tbl = connector.query("SELECT a FROM t_dec_big")
    arrow_type = tbl.schema.field("a").type
    assert pa.types.is_decimal(arrow_type)
    assert arrow_type.precision == 30
    assert arrow_type.scale == 15
    assert tbl.column("a").to_pylist()[0] == Decimal("12345.123456789012345")


def test_float_and_double(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_real")
    _exec(connector, "CREATE TABLE t_real (a FLOAT, b DOUBLE)")
    _exec(connector, "INSERT INTO t_real VALUES (1.5, 2.5)")
    tbl = connector.query("SELECT a, b FROM t_real")
    assert tbl.schema.field("a").type == pa.float32()
    assert tbl.schema.field("b").type == pa.float64()


def test_char_varchar_text(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_str")
    _exec(connector, "CREATE TABLE t_str (a CHAR(8), b VARCHAR(32), c TEXT)")
    _exec(connector, "INSERT INTO t_str VALUES ('abc', 'hello', 'world')")
    tbl = connector.query("SELECT a, b, c FROM t_str")
    for col in ("a", "b", "c"):
        assert tbl.schema.field(col).type == pa.string()
    assert tbl.column("b").to_pylist() == ["hello"]
    assert tbl.column("c").to_pylist() == ["world"]


def test_json(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_json")
    _exec(connector, "CREATE TABLE t_json (a JSON)")
    _exec(connector, """INSERT INTO t_json VALUES ('{"k": 1}')""")
    tbl = connector.query("SELECT a FROM t_json")
    assert tbl.schema.field("a").type == pa.string()
    assert "k" in tbl.column("a").to_pylist()[0]


def test_blob_binary(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_blob")
    _exec(connector, "CREATE TABLE t_blob (a BLOB, b VARBINARY(16))")
    _exec(connector, "INSERT INTO t_blob VALUES (X'DEADBEEF', X'ABCD')")
    tbl = connector.query("SELECT a, b FROM t_blob")
    assert pa.types.is_binary(tbl.schema.field("a").type)
    assert pa.types.is_binary(tbl.schema.field("b").type)
    assert tbl.column("a").to_pylist()[0] == b"\xde\xad\xbe\xef"


def test_datetime_and_timestamp(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_dt")
    _exec(connector, "CREATE TABLE t_dt (a DATETIME, b TIMESTAMP NULL)")
    _exec(
        connector,
        "INSERT INTO t_dt VALUES ('2024-01-02 03:04:05', '2024-01-02 03:04:05')",
    )
    tbl = connector.query("SELECT a, b FROM t_dt")
    assert pa.types.is_timestamp(tbl.schema.field("a").type)
    assert pa.types.is_timestamp(tbl.schema.field("b").type)


def test_date(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_date")
    _exec(connector, "CREATE TABLE t_date (a DATE)")
    _exec(connector, "INSERT INTO t_date VALUES ('2024-05-14')")
    tbl = connector.query("SELECT a FROM t_date")
    assert tbl.schema.field("a").type == pa.date32()


def test_time(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_time")
    _exec(connector, "CREATE TABLE t_time (a TIME)")
    _exec(connector, "INSERT INTO t_time VALUES ('12:34:56')")
    tbl = connector.query("SELECT a FROM t_time")
    # MySQL TIME maps to Arrow ``duration("us")``: ``time64`` cannot represent
    # negative or >24h values that MySQL ``TIME`` permits.
    assert pa.types.is_duration(tbl.schema.field("a").type)


def test_time_full_range(connector: MySqlConnector) -> None:
    """MySQL ``TIME`` ranges ``-838:59:59`` to ``838:59:59``.

    The previous mapping to ``pa.time64("us")`` silently corrupted negative
    values and values past 24h (``time64`` only accepts 0–24h positive). Map
    to ``duration("us")`` instead so the full MySQL range round-trips.
    """
    import datetime  # noqa: PLC0415

    _exec(connector, "DROP TABLE IF EXISTS t_time_range")
    _exec(connector, "CREATE TABLE t_time_range (label VARCHAR(16), a TIME)")
    _exec(
        connector,
        "INSERT INTO t_time_range VALUES "
        "('neg_100', '-100:00:00'), "
        "('zero',    '0:00:00'), "
        "('max',     '838:59:59'), "
        "('min',     '-838:59:59')",
    )
    tbl = connector.query("SELECT label, a FROM t_time_range ORDER BY label")
    arrow_type = tbl.schema.field("a").type
    assert pa.types.is_duration(arrow_type)

    by_label = dict(
        zip(tbl.column("label").to_pylist(), tbl.column("a").to_pylist(), strict=True)
    )
    # ``duration("us")`` round-trips to ``datetime.timedelta`` in PyArrow.
    assert by_label["neg_100"] == datetime.timedelta(hours=-100)
    assert by_label["zero"] == datetime.timedelta(0)
    assert by_label["max"] == datetime.timedelta(hours=838, minutes=59, seconds=59)
    assert by_label["min"] == -datetime.timedelta(hours=838, minutes=59, seconds=59)


def test_year(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_year")
    _exec(connector, "CREATE TABLE t_year (a YEAR)")
    _exec(connector, "INSERT INTO t_year VALUES (2024)")
    tbl = connector.query("SELECT a FROM t_year")
    assert tbl.schema.field("a").type == pa.int16()
    assert tbl.column("a").to_pylist() == [2024]


def test_bit(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_bit")
    _exec(connector, "CREATE TABLE t_bit (a BIT(8))")
    _exec(connector, "INSERT INTO t_bit VALUES (b'10101010')")
    tbl = connector.query("SELECT a FROM t_bit")
    assert pa.types.is_binary(tbl.schema.field("a").type)


def test_enum_and_set(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_enum")
    _exec(
        connector,
        "CREATE TABLE t_enum (a ENUM('x', 'y', 'z'), b SET('p', 'q', 'r'))",
    )
    _exec(connector, "INSERT INTO t_enum VALUES ('y', 'p,r')")
    tbl = connector.query("SELECT a, b FROM t_enum")
    assert tbl.schema.field("a").type == pa.string()
    assert tbl.schema.field("b").type == pa.string()
    assert tbl.column("a").to_pylist() == ["y"]


def test_null_handling(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_null")
    _exec(connector, "CREATE TABLE t_null (a INT, b VARCHAR(8))")
    _exec(connector, "INSERT INTO t_null VALUES (NULL, NULL)")
    tbl = connector.query("SELECT a, b FROM t_null")
    assert tbl.column("a").to_pylist() == [None]
    assert tbl.column("b").to_pylist() == [None]


def test_query_with_limit(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_limit")
    _exec(connector, "CREATE TABLE t_limit (a INT)")
    _exec(connector, "INSERT INTO t_limit VALUES (1), (2), (3), (4), (5)")
    tbl = connector.query("SELECT a FROM t_limit", limit=2)
    assert tbl.num_rows == 2


def test_query_limit_rejects_sql_injection(connector: MySqlConnector) -> None:
    """``limit`` must be coerced via ``int()`` so it can be safely interpolated.

    Passing a crafted string would previously land directly in the rendered
    SQL via an f-string. ``int()`` rejects it with ``ValueError``.
    """
    _exec(connector, "DROP TABLE IF EXISTS t_inj")
    _exec(connector, "CREATE TABLE t_inj (a INT)")
    _exec(connector, "INSERT INTO t_inj VALUES (1), (2)")
    with pytest.raises((ValueError, TypeError)):
        connector.query("SELECT a FROM t_inj", limit="1; DROP TABLE t_inj")
    # Table must still exist — the malicious payload never reached the server.
    tbl = connector.query("SELECT a FROM t_inj")
    assert tbl.num_rows == 2


def test_query_with_duplicate_column_names(connector: MySqlConnector) -> None:
    """``SELECT * FROM (...) AS _sub`` would fail with ER_DUP_FIELDNAME on a
    join that exposes the same column name twice. Appending ``LIMIT`` to the
    user SQL avoids the subquery and so avoids the duplicate-column error.

    Also asserts the resulting Arrow table preserves BOTH ``id`` fields —
    building the table via ``dict(zip(names, arrays))`` would silently drop
    one of the duplicate columns because the dict collapses the key.
    """
    _exec(connector, "DROP TABLE IF EXISTS t_dup_a")
    _exec(connector, "DROP TABLE IF EXISTS t_dup_b")
    _exec(connector, "CREATE TABLE t_dup_a (id INT, val INT)")
    _exec(connector, "CREATE TABLE t_dup_b (id INT, val INT)")
    _exec(connector, "INSERT INTO t_dup_a VALUES (1, 10), (2, 20)")
    _exec(connector, "INSERT INTO t_dup_b VALUES (1, 100), (2, 200)")
    sql = "SELECT a.id, b.id FROM t_dup_a a JOIN t_dup_b b ON a.id = b.id"
    tbl = connector.query(sql, limit=10)
    assert tbl.num_rows == 2
    # Two ``id`` columns must survive — the schema is name-positional.
    assert tbl.num_columns == 2
    assert [f.name for f in tbl.schema] == ["id", "id"]
    # Both columns hold the same data (joined on ``id``), but they must each
    # exist independently in the result.
    assert tbl.column(0).to_pylist() == tbl.column(1).to_pylist()
    # dry_run should also work on duplicate-column queries.
    connector.dry_run(sql)


def test_query_trailing_semicolon(connector: MySqlConnector) -> None:
    """Trailing semicolons must be stripped before appending ``LIMIT``."""
    _exec(connector, "DROP TABLE IF EXISTS t_semi")
    _exec(connector, "CREATE TABLE t_semi (a INT)")
    _exec(connector, "INSERT INTO t_semi VALUES (1), (2), (3)")
    tbl = connector.query("SELECT a FROM t_semi;", limit=2)
    assert tbl.num_rows == 2


def test_dry_run(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_dry")
    _exec(connector, "CREATE TABLE t_dry (a INT)")
    connector.dry_run("SELECT a FROM t_dry")  # must not raise


def test_empty_result(connector: MySqlConnector) -> None:
    _exec(connector, "DROP TABLE IF EXISTS t_empty")
    _exec(connector, "CREATE TABLE t_empty (a INT, b VARCHAR(8))")
    tbl = connector.query("SELECT a, b FROM t_empty")
    assert tbl.num_rows == 0
    assert tbl.schema.field("a").type == pa.int32()
    assert tbl.schema.field("b").type == pa.string()
