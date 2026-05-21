"""Native Trino connector that talks to the trino python client directly.

This module bypasses ibis-framework[trino]; ``cursor.description`` exposes
Trino type strings (``array(row("a" integer, "b" varchar))`` etc.) which we
lex with sqlglot to build an equivalent PyArrow schema.
"""

from __future__ import annotations

import contextlib
import datetime as dtlib
import json
from decimal import Decimal as PyDecimal
from urllib.parse import parse_qsl, urlparse

import pyarrow as pa
import sqlglot
import sqlglot.errors
from loguru import logger
from sqlglot.expressions import ColumnDef, DataType

from wren.connector.base import ConnectorABC
from wren.model.error import (
    DIALECT_SQL,
    ErrorCode,
    ErrorPhase,
    WrenError,
)


def _parse_trino_data_type(type_str: str | None) -> pa.DataType:
    """Parse a Trino type string from ``cursor.description`` into an Arrow type.

    Delegates the lexing/parsing to sqlglot and walks the resulting DataType
    AST to build the equivalent PyArrow type. sqlglot handles the awkward
    cases (anonymous row fields whose type contains whitespace, nested
    array/map/row, decimal(p,s), etc.).
    """
    if type_str is None:
        return pa.string()
    try:
        parsed = sqlglot.parse_one(type_str, into=DataType, dialect="trino")
    except sqlglot.errors.ParseError:
        logger.warning(f"Failed to parse trino type string: {type_str}")
        return pa.string()
    if parsed is None:
        return pa.string()
    return _trino_data_type_to_arrow(parsed)


_TRINO_DATA_TYPE_TO_ARROW: dict = {}


def _init_trino_data_type_map() -> None:
    if _TRINO_DATA_TYPE_TO_ARROW:
        return

    T = DataType.Type
    _TRINO_DATA_TYPE_TO_ARROW.update(
        {
            T.BOOLEAN: pa.bool_(),
            T.TINYINT: pa.int8(),
            T.SMALLINT: pa.int16(),
            T.INT: pa.int32(),
            T.BIGINT: pa.int64(),
            T.FLOAT: pa.float32(),
            T.DOUBLE: pa.float64(),
            T.VARCHAR: pa.string(),
            T.CHAR: pa.string(),
            T.NCHAR: pa.string(),
            T.NVARCHAR: pa.string(),
            T.TEXT: pa.string(),
            T.JSON: pa.string(),
            T.UUID: pa.string(),
            T.IPADDRESS: pa.string(),
            T.HLLSKETCH: pa.string(),  # hyperloglog
            T.GEOMETRY: pa.string(),
            T.VARBINARY: pa.binary(),
            T.BINARY: pa.binary(),
            T.DATE: pa.date32(),
            T.TIME: pa.time64("us"),
            T.TIMETZ: pa.time64("us"),
            # Millisecond precision matches PyArrow's default and keeps round-trip
            # behaviour stable for ``timestamp(n)`` results across Trino versions.
            T.TIMESTAMP: pa.timestamp("ms"),
            T.TIMESTAMPTZ: pa.timestamp("ms", tz="UTC"),
            T.TIMESTAMPLTZ: pa.timestamp("ms", tz="UTC"),
        }
    )


def _trino_data_type_to_arrow(node) -> pa.DataType:
    _init_trino_data_type_map()
    if not isinstance(node, DataType):
        # e.g. Interval — fall back to string representation.
        return pa.string()

    kind = node.this
    T = DataType.Type
    if kind in _TRINO_DATA_TYPE_TO_ARROW:
        return _TRINO_DATA_TYPE_TO_ARROW[kind]

    if kind == T.DECIMAL:
        precision, scale = 38, 9
        params = node.expressions
        if len(params) >= 1:
            with contextlib.suppress(AttributeError, ValueError):
                precision = min(int(params[0].this.this), 38)
        if len(params) >= 2:
            with contextlib.suppress(AttributeError, ValueError):
                scale = min(int(params[1].this.this), precision)
        return pa.decimal128(precision, scale)

    if kind == T.ARRAY:
        inner = node.expressions[0] if node.expressions else None
        return pa.list_(_trino_data_type_to_arrow(inner) if inner else pa.string())

    if kind == T.MAP:
        if len(node.expressions) >= 2:
            return pa.map_(
                _trino_data_type_to_arrow(node.expressions[0]),
                _trino_data_type_to_arrow(node.expressions[1]),
            )
        return pa.string()

    if kind == T.STRUCT:
        fields: list[pa.Field] = []
        for idx, child in enumerate(node.expressions):
            if isinstance(child, ColumnDef):
                # Named row field: row(a integer, b varchar)
                name = child.name or f"f{idx}"
                inner = child.args.get("kind")
                fields.append(
                    pa.field(
                        name,
                        _trino_data_type_to_arrow(inner) if inner else pa.string(),
                    )
                )
            else:
                # Anonymous row field: row(map(varchar,integer), bigint)
                fields.append(pa.field(f"f{idx}", _trino_data_type_to_arrow(child)))
        return pa.struct(fields)

    return pa.string()


def _build_trino_column(values: list, arrow_type: pa.DataType) -> pa.Array:
    """Convert trino DB-API values to a PyArrow array of the given Arrow type."""
    if pa.types.is_string(arrow_type):
        processed = []
        for v in values:
            if v is None:
                processed.append(None)
            elif isinstance(v, dict | list | tuple):
                processed.append(json.dumps(v, default=str))
            elif isinstance(v, str):
                processed.append(v)
            else:
                processed.append(str(v))
        return pa.array(processed, type=pa.string(), from_pandas=True)

    if pa.types.is_binary(arrow_type):
        processed = [bytes(v) if isinstance(v, memoryview) else v for v in values]
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_decimal(arrow_type):
        processed = [
            None
            if v is None
            else (v if isinstance(v, PyDecimal) else PyDecimal(str(v)))
            for v in values
        ]
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_timestamp(arrow_type):
        # The trino driver returns either datetime objects or ISO-8601 strings
        # depending on column type and adapter settings; normalise to datetime.
        processed = []
        for v in values:
            if v is None or isinstance(v, dtlib.datetime):
                processed.append(v)
            else:
                try:
                    processed.append(dtlib.datetime.fromisoformat(str(v)))
                except ValueError:
                    processed.append(None)
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_date(arrow_type):
        processed = []
        for v in values:
            if v is None or isinstance(v, dtlib.date):
                processed.append(v)
            else:
                try:
                    processed.append(dtlib.date.fromisoformat(str(v)))
                except ValueError:
                    processed.append(None)
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_time(arrow_type):
        processed = []
        for v in values:
            if v is None or isinstance(v, dtlib.time):
                processed.append(v)
            else:
                try:
                    processed.append(dtlib.time.fromisoformat(str(v)))
                except ValueError:
                    processed.append(None)
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_struct(arrow_type):
        # The trino driver returns Python tuples for row(...) values. PyArrow
        # accepts dicts keyed by field name; convert to make field order
        # mismatch (e.g. anonymous row) explicit.
        names = [f.name for f in arrow_type]
        processed: list = []
        for v in values:
            if v is None:
                processed.append(None)
            elif isinstance(v, dict):
                processed.append(v)
            else:
                processed.append(dict(zip(names, v, strict=False)))
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_map(arrow_type):
        # PyArrow's map_ constructor expects an iterable of (key, value) pairs;
        # the trino driver returns Python dicts.
        processed = [None if v is None else list(v.items()) for v in values]
        return pa.array(processed, type=arrow_type, from_pandas=True)

    return pa.array(values, type=arrow_type, from_pandas=True)


def _build_trino_arrow_table(cursor) -> pa.Table:
    """Convert a trino DB-API cursor result to a PyArrow table."""
    if cursor.description is None:
        return pa.table({})

    rows = cursor.fetchall()
    fields = [
        pa.field(col[0], _parse_trino_data_type(col[1]), nullable=True)
        for col in cursor.description
    ]
    schema = pa.schema(fields)

    if not rows:
        arrays = [pa.array([], type=field.type) for field in schema]
    else:
        arrays = [
            _build_trino_column([row[i] for row in rows], schema.field(i).type)
            for i in range(len(fields))
        ]

    return pa.table(
        dict(zip([f.name for f in fields], arrays, strict=False)),
        schema=schema,
    )


def _build_trino_connect_kwargs(connection_info) -> dict:
    """Build kwargs for ``trino.dbapi.connect`` from either a typed
    ``TrinoConnectionInfo`` or a generic ``ConnectionUrl``.

    Returns a dict that may contain the sentinel ``_password`` key — the caller
    is expected to pop it before passing the dict to ``trino_connect``.
    """
    if hasattr(connection_info, "connection_url"):
        url = connection_info.connection_url.get_secret_value()
        return _parse_trino_url(url, connection_info.kwargs)

    info = connection_info  # TrinoConnectionInfo
    kwargs = dict(info.kwargs) if info.kwargs else {}
    password = info.password.get_secret_value() if info.password else None

    out: dict = {
        "host": info.host,
        "port": int(info.port),
        "user": info.user,
        "catalog": info.catalog,
        "schema": info.trino_schema,
        # Pin session timezone to UTC so CAST('...' AS TIMESTAMP WITH TIME ZONE)
        # produces deterministic results across deployments.
        "timezone": "UTC",
        "_password": password,
    }
    out.update(kwargs)
    return out


def _parse_trino_url(url: str, extra_kwargs: dict | None) -> dict:
    """Parse a ``trino://[user[:pwd]@]host[:port][/catalog[/schema]][?...]`` URL.

    Returns the same ``_password`` sentinel-key shape as
    :func:`_build_trino_connect_kwargs`.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"trino", "trino+https"}:
        raise WrenError(
            ErrorCode.INVALID_CONNECTION_INFO,
            "Trino connection URL must use trino:// scheme",
        )

    if not parsed.username:
        raise WrenError(
            ErrorCode.INVALID_CONNECTION_INFO,
            "Trino connection URL must include a username",
        )

    path_parts = parsed.path.lstrip("/").split("/")
    catalog = path_parts[0] if path_parts and path_parts[0] else None
    schema = path_parts[1] if len(path_parts) > 1 else None

    query_kwargs = dict(parse_qsl(parsed.query))
    if extra_kwargs:
        query_kwargs.update(extra_kwargs)

    out: dict = {
        "host": parsed.hostname,
        "port": int(parsed.port or 8080),
        "user": parsed.username,
        "catalog": catalog,
        "schema": schema,
        "timezone": "UTC",
        "_password": parsed.password,
    }
    if parsed.scheme == "trino+https":
        out["http_scheme"] = "https"
    out.update(query_kwargs)
    return out


_TRINO_IMPORT_HINT = (
    "The 'trino' package is required for the Trino connector. "
    "Install it with: pip install wren-engine[trino]"
)


def _import_trino():
    """Lazy import of the ``trino`` package with a clear install hint."""
    try:
        import trino  # noqa: PLC0415

        return trino
    except ImportError as e:
        raise WrenError(
            ErrorCode.INVALID_CONNECTION_INFO,
            f"{_TRINO_IMPORT_HINT} (original error: {e})",
        ) from e


def _strip_trailing_semicolon(sql: str) -> str:
    """Strip trailing whitespace and an optional final semicolon.

    Wrapping ``SELECT * FROM ({sql}) AS _sub LIMIT N`` breaks if ``sql`` ends
    with ``;`` because the parser sees ``...; ) AS _sub...``.
    """
    return sql.rstrip().removesuffix(";").rstrip()


class TrinoConnector(ConnectorABC):
    """Native trino DB-API connector that bypasses ibis-project."""

    def __init__(self, connection_info):
        trino = _import_trino()
        BasicAuthentication = trino.auth.BasicAuthentication
        JWTAuthentication = trino.auth.JWTAuthentication
        trino_connect = trino.dbapi.connect

        connect_kwargs = _build_trino_connect_kwargs(connection_info)
        password = connect_kwargs.pop("_password", None)
        token = connect_kwargs.pop("access_token", None)

        if connect_kwargs.get("auth") is None:
            user = connect_kwargs.get("user")
            if token:
                connect_kwargs["auth"] = JWTAuthentication(token)
                connect_kwargs.setdefault("http_scheme", "https")
            elif user and password:
                connect_kwargs["auth"] = BasicAuthentication(user, password)
                connect_kwargs.setdefault("http_scheme", "https")

        self.connection = trino_connect(**connect_kwargs)
        self._closed = False

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        trino = _import_trino()

        if limit is not None:
            sql = f"SELECT * FROM ({_strip_trailing_semicolon(sql)}) AS _sub LIMIT {limit}"
        try:
            with contextlib.closing(self.connection.cursor()) as cursor:
                cursor.execute(sql)
                return _build_trino_arrow_table(cursor)
        except trino.exceptions.TrinoQueryError as e:
            if e.error_name == "EXCEEDED_TIME_LIMIT":
                raise
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_EXECUTION,
                metadata={DIALECT_SQL: sql},
            ) from e
        except (WrenError, TimeoutError):
            raise

    def dry_run(self, sql: str) -> None:
        trino = _import_trino()

        wrapped = f"SELECT * FROM ({_strip_trailing_semicolon(sql)}) AS _sub LIMIT 0"
        try:
            with contextlib.closing(self.connection.cursor()) as cursor:
                cursor.execute(wrapped)
                cursor.fetchall()
        except trino.exceptions.TrinoQueryError as e:
            if e.error_name == "EXCEEDED_TIME_LIMIT":
                raise
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_DRY_RUN,
                metadata={DIALECT_SQL: sql},
            ) from e
        except (WrenError, TimeoutError):
            raise

    def close(self) -> None:
        if self._closed or self.connection is None:
            return
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing Trino connection: {e}")
        finally:
            self._closed = True
            self.connection = None


def create_connector(data_source, connection_info) -> TrinoConnector:
    return TrinoConnector(connection_info)
