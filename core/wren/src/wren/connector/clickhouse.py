"""Native ClickHouse connector built on ``clickhouse-connect``.

ClickHouse types are returned by the driver as descriptor strings such as
``Nullable(Decimal(18, 4))`` or ``Array(LowCardinality(String))``. We parse
those into a sqlglot ``DataType`` AST and walk it to construct a matching
PyArrow schema. Values from ``QueryResult.result_rows`` are then coerced
column-by-column to that schema.
"""

from __future__ import annotations

import json
import re
from decimal import Decimal as PyDecimal
from typing import Any
from urllib.parse import parse_qsl, unquote_plus, urlparse

import pyarrow as pa
import sqlglot
import sqlglot.errors
from loguru import logger
from sqlglot.expressions import DataType

from wren.connector.base import ConnectorABC
from wren.model.error import (
    DIALECT_SQL,
    DatabaseTimeoutError,
    ErrorCode,
    ErrorPhase,
    WrenError,
)

try:
    import clickhouse_connect

    _ClickHouseDbError = clickhouse_connect.driver.exceptions.DatabaseError
except ImportError:  # pragma: no cover - optional dependency

    class _ClickHouseDbError(Exception):
        pass


# --------------------------------------------------------------------------
# Type parsing — ClickHouse type-string → PyArrow DataType
# --------------------------------------------------------------------------


def _parse_clickhouse_type(type_str: str | None) -> pa.DataType:
    """Map a ClickHouse type-name string to an Arrow type via sqlglot.

    sqlglot's ClickHouse dialect strips ``Nullable(...)`` during parsing
    (the inner ``DataType`` is hoisted to the top), so we only need to peel
    ``LowCardinality(...)`` ourselves.
    """
    if type_str is None:
        return pa.string()
    try:
        parsed = sqlglot.parse_one(type_str, into=DataType, dialect="clickhouse")
    except sqlglot.errors.ParseError:
        logger.warning(f"Failed to parse ClickHouse type string: {type_str}")
        return pa.string()
    if parsed is None:
        return pa.string()
    return _clickhouse_data_type_to_arrow(parsed)


_CLICKHOUSE_DATA_TYPE_TO_ARROW: dict = {}


def _init_clickhouse_data_type_map() -> None:
    if _CLICKHOUSE_DATA_TYPE_TO_ARROW:
        return
    T = DataType.Type
    _CLICKHOUSE_DATA_TYPE_TO_ARROW.update(
        {
            T.BOOLEAN: pa.bool_(),
            T.TINYINT: pa.int8(),
            T.SMALLINT: pa.int16(),
            T.INT: pa.int32(),
            T.BIGINT: pa.int64(),
            T.UTINYINT: pa.uint8(),
            T.USMALLINT: pa.uint16(),
            T.UINT: pa.uint32(),
            T.UBIGINT: pa.uint64(),
            # Int128 / Int256 / UInt128 / UInt256: PyArrow tops out at 64 bits,
            # so surface the wide types as string to avoid silent truncation.
            T.INT128: pa.string(),
            T.INT256: pa.string(),
            T.UINT128: pa.string(),
            T.UINT256: pa.string(),
            T.FLOAT: pa.float32(),
            T.DOUBLE: pa.float64(),
            T.TEXT: pa.string(),  # ClickHouse ``String``
            T.FIXEDSTRING: pa.string(),
            T.UUID: pa.string(),
            T.IPV4: pa.string(),
            T.IPV6: pa.string(),
            T.ENUM8: pa.string(),
            T.ENUM16: pa.string(),
            T.JSON: pa.string(),
            # ``Nothing`` is ClickHouse's type for bare NULL literals. Surface
            # as string — the column will be all-None either way.
            T.NOTHING: pa.string(),
            T.DATE: pa.date32(),
            T.DATE32: pa.date32(),
        }
    )


def _clickhouse_data_type_to_arrow(node: Any) -> pa.DataType:
    _init_clickhouse_data_type_map()
    if not isinstance(node, DataType):
        return pa.string()

    kind = node.this
    T = DataType.Type

    # Peel ``LowCardinality(...)`` — purely a storage detail.
    if kind == T.LOWCARDINALITY:
        inner = node.expressions[0] if node.expressions else None
        return _clickhouse_data_type_to_arrow(inner) if inner else pa.string()

    if kind in _CLICKHOUSE_DATA_TYPE_TO_ARROW:
        return _CLICKHOUSE_DATA_TYPE_TO_ARROW[kind]

    if kind in (T.DECIMAL, T.DECIMAL32, T.DECIMAL64, T.DECIMAL128, T.DECIMAL256):
        # Normalise every decimal to (38, 9) so downstream consumers do not
        # have to special-case precision/scale per column.
        return pa.decimal128(38, 9)

    if kind in (T.DATETIME, T.DATETIME64):
        tz = _clickhouse_extract_datetime_tz(node)
        if tz:
            return pa.timestamp("ns", tz=tz)
        return pa.timestamp("ns")

    if kind == T.ARRAY:
        inner = node.expressions[0] if node.expressions else None
        return pa.list_(_clickhouse_data_type_to_arrow(inner) if inner else pa.string())

    if kind == T.MAP:
        if len(node.expressions) >= 2:
            return pa.map_(
                _clickhouse_data_type_to_arrow(node.expressions[0]),
                _clickhouse_data_type_to_arrow(node.expressions[1]),
            )
        return pa.string()

    if kind == T.STRUCT:
        # ``Tuple(...)`` — flatten to JSON-encoded string.
        return pa.string()

    return pa.string()


def _clickhouse_extract_datetime_tz(node: Any) -> str | None:
    """Pull the timezone string out of ``DateTime('tz')`` / ``DateTime64(p, 'tz')``."""
    for param in node.expressions:
        # ``DataTypeParam`` wraps a ``Literal``; we want the string-typed one.
        inner = getattr(param, "this", None)
        if inner is not None and getattr(inner, "is_string", False):
            return str(inner.this)
    return None


# --------------------------------------------------------------------------
# Arrow table assembly from a clickhouse-connect QueryResult
# --------------------------------------------------------------------------


def _build_clickhouse_arrow_table(query_result: Any) -> pa.Table:
    """Convert a ``clickhouse_connect`` ``QueryResult`` into a PyArrow table."""
    column_names = list(query_result.column_names)
    column_types = list(query_result.column_types)
    rows = list(query_result.result_rows or [])

    fields = [
        pa.field(name, _parse_clickhouse_type(ct.name), nullable=True)
        for name, ct in zip(column_names, column_types, strict=False)
    ]
    schema = pa.schema(fields)

    if not rows:
        arrays = [pa.array([], type=field.type) for field in schema]
    else:
        arrays = [
            _build_clickhouse_column([row[i] for row in rows], schema.field(i).type)
            for i in range(len(fields))
        ]
    # ``dict(zip(...))`` collapses duplicate column names — build the table
    # from arrays + schema so projections like ``SELECT a, a`` are preserved.
    return pa.Table.from_arrays(arrays, schema=schema)


def _build_clickhouse_column(values: list, arrow_type: pa.DataType) -> pa.Array:
    """Convert ``clickhouse_connect`` Python values into a PyArrow array."""
    if pa.types.is_string(arrow_type):
        processed: list[Any] = []
        for v in values:
            if v is None:
                processed.append(None)
            elif isinstance(v, dict | list | tuple):
                processed.append(json.dumps(v, default=str))
            elif isinstance(v, str):
                processed.append(v)
            elif isinstance(v, bytes):
                processed.append(v.decode("utf-8", errors="replace"))
            else:
                processed.append(str(v))
        return pa.array(processed, type=pa.string(), from_pandas=True)

    if pa.types.is_decimal(arrow_type):
        # Every decimal is normalised to ``decimal128(38, 9)``, so no
        # per-column precision/scale narrowing is needed here.
        processed = [
            None
            if v is None
            else (v if isinstance(v, PyDecimal) else PyDecimal(str(v)))
            for v in values
        ]
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_timestamp(arrow_type):
        # ``clickhouse_connect`` returns datetime objects (naive or tz-aware).
        return pa.array(values, type=arrow_type, from_pandas=True)

    return pa.array(values, type=arrow_type, from_pandas=True)


# --------------------------------------------------------------------------
# Client kwargs assembly
# --------------------------------------------------------------------------


def _build_clickhouse_client_kwargs(connection_info: Any) -> dict:
    """Translate ``ClickHouseConnectionInfo`` / ``ConnectionUrl`` into
    ``clickhouse_connect.get_client`` kwargs."""

    # URL-based connection (``ConnectionUrl``).
    if hasattr(connection_info, "connection_url"):
        url = connection_info.connection_url.get_secret_value()
        parsed = urlparse(url)
        if parsed.scheme not in {"clickhouse", "clickhouse+http", "clickhouse+https"}:
            raise WrenError(
                ErrorCode.INVALID_CONNECTION_INFO,
                "ClickHouse connection URL must use clickhouse:// scheme",
            )

        kwargs: dict = dict(parse_qsl(parsed.query))
        info_kwargs = getattr(connection_info, "kwargs", None)
        if info_kwargs:
            kwargs.update(info_kwargs)

        settings: dict = (
            dict(kwargs.pop("settings", {})) if "settings" in kwargs else {}
        )
        statement_timeout = kwargs.pop("statement_timeout", None)
        if statement_timeout is not None:
            settings["max_execution_time"] = int(statement_timeout)

        # urlparse leaves percent-encoded characters in userinfo, so decode
        # them before clickhouse-connect sees the credentials. Matches the
        # mssql / postgres URL handling elsewhere in this package.
        out: dict = {
            "host": parsed.hostname,
            "port": int(parsed.port) if parsed.port else 8123,
            "username": (
                unquote_plus(parsed.username) if parsed.username else "default"
            ),
            "password": unquote_plus(parsed.password) if parsed.password else "",
            "settings": settings,
        }
        if parsed.path and parsed.path != "/":
            out["database"] = parsed.path.lstrip("/")
        if parsed.scheme == "clickhouse+https":
            out["secure"] = True
        # ``settings`` already popped above, so ``out["settings"]`` survives.
        out.update(kwargs)
        return out

    info = connection_info  # ClickHouseConnectionInfo
    settings = dict(info.settings) if info.settings else {}
    kwargs = dict(info.kwargs) if info.kwargs else {}
    statement_timeout = kwargs.pop("statement_timeout", None)
    if statement_timeout is not None:
        settings["max_execution_time"] = int(statement_timeout)
    # Merge any user-supplied ``settings`` from kwargs into the local dict
    # *before* applying the rest, otherwise ``out.update(kwargs)`` below
    # would clobber the statement_timeout-derived max_execution_time.
    extra_settings = kwargs.pop("settings", None)
    if extra_settings:
        settings.update(extra_settings)

    out = {
        "host": info.host,
        "port": int(info.port),
        "username": info.user,
        "password": info.password.get_secret_value() if info.password else "",
        "database": info.database,
        "secure": info.secure,
        "settings": settings,
    }
    out.update(kwargs)
    return out


# --------------------------------------------------------------------------
# Connector
# --------------------------------------------------------------------------


_TRAILING_SEMICOLONS_RE = re.compile(r"[;\s]+\Z")


def _strip_trailing_semicolon(sql: str) -> str:
    """Strip the terminating run of ``;`` characters and surrounding whitespace.

    Matches the canner helper of the same name. Wrapping user SQL as
    ``SELECT * FROM ({sql}) AS _wren_sub LIMIT N`` breaks when ``sql`` ends
    in a semicolon — ClickHouse rejects ``SELECT 1;`` inside a subquery. Only
    the terminating run is removed so semicolons inside string literals
    (e.g. ``SELECT 'a;b'``) are preserved.
    """
    return _TRAILING_SEMICOLONS_RE.sub("", sql)


class ClickHouseConnector(ConnectorABC):
    """Native ``clickhouse-connect`` connector that bypasses ``ibis-project``."""

    def __init__(self, connection_info: Any):
        connect_kwargs = _build_clickhouse_client_kwargs(connection_info)
        self.connection = clickhouse_connect.get_client(**connect_kwargs)
        self._closed = False

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        # Strip the terminating run of ``;`` / whitespace before wrapping —
        # ``SELECT * FROM (SELECT 1;) AS _wren_sub LIMIT N`` is invalid SQL.
        # Semicolons inside string literals are preserved.
        stripped = _strip_trailing_semicolon(sql)
        statement = stripped
        if limit is not None:
            statement = f"SELECT * FROM ({stripped}) AS _wren_sub LIMIT {limit}"
        try:
            result = self.connection.query(statement)
        except _ClickHouseDbError as e:
            if "TIMEOUT_EXCEEDED" in str(e):
                raise DatabaseTimeoutError(str(e)) from e
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_EXECUTION,
                metadata={DIALECT_SQL: sql},
            ) from e
        return _build_clickhouse_arrow_table(result)

    def dry_run(self, sql: str) -> None:
        stripped = _strip_trailing_semicolon(sql)
        try:
            self.connection.query(f"SELECT * FROM ({stripped}) AS _wren_sub LIMIT 0")
        except _ClickHouseDbError as e:
            if "TIMEOUT_EXCEEDED" in str(e):
                raise DatabaseTimeoutError(str(e)) from e
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_DRY_RUN,
                metadata={DIALECT_SQL: sql},
            ) from e

    def close(self) -> None:
        if self._closed or not hasattr(self, "connection") or self.connection is None:
            return
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing ClickHouse connection: {e}")
        finally:
            self._closed = True
            self.connection = None


def create_connector(connection_info: Any) -> ClickHouseConnector:
    return ClickHouseConnector(connection_info)
