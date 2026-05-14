"""Native psycopg-based PostgreSQL connector.

This connector executes queries through psycopg3 directly and converts the
cursor result into a PyArrow table using a hand-rolled OID-to-Arrow type map.
It avoids the ibis-framework dependency entirely, which gives us:

* a smaller install surface for the ``postgres`` extra,
* direct control over pg-specific type handling (numeric scale, arrays,
  intervals, jsonb), and
* a single code path for both query execution and dry-run.
"""

from __future__ import annotations

import json
from decimal import ROUND_HALF_EVEN
from decimal import Decimal as PyDecimal

import psycopg
import pyarrow as pa
from loguru import logger

from wren.connector.base import ConnectorABC
from wren.model.data_source import DataSource
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError

# Map of well-known PostgreSQL OIDs to Arrow types. OIDs that we have not
# explicitly mapped fall back to ``pa.string()`` (see ``_get_pg_arrow_type``).
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
    114: pa.string(),  # json
    142: pa.string(),  # xml
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
    2950: pa.string(),  # uuid
    3802: pa.string(),  # jsonb
    1266: pa.string(),  # timetz
    3614: pa.string(),  # tsvector
    3615: pa.string(),  # tsquery
    3904: pa.string(),
    3906: pa.string(),
    3908: pa.string(),
    3910: pa.string(),
    3912: pa.string(),
    3926: pa.string(),
    199: pa.list_(pa.string()),  # _json
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
    2951: pa.list_(pa.string()),  # _uuid
    3807: pa.list_(pa.string()),  # _jsonb
}


def _get_pg_decimal_type(column) -> pa.DataType:
    """Map a psycopg numeric column to the narrowest Arrow decimal type we can represent."""
    if column.scale is None:
        logger.debug(
            "Postgres NUMERIC column has no scale metadata; defaulting to decimal128(38, 9)"
        )
    scale = column.scale if column.scale is not None else 9
    scale = max(0, min(scale, 38))

    precision = column.precision if column.precision is not None else 38
    if precision <= 0 or precision > 38:
        precision = 38
    precision = max(precision, scale, 1)
    precision = min(precision, 38)

    return pa.decimal128(precision, scale)


def _get_pg_arrow_type(column) -> pa.DataType:
    """Map a psycopg cursor description column to an Arrow type."""
    if column.type_code == 1700:
        return _get_pg_decimal_type(column)
    if column.type_code == 1231:
        return pa.list_(_get_pg_decimal_type(column))
    return _PG_OID_TO_ARROW.get(column.type_code, pa.string())


def _build_pg_arrow_table(cursor) -> pa.Table:
    """Convert a psycopg3 cursor result to a PyArrow table."""
    if cursor.description is None:
        return pa.table({})

    rows = cursor.fetchall()
    fields = [
        pa.field(column.name, _get_pg_arrow_type(column), nullable=True)
        for column in cursor.description
    ]
    schema = pa.schema(fields)

    if not rows:
        arrays = [pa.array([], type=field.type) for field in schema]
    else:
        arrays = [
            _build_pg_column(
                [row[index] for row in rows],
                field.type,
                cursor.description[index].type_code,
            )
            for index, field in enumerate(schema)
        ]

    # Build positionally — ``pa.table({...})`` silently drops duplicate column
    # names (very common in joins like ``SELECT a.id, b.id FROM t a, t b``).
    return pa.Table.from_arrays(arrays, schema=schema)


def _build_pg_column(
    values: list, arrow_type: pa.DataType, pg_type_oid: int | None = None
) -> pa.Array:
    """Build a PyArrow column from psycopg values with PG-specific coercions."""

    def _coerce_decimal(value: PyDecimal | None, target_type: pa.DataType):
        if value is None or not isinstance(value, PyDecimal):
            return value

        quantize_value = PyDecimal(f"1E-{target_type.scale}")
        try:
            return value.quantize(quantize_value, rounding=ROUND_HALF_EVEN)
        except Exception:
            return value

    if arrow_type == pa.string():
        processed = []
        for value in values:
            if value is None:
                # json / jsonb SQL NULLs come back as Python None too, but the
                # SQL value ``'null'::jsonb`` is also None at the Python level.
                # Keep both as None — callers that care about the distinction
                # should cast the column to text in SQL.
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

            items = []
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


class PostgresConnector(ConnectorABC):
    """Native psycopg3 implementation of the Wren postgres connector."""

    def __init__(self, connection_info):
        self.connection = DataSource.postgres.get_connection(connection_info)
        self._closed = False

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        if limit is not None:
            sql = f"SELECT * FROM ({sql}) AS _sub LIMIT {limit}"

        try:
            with self.connection.cursor() as cursor:
                cursor.execute(sql)
                return _build_pg_arrow_table(cursor)
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
        wrapped = f"SELECT * FROM ({sql}) AS _sub LIMIT 0"
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

    def close(self) -> None:
        if self._closed or self.connection is None:
            return
        try:
            if not self.connection.closed:
                try:
                    self.connection.cancel()
                except Exception:
                    pass
                self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing postgres connection: {e}")
        finally:
            self._closed = True
            self.connection = None


def create_connector(connection_info) -> PostgresConnector:
    return PostgresConnector(connection_info)
