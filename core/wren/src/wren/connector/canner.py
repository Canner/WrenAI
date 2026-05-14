"""Canner Enterprise connector using the Postgres wire protocol via psycopg.

Canner Enterprise exposes a Postgres-compatible endpoint, so we connect with
``psycopg`` directly and build Arrow tables from the cursor description instead
of going through ibis. The OID map below covers the types canner emits for
Trino-flavoured queries (VARCHAR, DECIMAL, ROW/ARRAY/MAP serialised through the
postgres wire).
"""

from __future__ import annotations

import json
import re
from decimal import ROUND_HALF_EVEN
from decimal import Decimal as PyDecimal
from typing import Any

import pyarrow as pa
from loguru import logger

from wren.connector.base import ConnectorABC
from wren.model.data_source import DataSource
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError

# Postgres OID → Arrow type. Canner publishes Trino-style values over the
# Postgres wire, so VARCHAR/CHAR map to string, DECIMAL to decimal128,
# BIGINT/INT/SMALLINT to int, BOOLEAN to bool, DATE/TIMESTAMP/TIMESTAMP_TZ to
# Arrow date/timestamp, and complex types (ROW/ARRAY/MAP) come back as JSON
# strings that we expose as Arrow strings.
_PG_OID_TO_ARROW: dict[int, pa.DataType] = {
    16: pa.bool_(),
    17: pa.binary(),
    18: pa.string(),
    19: pa.string(),
    20: pa.int64(),
    21: pa.int16(),
    23: pa.int32(),
    25: pa.string(),
    26: pa.int64(),
    114: pa.string(),
    142: pa.string(),
    700: pa.float32(),
    701: pa.float64(),
    650: pa.string(),
    774: pa.string(),
    790: pa.string(),
    829: pa.string(),
    869: pa.string(),
    1040: pa.string(),
    1042: pa.string(),
    1043: pa.string(),
    1082: pa.date32(),
    1083: pa.time64("us"),
    1114: pa.timestamp("us"),
    1184: pa.timestamp("us", tz="UTC"),
    1186: pa.duration("us"),
    2950: pa.string(),
    3802: pa.string(),
    1266: pa.string(),
    3614: pa.string(),
    3615: pa.string(),
    3904: pa.string(),
    3906: pa.string(),
    3908: pa.string(),
    3910: pa.string(),
    3912: pa.string(),
    3926: pa.string(),
    199: pa.list_(pa.string()),
    1000: pa.list_(pa.bool_()),
    1003: pa.list_(pa.string()),
    1005: pa.list_(pa.int16()),
    1007: pa.list_(pa.int32()),
    1009: pa.list_(pa.string()),
    1014: pa.list_(pa.string()),
    1015: pa.list_(pa.string()),
    1016: pa.list_(pa.int64()),
    1021: pa.list_(pa.float32()),
    1022: pa.list_(pa.float64()),
    1028: pa.list_(pa.string()),
    1041: pa.list_(pa.string()),
    1115: pa.list_(pa.timestamp("us")),
    1182: pa.list_(pa.string()),
    1183: pa.list_(pa.string()),
    1185: pa.list_(pa.timestamp("us", tz="UTC")),
    1187: pa.list_(pa.string()),
    1270: pa.list_(pa.string()),
    2951: pa.list_(pa.string()),
    3807: pa.list_(pa.string()),
}


def _decimal_type(column) -> pa.DataType | None:
    """Pick the narrowest decimal128 that fits a NUMERIC column.

    Returns ``None`` when the column has no explicit typmod (``scale is
    None``) — the caller falls back to ``pa.string()`` so that high-precision
    values round-trip without silent rounding via ``Decimal.quantize``.
    """
    if column.scale is None:
        return None
    scale = max(0, min(column.scale, 38))
    precision = column.precision if column.precision is not None else 38
    if precision <= 0 or precision > 38:
        precision = 38
    precision = max(precision, scale, 1)
    precision = min(precision, 38)
    return pa.decimal128(precision, scale)


def _arrow_type(column) -> pa.DataType:
    if column.type_code == 1700:
        # Unconstrained NUMERIC (no typmod) falls back to string to preserve
        # the exact textual representation — quantising to an arbitrary scale
        # would silently round high-precision values.
        return _decimal_type(column) or pa.string()
    if column.type_code == 1231:
        inner = _decimal_type(column)
        return pa.list_(inner) if inner is not None else pa.list_(pa.string())
    return _PG_OID_TO_ARROW.get(column.type_code, pa.string())


_TRAILING_SEMICOLONS_RE = re.compile(r"[;\s]+\Z")


def _strip_trailing_semicolon(sql: str) -> str:
    """Strip any trailing ``;`` characters and surrounding whitespace.

    Wrapping user SQL as ``SELECT * FROM ({sql}) AS _t LIMIT N`` breaks when
    ``sql`` ends in a semicolon — Postgres/Canner reject ``SELECT 1;`` inside
    a subquery. We only strip the *terminating* run of semicolons/whitespace,
    so semicolons inside string literals (e.g. ``SELECT 'a;b' FROM t``) are
    preserved.
    """
    return _TRAILING_SEMICOLONS_RE.sub("", sql)


def _coerce_decimal(value, target_type: pa.DataType):
    if value is None or not isinstance(value, PyDecimal):
        return value
    quantize_value = PyDecimal(f"1E-{target_type.scale}")
    try:
        return value.quantize(quantize_value, rounding=ROUND_HALF_EVEN)
    except Exception:
        return value


def _build_column(
    values: list, arrow_type: pa.DataType, pg_type_oid: int | None = None
) -> pa.Array:
    if arrow_type == pa.string():
        processed: list[Any] = []
        for value in values:
            if value is None:
                # SQL NULL stays as Python None regardless of source oid; the
                # caller is responsible for distinguishing a JSON ``null``
                # literal from a SQL NULL.
                processed.append(None)
            elif isinstance(value, dict | list):
                processed.append(json.dumps(value, default=str))
            elif not isinstance(value, str):
                processed.append(str(value))
            else:
                processed.append(value)
        return pa.array(processed, type=pa.string(), from_pandas=True)

    if pa.types.is_binary(arrow_type):
        processed = [
            bytes(value) if isinstance(value, memoryview) else value for value in values
        ]
        return pa.array(processed, type=pa.binary(), from_pandas=True)

    if pa.types.is_decimal(arrow_type):
        processed = [_coerce_decimal(value, arrow_type) for value in values]
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_list(arrow_type) and pa.types.is_string(arrow_type.value_type):
        processed = []
        for value in values:
            if value is None:
                processed.append(None)
                continue
            items: list[Any] = []
            for item in value:
                if item is None:
                    items.append(None)
                elif isinstance(item, dict | list):
                    items.append(json.dumps(item, default=str))
                elif isinstance(item, str):
                    items.append(item)
                else:
                    items.append(str(item))
            processed.append(items)
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_list(arrow_type) and pa.types.is_decimal(arrow_type.value_type):
        processed = []
        for value in values:
            if value is None:
                processed.append(None)
            else:
                processed.append(
                    [_coerce_decimal(item, arrow_type.value_type) for item in value]
                )
        return pa.array(processed, type=arrow_type, from_pandas=True)

    return pa.array(values, type=arrow_type, from_pandas=True)


def _build_arrow_table(cursor) -> pa.Table:
    """Convert a psycopg cursor result into a PyArrow table."""
    if cursor.description is None:
        return pa.table({})

    rows = cursor.fetchall()
    fields = [
        pa.field(column.name, _arrow_type(column), nullable=True)
        for column in cursor.description
    ]
    schema = pa.schema(fields)

    if not rows:
        arrays = [pa.array([], type=field.type) for field in schema]
    else:
        arrays = [
            _build_column(
                [row[index] for row in rows],
                field.type,
                cursor.description[index].type_code,
            )
            for index, field in enumerate(schema)
        ]

    # Use positional construction so duplicate column names (e.g. self-joins)
    # survive — dict-based construction silently drops duplicates.
    return pa.Table.from_arrays(arrays, schema=schema)


class CannerConnector(ConnectorABC):
    def __init__(self, connection_info):
        self.connection = DataSource.canner.get_connection(connection_info)
        self._closed = False

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        import psycopg  # noqa: PLC0415

        if limit is not None:
            sql = (
                f"SELECT * FROM ({_strip_trailing_semicolon(sql)}) AS _t LIMIT {limit}"
            )

        try:
            with self.connection.cursor() as cursor:
                cursor.execute(sql)
                return _build_arrow_table(cursor)
        except psycopg.errors.QueryCanceled:
            raise
        except (WrenError, TimeoutError):
            raise
        except Exception as e:
            raise WrenError(
                ErrorCode.GENERIC_USER_ERROR,
                str(e),
                phase=ErrorPhase.SQL_EXECUTION,
                metadata={DIALECT_SQL: sql},
            ) from e

    def dry_run(self, sql: str) -> None:
        import psycopg  # noqa: PLC0415

        wrapped = f"SELECT * FROM ({_strip_trailing_semicolon(sql)}) AS _t LIMIT 0"
        try:
            with self.connection.cursor() as cursor:
                cursor.execute(wrapped)
        except psycopg.errors.QueryCanceled:
            raise
        except (WrenError, TimeoutError):
            raise
        except Exception as e:
            raise WrenError(
                ErrorCode.GENERIC_USER_ERROR,
                str(e),
                phase=ErrorPhase.SQL_DRY_RUN,
                metadata={DIALECT_SQL: sql},
            ) from e
        # Explicit return to honour the ConnectorABC.dry_run() contract — the
        # cursor result must not leak out of this method.
        return None

    def close(self) -> None:
        if self._closed or not hasattr(self, "connection") or self.connection is None:
            return
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing Canner connection: {e}")
        finally:
            self._closed = True
            self.connection = None


def create_connector(connection_info) -> CannerConnector:
    return CannerConnector(connection_info)
