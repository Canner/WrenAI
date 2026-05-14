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
from functools import cache

import pyarrow as pa
from loguru import logger

from wren.connector.base import ConnectorABC
from wren.model.data_source import DataSource
from wren.model.error import ErrorCode, WrenError


def _apply_limit(sql: str, limit: int) -> str:
    """Append ``LIMIT n`` to a user-supplied SQL string.

    Strips any trailing semicolon and whitespace, then appends ``LIMIT n``.
    ``limit`` MUST already be validated as a non-negative ``int`` by the caller
    — this helper does not re-validate to keep the call site explicit.

    Wrapping the user SQL in ``SELECT * FROM (...) AS _sub LIMIT n`` was
    rejected because it fails with ``ER_DUP_FIELDNAME`` whenever the inner
    SELECT projects two columns with the same name (e.g. a join that selects
    ``a.id`` and ``b.id``).
    """
    return f"{sql.rstrip().rstrip(';').rstrip()}\nLIMIT {limit}"


def _coerce_limit(limit: int | None) -> int | None:
    """Validate and coerce a user-supplied ``limit`` to a non-negative ``int``.

    ``int(limit)`` rejects strings like ``"5 OR 1=1"`` so the value can be
    safely interpolated into SQL. Negative limits are also rejected.
    """
    if limit is None:
        return None
    coerced = int(limit)
    if coerced < 0:
        raise ValueError(f"limit must be non-negative, got {coerced}")
    return coerced


class MySqlConnector(ConnectorABC):
    """Native MySQLdb connector that bypasses ibis-project."""

    def __init__(self, connection_info):
        self._closed = False
        self.connection = DataSource.mysql.get_connection(connection_info)
        # Append ANSI_QUOTES to the server-configured sql_mode so identifiers
        # quoted as "name" (the MDL convention) are accepted. CONCAT preserves
        # the server defaults (ONLY_FULL_GROUP_BY, STRICT_TRANS_TABLES, …) —
        # overwriting them would let queries silently behave differently than
        # in the user's own MySQL session.
        #
        # If this init query fails we MUST close the connection so it isn't
        # leaked; the cursor exception would otherwise leave a live socket
        # held by the (now half-constructed) connector.
        try:
            with closing(self.connection.cursor()) as cursor:
                cursor.execute("SET sql_mode=CONCAT(@@sql_mode, ',ANSI_QUOTES')")
        except Exception:
            try:
                self.connection.close()
            except Exception as close_err:
                logger.warning(
                    f"Error closing MySQL connection after init failure: {close_err}"
                )
            finally:
                self._closed = True
            raise

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        limit = _coerce_limit(limit)
        if limit is not None:
            sql = _apply_limit(sql, limit)
        with closing(self.connection.cursor()) as cursor:
            cursor.execute(sql)
            return _build_mysql_arrow_table(cursor)

    def dry_run(self, sql: str) -> None:
        # ``EXPLAIN`` validates the SQL on the server (table lookup, column
        # resolution, syntax) without executing it. Prefixing instead of
        # subquery-wrapping side-steps ``ER_DUP_FIELDNAME`` for queries that
        # surface duplicate column names. We strip a trailing semicolon to
        # match the same compose-ability we use for ``query``'s LIMIT path.
        explain_sql = f"EXPLAIN {sql.rstrip().rstrip(';').rstrip()}"
        with closing(self.connection.cursor()) as cursor:
            cursor.execute(explain_sql)
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
        self._closed = False
        self.connection = DataSource.doris.get_connection(connection_info)


def create_connector(data_source: DataSource, connection_info) -> MySqlConnector:
    if data_source == DataSource.doris:
        return DorisConnector(connection_info)
    return MySqlConnector(connection_info)


# ---------------------------------------------------------------------------
# Arrow conversion helpers
# ---------------------------------------------------------------------------

# MySQL ``DECIMAL(M, D)`` allows ``M`` up to 65 and ``D`` up to 30, while
# PyArrow's ``decimal128`` only supports precision up to 38. We clamp the
# precision derived from ``cursor.description`` to ``38`` and the scale to
# ``min(precision, 30)`` so PyArrow can still represent the value. A future
# change could switch to ``decimal256`` when MySQL exceeds 38 digits.
_ARROW_DECIMAL128_MAX_PRECISION = 38
_MYSQL_DECIMAL_MAX_SCALE = 30
# Fallback used when ``cursor.description`` does not carry precision/scale
# (e.g. for the legacy ``FIELD_TYPE.DECIMAL`` code or non-MySQLdb cursors).
_MYSQL_DECIMAL_FALLBACK_PRECISION = 38
_MYSQL_DECIMAL_FALLBACK_SCALE = 9


@cache
def _mysql_field_type_map() -> dict[int, pa.DataType]:
    """Build the FIELD_TYPE → Arrow map once per process.

    Returns a fully-populated local dict, then ``functools.cache`` publishes
    the reference atomically. Concurrent callers either see the fully-built
    dict or wait on the cache's GIL-protected slot — they never observe a
    partially-populated map.
    """
    from MySQLdb.constants import FIELD_TYPE as FT  # noqa: PLC0415

    base_map: dict[str, pa.DataType] = {
        "TINY": pa.int8(),
        "SHORT": pa.int16(),
        "LONG": pa.int32(),
        "INT24": pa.int32(),
        "LONGLONG": pa.int64(),
        "FLOAT": pa.float32(),
        "DOUBLE": pa.float64(),
        # ``DECIMAL`` / ``NEWDECIMAL`` are placeholders — the actual precision
        # and scale are read from ``cursor.description`` per-column.
        "DECIMAL": pa.decimal128(
            _MYSQL_DECIMAL_FALLBACK_PRECISION, _MYSQL_DECIMAL_FALLBACK_SCALE
        ),
        "NEWDECIMAL": pa.decimal128(
            _MYSQL_DECIMAL_FALLBACK_PRECISION, _MYSQL_DECIMAL_FALLBACK_SCALE
        ),
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
        # MySQL ``TIME`` ranges ``-838:59:59`` to ``838:59:59`` and can be
        # negative — semantics PyArrow ``time64("us")`` cannot represent
        # (it only accepts 0–24h positive values). ``duration("us")`` is the
        # smallest Arrow type that captures the full MySQL range without loss.
        "TIME": pa.duration("us"),
        "DATETIME": pa.timestamp("us"),
        "TIMESTAMP": pa.timestamp("us"),
        "YEAR": pa.int16(),
        "BIT": pa.binary(),
        "GEOMETRY": pa.string(),
        "NULL": pa.null(),
    }
    result: dict[int, pa.DataType] = {}
    for name, arrow_type in base_map.items():
        code = getattr(FT, name, None)
        if code is not None:
            result[code] = arrow_type
    return result


@cache
def _mysql_unsigned_variant_map() -> dict[int, pa.DataType]:
    """Build the FIELD_TYPE → unsigned-Arrow map once per process."""
    from MySQLdb.constants import FIELD_TYPE as FT  # noqa: PLC0415

    result: dict[int, pa.DataType] = {}
    for name, arrow_type in (
        ("TINY", pa.uint8()),
        ("SHORT", pa.uint16()),
        ("LONG", pa.uint32()),
        ("INT24", pa.uint32()),
        ("LONGLONG", pa.uint64()),
    ):
        code = getattr(FT, name, None)
        if code is not None:
            result[code] = arrow_type
    return result


@cache
def _mysql_blob_codes() -> frozenset[int]:
    """Build the set of BLOB-family FIELD_TYPE codes once per process."""
    from MySQLdb.constants import FIELD_TYPE as FT  # noqa: PLC0415

    return frozenset(
        code
        for code in (
            getattr(FT, n, None)
            for n in ("BLOB", "TINY_BLOB", "MEDIUM_BLOB", "LONG_BLOB")
        )
        if code is not None
    )


@cache
def _mysql_string_codes() -> frozenset[int]:
    """Build the set of STRING-family FIELD_TYPE codes once per process."""
    from MySQLdb.constants import FIELD_TYPE as FT  # noqa: PLC0415

    return frozenset(
        code
        for code in (getattr(FT, n, None) for n in ("STRING", "VAR_STRING", "VARCHAR"))
        if code is not None
    )


@cache
def _mysql_decimal_codes() -> frozenset[int]:
    """Build the set of DECIMAL-family FIELD_TYPE codes once per process."""
    from MySQLdb.constants import FIELD_TYPE as FT  # noqa: PLC0415

    return frozenset(
        code
        for code in (getattr(FT, n, None) for n in ("DECIMAL", "NEWDECIMAL"))
        if code is not None
    )


def _arrow_decimal_from_mysql_field(
    display_length: int | None,
    scale: int | None,
    is_unsigned: bool = False,
) -> pa.DataType:
    """Derive a ``pa.decimal128`` type from a MySQLdb ``cursor.description`` entry.

    MySQLdb populates ``description[4]`` (PEP 249 ``precision``) with the
    ``MYSQL_FIELD.length`` — i.e. the *display length*, which includes one
    byte for the decimal point (when ``D > 0``) and one byte for the sign
    when the column is signed. The declared ``DECIMAL(M, D)`` precision ``M``
    is recovered as::

        M = length - (1 if unsigned else 0) - (1 if D > 0 else 0)

    MySQL allows precision up to 65 and scale up to 30, but Arrow
    ``decimal128`` caps precision at 38. We clamp precision to 38 and clamp
    scale to ``min(scale, precision, 30)`` so any value MySQL accepts (within
    the 38-digit Arrow ceiling) round-trips correctly. The previous
    hard-coded ``decimal128(38, 9)`` would silently lose digits when ``D > 9``.
    """
    if display_length is None or display_length <= 0:
        precision = _MYSQL_DECIMAL_FALLBACK_PRECISION
    else:
        derived_scale = scale if scale is not None and scale >= 0 else 0
        sign_overhead = 0 if is_unsigned else 1
        point_overhead = 1 if derived_scale > 0 else 0
        precision = int(display_length) - sign_overhead - point_overhead
        if precision <= 0:
            precision = _MYSQL_DECIMAL_FALLBACK_PRECISION
    if scale is None or scale < 0:
        scale = _MYSQL_DECIMAL_FALLBACK_SCALE
    precision = min(int(precision), _ARROW_DECIMAL128_MAX_PRECISION)
    scale = min(int(scale), _MYSQL_DECIMAL_MAX_SCALE, precision)
    return pa.decimal128(precision, scale)


def _mysql_field_arrow_type(
    type_code: int,
    flags: int = 0,
    precision: int | None = None,
    scale: int | None = None,
) -> pa.DataType:
    from MySQLdb.constants import FLAG  # noqa: PLC0415

    field_map = _mysql_field_type_map()
    unsigned_map = _mysql_unsigned_variant_map()
    blob_codes = _mysql_blob_codes()
    string_codes = _mysql_string_codes()
    decimal_codes = _mysql_decimal_codes()

    base = field_map.get(type_code, pa.string())

    if flags & FLAG.UNSIGNED and type_code in unsigned_map:
        return unsigned_map[type_code]

    # DECIMAL precision/scale come from ``cursor.description`` (PEP 249 fields
    # ``precision`` / ``scale``). MySQL ``DECIMAL(M, D)`` allows scale up to 30
    # — the previous hard-coded ``decimal128(38, 9)`` would lose digits when
    # ``D > 9``.
    if type_code in decimal_codes:
        return _arrow_decimal_from_mysql_field(
            precision, scale, is_unsigned=bool(flags & FLAG.UNSIGNED)
        )

    # MySQL packs both TEXT and BLOB into FIELD_TYPE.*BLOB; BINARY flag is the
    # discriminator. Without BINARY they are TEXT (string); with BINARY they
    # are real BLOB (bytes — keep base type).
    if type_code in blob_codes and not (flags & FLAG.BINARY):
        return pa.string()

    # STRING / VAR_STRING with BINARY flag is BINARY/VARBINARY (bytes).
    if type_code in string_codes and (flags & FLAG.BINARY):
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
    fields = []
    for i, col in enumerate(cursor.description):
        # PEP 249 ``description`` tuple:
        #   (name, type_code, display_size, internal_size, precision, scale, null_ok)
        # MySQLdb populates ``precision``/``scale`` for ``NEWDECIMAL`` columns,
        # which lets us reflect the actual ``DECIMAL(M, D)`` instead of using
        # a hard-coded ``decimal128(38, 9)``.
        precision = col[4] if len(col) > 4 else None
        scale = col[5] if len(col) > 5 else None
        arrow_type = _mysql_field_arrow_type(
            col[1], flag_list[i] or 0, precision=precision, scale=scale
        )
        fields.append(pa.field(col[0], arrow_type, nullable=True))
    schema = pa.schema(fields)

    if not rows:
        arrays = [pa.array([], type=field.type) for field in schema]
    else:
        arrays = [
            _build_mysql_column([row[i] for row in rows], schema.field(i).type)
            for i in range(len(fields))
        ]
    # ``pa.table(dict(...), schema=...)`` silently drops a column when two
    # fields share the same name (the dict collapses the duplicate). Use
    # ``pa.Table.from_arrays`` so a query like
    # ``SELECT a.id, b.id FROM t a JOIN t b`` round-trips both ``id``
    # columns instead of returning a one-column table.
    return pa.Table.from_arrays(arrays, schema=schema)


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

    if pa.types.is_duration(arrow_type):
        # MySQLdb returns TIME columns as ``datetime.timedelta``. PyArrow's
        # ``duration("us")`` accepts ``timedelta`` directly, but we convert to
        # signed microseconds explicitly so negative values (MySQL TIME may go
        # down to ``-838:59:59``) and values beyond 24h survive without loss.
        # ``timedelta.total_seconds() * 1e6`` would lose precision; we instead
        # combine ``days``, ``seconds`` and ``microseconds`` — all of which are
        # signed on negative ``timedelta`` values.
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
