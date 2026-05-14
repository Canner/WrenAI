"""Canner connector tests.

Canner Enterprise speaks the Postgres wire protocol, so we point a
``PostgresContainer`` at the connector and stand up tables with the data
types Canner publishes (Trino-style VARCHAR/DECIMAL/ARRAY/ROW/MAP plus the
usual postgres numeric/date/time types) to exercise the native psycopg
Arrow builder.
"""

from __future__ import annotations

from decimal import Decimal
from urllib.parse import urlparse

import pyarrow as pa
import pytest

from wren.connector.canner import (
    CannerConnector,
    _arrow_type,
    _build_column,
    _strip_trailing_semicolon,
)
from wren.model import CannerConnectionInfo

psycopg = pytest.importorskip("psycopg")
testcontainers_postgres = pytest.importorskip("testcontainers.postgres")
PostgresContainer = testcontainers_postgres.PostgresContainer

pytestmark = pytest.mark.canner


_FIXTURE_DDL = """
    CREATE TABLE canner_demo (
        id              BIGINT PRIMARY KEY,
        name            VARCHAR(64) NOT NULL,
        flag            BOOLEAN,
        amount          DECIMAL(18, 4),
        ratio           DOUBLE PRECISION,
        small           SMALLINT,
        sample_date     DATE,
        sample_ts       TIMESTAMP,
        sample_tstz     TIMESTAMPTZ,
        tags            VARCHAR[],
        struct_col      JSON,
        map_col         JSONB
    )
"""

_FIXTURE_ROWS = [
    (
        1,
        "alpha",
        True,
        Decimal("12.3400"),
        1.5,
        7,
        "2024-01-02",
        "2024-01-02 03:04:05",
        "2024-01-02 03:04:05+00",
        ["a", "b"],
        '{"k": "v"}',
        '{"m": 1}',
    ),
    (
        2,
        "beta",
        False,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ),
]


# ── helper-level unit tests ───────────────────────────────────────────────


def _column(type_code: int, precision: int | None = None, scale: int | None = None):
    class _Col:
        pass

    col = _Col()
    col.type_code = type_code
    col.precision = precision
    col.scale = scale
    return col


def test_arrow_type_maps_canner_scalars() -> None:
    # VARCHAR / CHAR / TEXT → string
    assert _arrow_type(_column(1043)) == pa.string()
    assert _arrow_type(_column(1042)) == pa.string()
    assert _arrow_type(_column(25)) == pa.string()
    # BIGINT / INTEGER / SMALLINT → int
    assert _arrow_type(_column(20)) == pa.int64()
    assert _arrow_type(_column(23)) == pa.int32()
    assert _arrow_type(_column(21)) == pa.int16()
    # BOOLEAN → bool
    assert _arrow_type(_column(16)) == pa.bool_()
    # DOUBLE / REAL → float
    assert _arrow_type(_column(701)) == pa.float64()
    assert _arrow_type(_column(700)) == pa.float32()
    # DATE / TIMESTAMP / TIMESTAMPTZ → date/timestamp
    assert _arrow_type(_column(1082)) == pa.date32()
    assert _arrow_type(_column(1114)) == pa.timestamp("us")
    assert _arrow_type(_column(1184)) == pa.timestamp("us", tz="UTC")
    # NUMERIC honours precision/scale
    assert _arrow_type(_column(1700, precision=18, scale=4)) == pa.decimal128(18, 4)
    # JSON/JSONB (ROW/MAP) → string
    assert _arrow_type(_column(114)) == pa.string()
    assert _arrow_type(_column(3802)) == pa.string()
    # ARRAY → list
    assert _arrow_type(_column(1009)) == pa.list_(pa.string())


def test_build_column_serialises_complex_values_to_json() -> None:
    array = _build_column([{"k": "v"}, [1, 2], "raw", None], pa.string(), 114)
    # SQL NULL must stay Python None — only actual JSON literals are stringified.
    assert array.to_pylist() == ['{"k": "v"}', "[1, 2]", "raw", None]


def test_build_column_preserves_sql_null_for_jsonb() -> None:
    # Regression: a SQL NULL in a json (114) / jsonb (3802) column must stay
    # Python None rather than being coerced to the string "null".
    for oid in (114, 3802):
        array = _build_column([None], pa.string(), oid)
        assert array.to_pylist() == [None]


def test_build_column_quantises_decimal_values() -> None:
    array = _build_column(
        [Decimal("12.345678"), None],
        pa.decimal128(18, 4),
    )
    assert array.to_pylist() == [Decimal("12.3457"), None]


def test_arrow_type_for_unconstrained_numeric_falls_back_to_string() -> None:
    # NUMERIC without typmod (scale is None) must not silently quantise — we
    # surface it as a string so high-precision values round-trip intact.
    assert _arrow_type(_column(1700)) == pa.string()
    # NUMERIC[] inherits the same behaviour for its element type.
    assert _arrow_type(_column(1231)) == pa.list_(pa.string())


def test_build_column_preserves_unconstrained_numeric_precision() -> None:
    # Regression: previously NUMERIC without typmod defaulted to scale=9, so
    # values past the 9th decimal were silently rounded by Decimal.quantize.
    high_precision = Decimal("12345678901234567890.123456789012345")
    array = _build_column([high_precision, None], pa.string(), 1700)
    assert array.to_pylist() == [str(high_precision), None]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("SELECT 1", "SELECT 1"),
        ("SELECT 1;", "SELECT 1"),
        ("SELECT 1  ;  ", "SELECT 1"),
        ("SELECT 1;;", "SELECT 1"),
        ("SELECT 1;\n", "SELECT 1"),
        # Semicolons inside string literals are *not* terminators — only the
        # trailing run is stripped.
        ("SELECT 'a;b' FROM t", "SELECT 'a;b' FROM t"),
        ("SELECT 'a;b' FROM t;", "SELECT 'a;b' FROM t"),
    ],
)
def test_strip_trailing_semicolon(raw: str, expected: str) -> None:
    assert _strip_trailing_semicolon(raw) == expected


def test_dry_run_returns_none_contract() -> None:
    # Regression: ConnectorABC.dry_run() must return None. The cursor result
    # must not leak out of the method, even on the success path.
    class _FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def execute(self, _sql: str) -> "_FakeCursor":
            return self

    class _FakeConnection:
        def cursor(self) -> _FakeCursor:
            return _FakeCursor()

    connector = CannerConnector.__new__(CannerConnector)
    connector.connection = _FakeConnection()
    connector._closed = False

    assert connector.dry_run("SELECT 1") is None


# ── end-to-end testcontainer test ─────────────────────────────────────────


@pytest.fixture(scope="module")
def canner_connector():
    with PostgresContainer("postgres:16") as pg:
        url = pg.get_connection_url().replace("+psycopg2", "")
        parsed = urlparse(url)

        with psycopg.connect(url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(_FIXTURE_DDL)
                cur.executemany(
                    """
                    INSERT INTO canner_demo VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    """,
                    _FIXTURE_ROWS,
                )

        # CannerConnectionInfo treats `workspace` like a postgres database and
        # `pat` like a password — pass them through directly.
        connection_info = CannerConnectionInfo(
            host=parsed.hostname,
            port=str(parsed.port),
            user=parsed.username,
            pat=parsed.password,
            workspace=parsed.path.lstrip("/"),
        )
        connector = CannerConnector(connection_info)
        try:
            yield connector
        finally:
            connector.close()


def test_canner_connector_query_returns_arrow_table(canner_connector) -> None:
    table = canner_connector.query("SELECT * FROM canner_demo ORDER BY id")

    assert table.num_rows == 2
    assert table.schema.field("id").type == pa.int64()
    assert table.schema.field("name").type == pa.string()
    assert table.schema.field("flag").type == pa.bool_()
    assert table.schema.field("amount").type == pa.decimal128(18, 4)
    assert table.schema.field("ratio").type == pa.float64()
    assert table.schema.field("small").type == pa.int16()
    assert table.schema.field("sample_date").type == pa.date32()
    assert table.schema.field("sample_ts").type == pa.timestamp("us")
    assert table.schema.field("sample_tstz").type == pa.timestamp("us", tz="UTC")
    assert table.schema.field("tags").type == pa.list_(pa.string())
    assert table.schema.field("struct_col").type == pa.string()
    assert table.schema.field("map_col").type == pa.string()

    rows = table.to_pylist()
    row = rows[0]
    assert row["id"] == 1
    assert row["name"] == "alpha"
    assert row["flag"] is True
    assert row["amount"] == Decimal("12.3400")
    assert row["tags"] == ["a", "b"]
    # complex types come back as JSON strings
    assert row["struct_col"] == '{"k": "v"}'
    assert row["map_col"] == '{"m": 1}'

    # SQL NULL in a JSON/JSONB column stays Python None — it must not be
    # silently coerced into the string "null".
    null_row = rows[1]
    assert null_row["struct_col"] is None
    assert null_row["map_col"] is None


def test_canner_connector_query_applies_limit(canner_connector) -> None:
    table = canner_connector.query("SELECT * FROM canner_demo ORDER BY id", limit=1)
    assert table.num_rows == 1


def test_canner_connector_query_preserves_duplicate_column_names(
    canner_connector,
) -> None:
    # Regression: dict-based pa.Table construction silently drops duplicate
    # column names — a self-join projecting both ``id`` columns must keep both.
    table = canner_connector.query(
        "SELECT a.id, b.id FROM canner_demo a, canner_demo b ORDER BY a.id, b.id LIMIT 1"
    )
    assert table.num_columns == 2
    assert [field.name for field in table.schema] == ["id", "id"]


def test_canner_connector_dry_run_succeeds(canner_connector) -> None:
    # Returns None and must not raise on a valid statement.
    assert canner_connector.dry_run("SELECT 1 AS x") is None


def test_canner_connector_dry_run_raises_for_invalid_sql(canner_connector) -> None:
    from wren.model.error import WrenError  # noqa: PLC0415

    with pytest.raises(WrenError):
        canner_connector.dry_run("SELECT * FROM no_such_table")


def test_canner_connector_preserves_unconstrained_numeric_precision(
    canner_connector,
) -> None:
    # Regression: unconstrained NUMERIC must round-trip without silent rounding.
    # The cursor description reports scale=None for an unconstrained cast, so
    # the connector falls back to pa.string() to keep the exact textual value.
    literal = "12345678901234567890.123456789012345"
    table = canner_connector.query(f"SELECT '{literal}'::numeric AS n")
    assert table.schema.field("n").type == pa.string()
    assert table.to_pylist() == [{"n": literal}]


def test_canner_connector_query_wraps_sql_with_trailing_semicolon(
    canner_connector,
) -> None:
    # Regression: a trailing semicolon on the user SQL must not break the
    # ``SELECT * FROM (...) AS _t LIMIT N`` wrap that the connector applies
    # when ``limit`` is provided.
    table = canner_connector.query("SELECT 1 AS x;", limit=1)
    assert table.num_rows == 1
    assert table.to_pylist() == [{"x": 1}]


def test_canner_connector_dry_run_wraps_sql_with_trailing_semicolon(
    canner_connector,
) -> None:
    # Same regression for dry_run, which always wraps as ``... LIMIT 0``.
    assert canner_connector.dry_run("SELECT 1 AS x;") is None
    assert canner_connector.dry_run("SELECT 1 AS x  ;  ") is None
