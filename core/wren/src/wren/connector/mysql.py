"""Native MySQLdb connector for MySQL and Doris.

Replaces the previous ibis-based implementation. Uses the ``mysqlclient``
(``MySQLdb``) driver directly and builds PyArrow tables from cursor
descriptions so no ibis backend is required.

Doris speaks the MySQL wire protocol and reuses the same query path; it
only differs in how the connection is opened.
"""

from __future__ import annotations

import json
from contextlib import closing
from decimal import Decimal as PyDecimal

import pyarrow as pa
from loguru import logger

from wren.connector.base import ConnectorABC
from wren.model.data_source import DataSource
from wren.model.error import ErrorCode, WrenError


class MySqlConnector(ConnectorABC):
    """Native MySQLdb connector that bypasses ibis-project."""

    def __init__(self, connection_info):
        self.connection = DataSource.mysql.get_connection(connection_info)
        # Append ANSI_QUOTES to the server-configured sql_mode so identifiers
        # quoted as "name" (the MDL convention) are accepted. CONCAT preserves
        # the server defaults (ONLY_FULL_GROUP_BY, STRICT_TRANS_TABLES, …) —
        # overwriting them would let queries silently behave differently than
        # in the user's own MySQL session.
        with closing(self.connection.cursor()) as cursor:
            cursor.execute("SET sql_mode=CONCAT(@@sql_mode, ',ANSI_QUOTES')")
        self._closed = False

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        if limit is not None:
            sql = f"SELECT * FROM ({sql}) AS _sub LIMIT {limit}"
        with closing(self.connection.cursor()) as cursor:
            cursor.execute(sql)
            return _build_mysql_arrow_table(cursor)

    def dry_run(self, sql: str) -> None:
        with closing(self.connection.cursor()) as cursor:
            cursor.execute(f"SELECT * FROM ({sql}) AS _sub LIMIT 0")
            cursor.fetchall()

    def close(self) -> None:
        if self._closed:
            return
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing MySQL connection: {e}")
        finally:
            self._closed = True


class DorisConnector(MySqlConnector):
    """Doris connector. Speaks MySQL protocol; routes through Doris connection."""

    def __init__(self, connection_info):
        # Skip MySqlConnector.__init__ — Doris does not accept the ANSI_QUOTES
        # init command and the connection is created via Doris routing.
        self.connection = DataSource.doris.get_connection(connection_info)
        self._closed = False


def create_connector(data_source: DataSource, connection_info) -> MySqlConnector:
    if data_source == DataSource.doris:
        return DorisConnector(connection_info)
    return MySqlConnector(connection_info)


# ---------------------------------------------------------------------------
# Arrow conversion helpers
# ---------------------------------------------------------------------------

_MYSQL_FIELD_TYPE_TO_ARROW: dict[int, pa.DataType] = {}
_MYSQL_UNSIGNED_VARIANT: dict[int, pa.DataType] = {}
_MYSQL_BLOB_CODES: set[int] = set()
_MYSQL_STRING_CODES: set[int] = set()


def _init_mysql_field_type_map() -> None:
    """Lazily populate the FIELD_TYPE → Arrow map; needs MySQLdb to be importable."""
    if _MYSQL_FIELD_TYPE_TO_ARROW:
        return
    from MySQLdb.constants import FIELD_TYPE as FT  # noqa: PLC0415

    base_map: dict[str, pa.DataType] = {
        "TINY": pa.int8(),
        "SHORT": pa.int16(),
        "LONG": pa.int32(),
        "INT24": pa.int32(),
        "LONGLONG": pa.int64(),
        "FLOAT": pa.float32(),
        "DOUBLE": pa.float64(),
        "DECIMAL": pa.decimal128(38, 9),
        "NEWDECIMAL": pa.decimal128(38, 9),
        "STRING": pa.string(),
        "VAR_STRING": pa.string(),
        "VARCHAR": pa.string(),
        "ENUM": pa.string(),
        "SET": pa.string(),
        "TINY_BLOB": pa.binary(),
        "MEDIUM_BLOB": pa.binary(),
        "LONG_BLOB": pa.binary(),
        "BLOB": pa.binary(),
        "JSON": pa.string(),
        "DATE": pa.date32(),
        "NEWDATE": pa.date32(),
        "TIME": pa.time64("us"),
        "DATETIME": pa.timestamp("us"),
        "TIMESTAMP": pa.timestamp("us"),
        "YEAR": pa.int16(),
        "BIT": pa.binary(),
        "GEOMETRY": pa.string(),
        "NULL": pa.null(),
    }
    for name, arrow_type in base_map.items():
        code = getattr(FT, name, None)
        if code is not None:
            _MYSQL_FIELD_TYPE_TO_ARROW[code] = arrow_type


def _init_mysql_aux_maps() -> None:
    """Populate the UNSIGNED / BLOB / STRING code sets once per process."""
    if _MYSQL_UNSIGNED_VARIANT:
        return
    from MySQLdb.constants import FIELD_TYPE as FT  # noqa: PLC0415

    for name, arrow_type in (
        ("TINY", pa.uint8()),
        ("SHORT", pa.uint16()),
        ("LONG", pa.uint32()),
        ("INT24", pa.uint32()),
        ("LONGLONG", pa.uint64()),
    ):
        code = getattr(FT, name, None)
        if code is not None:
            _MYSQL_UNSIGNED_VARIANT[code] = arrow_type
    for n in ("BLOB", "TINY_BLOB", "MEDIUM_BLOB", "LONG_BLOB"):
        code = getattr(FT, n, None)
        if code is not None:
            _MYSQL_BLOB_CODES.add(code)
    for n in ("STRING", "VAR_STRING", "VARCHAR"):
        code = getattr(FT, n, None)
        if code is not None:
            _MYSQL_STRING_CODES.add(code)


def _mysql_field_arrow_type(type_code: int, flags: int = 0) -> pa.DataType:
    _init_mysql_field_type_map()
    _init_mysql_aux_maps()

    from MySQLdb.constants import FLAG  # noqa: PLC0415

    base = _MYSQL_FIELD_TYPE_TO_ARROW.get(type_code, pa.string())

    if flags & FLAG.UNSIGNED and type_code in _MYSQL_UNSIGNED_VARIANT:
        return _MYSQL_UNSIGNED_VARIANT[type_code]

    # MySQL packs both TEXT and BLOB into FIELD_TYPE.*BLOB; BINARY flag is the
    # discriminator. Without BINARY they are TEXT (string); with BINARY they
    # are real BLOB (bytes — keep base type).
    if type_code in _MYSQL_BLOB_CODES and not (flags & FLAG.BINARY):
        return pa.string()

    # STRING / VAR_STRING with BINARY flag is BINARY/VARBINARY (bytes).
    if type_code in _MYSQL_STRING_CODES and (flags & FLAG.BINARY):
        return pa.binary()

    return base


def _build_mysql_arrow_table(cursor) -> pa.Table:
    """Convert a MySQLdb cursor result to a PyArrow table."""
    if cursor.description is None:
        return pa.table({})

    # ``cursor.description_flags`` is a tuple of int flag bitmasks in
    # MySQLdb 2.x. Older / non-MySQLdb cursors may not provide it; in that
    # case we fall back to zero flags (BLOB → string, ignore UNSIGNED).
    flags_attr = getattr(cursor, "description_flags", None)
    if flags_attr is not None:
        flag_list = list(flags_attr)
    else:
        flag_list = [0] * len(cursor.description)
    flag_list = (flag_list + [0] * len(cursor.description))[: len(cursor.description)]

    rows = cursor.fetchall()
    fields = [
        pa.field(
            col[0], _mysql_field_arrow_type(col[1], flag_list[i] or 0), nullable=True
        )
        for i, col in enumerate(cursor.description)
    ]
    schema = pa.schema(fields)

    if not rows:
        arrays = [pa.array([], type=field.type) for field in schema]
    else:
        arrays = [
            _build_mysql_column([row[i] for row in rows], schema.field(i).type)
            for i in range(len(fields))
        ]
    return pa.table(
        dict(zip([f.name for f in fields], arrays, strict=False)),
        schema=schema,
    )


def _build_mysql_column(values: list, arrow_type: pa.DataType) -> pa.Array:
    """Convert MySQLdb values into a PyArrow array of the given Arrow type."""
    if pa.types.is_string(arrow_type):
        processed = []
        for v in values:
            if v is None:
                processed.append(None)
            elif isinstance(v, bytes):
                processed.append(v.decode("utf-8", errors="replace"))
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
        return pa.array(values, type=arrow_type, from_pandas=True)

    if pa.types.is_time(arrow_type):
        # MySQLdb returns TIME columns as ``datetime.timedelta``; PyArrow needs
        # an integer microsecond offset for time64. Convert here, preserving
        # None.
        import datetime  # noqa: PLC0415

        processed = [
            None
            if v is None
            else (
                v.days * 86_400_000_000 + v.seconds * 1_000_000 + v.microseconds
                if isinstance(v, datetime.timedelta)
                else v
            )
            for v in values
        ]
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_null(arrow_type):
        return pa.array([None] * len(values), type=pa.null())

    return pa.array(values, type=arrow_type, from_pandas=True)


# ---------------------------------------------------------------------------
# Connect kwargs helpers
# ---------------------------------------------------------------------------


def _build_mysql_connect_kwargs(connection_info) -> dict:
    """Translate ``MySqlConnectionInfo`` / ``ConnectionUrl`` into MySQLdb kwargs."""
    from urllib.parse import parse_qsl, unquote_plus, urlparse  # noqa: PLC0415

    if hasattr(connection_info, "connection_url"):
        url = connection_info.connection_url.get_secret_value()
        parsed = urlparse(url)
        if parsed.scheme not in {"mysql", "mysql+pymysql", "mysql+mysqldb"}:
            raise WrenError(
                ErrorCode.INVALID_CONNECTION_INFO,
                "MySQL connection URL must use mysql:// scheme",
            )

        kwargs = dict(parse_qsl(parsed.query))
        if connection_info.kwargs:
            kwargs.update(connection_info.kwargs)

        host = parsed.hostname or "127.0.0.1"
        if host == "localhost":
            host = "127.0.0.1"

        out: dict = {
            "host": host,
            "port": int(parsed.port) if parsed.port else 3306,
            "user": parsed.username,
            "passwd": unquote_plus(parsed.password) if parsed.password else "",
            "db": parsed.path.lstrip("/") if parsed.path else None,
            "charset": "utf8mb4",
            "use_unicode": True,
            "autocommit": True,
        }
        out.update(kwargs)
        return out

    info = connection_info
    kwargs = dict(info.kwargs) if info.kwargs else {}

    # MySQLdb routes host="localhost" through a unix socket by default; force
    # TCP by normalising it to 127.0.0.1.
    host = info.host
    if host == "localhost":
        host = "127.0.0.1"

    out = {
        "host": host,
        "port": int(info.port),
        "user": info.user,
        "passwd": (info.password.get_secret_value() if info.password else ""),
        "db": info.database,
        "charset": "utf8mb4",
        "use_unicode": True,
        "autocommit": True,
    }
    ssl = _mysql_ssl_kwargs(info)
    if ssl is not None:
        out["ssl"] = ssl
        out["ssl_mode"] = "VERIFY_CA" if "ca" in ssl else "REQUIRED"
    out.update(kwargs)
    return out


def _build_doris_connect_kwargs(connection_info) -> dict:
    """Translate ``DorisConnectionInfo`` / ``ConnectionUrl`` into MySQLdb kwargs."""
    if hasattr(connection_info, "connection_url"):
        return _build_mysql_connect_kwargs(connection_info)

    info = connection_info
    kwargs = dict(info.kwargs) if info.kwargs else {}
    host = info.host
    if host == "localhost":
        host = "127.0.0.1"
    out = {
        "host": host,
        "port": int(info.port),
        "user": info.user,
        "passwd": (info.password.get_secret_value() if info.password else ""),
        "db": info.database,
        "charset": "utf8mb4",
        "use_unicode": True,
        "autocommit": True,
    }
    out.update(kwargs)
    return out


def _mysql_ssl_kwargs(info) -> dict | None:
    """Build the MySQLdb ``ssl`` kwarg dict from ``MySqlConnectionInfo`` SSL fields."""
    ssl_mode = info.ssl_mode if hasattr(info, "ssl_mode") and info.ssl_mode else None
    ssl_mode = ssl_mode.lower() if ssl_mode else None
    if not ssl_mode or ssl_mode == "disabled":
        return None
    if ssl_mode == "verify_ca":
        if not info.ssl_ca:
            raise WrenError(
                ErrorCode.INVALID_CONNECTION_INFO,
                "SSL CA must be provided when SSL mode is VERIFY CA",
            )
        return {"ca": info.ssl_ca.get_secret_value()}
    # 'enabled' / any other non-disabled mode: require SSL without CA verification.
    return {}
