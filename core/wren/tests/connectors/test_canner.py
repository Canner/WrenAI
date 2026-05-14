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

from wren.connector.canner import CannerConnector, _arrow_type, _build_column
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
    # SQL-NULL for json/jsonb is preserved as the literal "null" string to
    # match the JSON serialisation contract.
    assert array.to_pylist() == ['{"k": "v"}', "[1, 2]", "raw", "null"]


def test_build_column_quantises_decimal_values() -> None:
    array = _build_column(
        [Decimal("12.345678"), None],
        pa.decimal128(18, 4),
    )
    assert array.to_pylist() == [Decimal("12.3457"), None]


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

    row = table.to_pylist()[0]
    assert row["id"] == 1
    assert row["name"] == "alpha"
    assert row["flag"] is True
    assert row["amount"] == Decimal("12.3400")
    assert row["tags"] == ["a", "b"]
    # complex types come back as JSON strings
    assert row["struct_col"] == '{"k": "v"}'
    assert row["map_col"] == '{"m": 1}'


def test_canner_connector_query_applies_limit(canner_connector) -> None:
    table = canner_connector.query("SELECT * FROM canner_demo ORDER BY id", limit=1)
    assert table.num_rows == 1


def test_canner_connector_dry_run_succeeds(canner_connector) -> None:
    # Returns None and must not raise on a valid statement.
    assert canner_connector.dry_run("SELECT 1 AS x") is None


def test_canner_connector_dry_run_raises_for_invalid_sql(canner_connector) -> None:
    from wren.model.error import WrenError  # noqa: PLC0415

    with pytest.raises(WrenError):
        canner_connector.dry_run("SELECT * FROM no_such_table")
