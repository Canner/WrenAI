"""Native oracledb connector — bypasses ibis oracle backend."""

from decimal import Decimal as PyDecimal
from urllib.parse import unquote, urlparse

import pyarrow as pa

# Lazy driver import: keep the module importable without the ``oracle`` extra so
# URL-decode/helper tests run under plain unit deps (mirrors the mysql/mssql/
# clickhouse connectors). ``oracledb`` is only touched when a connection is
# actually made.
try:
    import oracledb
except ImportError:  # pragma: no cover
    oracledb = None

from wren.connector.base import ConnectorABC, strip_trailing_semicolon
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError


def _parse_oracle_connection_url(url: str):
    """Parse an Oracle URL after escaping raw brackets in userinfo only.

    ``urllib.parse.urlparse`` treats ``[`` / ``]`` anywhere in the netloc as
    IPv6 host delimiters. That is correct for hosts like ``oracle://[::1]/db``
    but it raises ``ValueError`` on raw credentials such as
    ``oracle://user:p[a]ss@host/svc``. Sanitise only the userinfo segment so
    valid IPv6 hosts still parse. Mirrors the MySQL connector helper.
    """
    scheme_idx = url.find("://")
    if scheme_idx == -1:
        return urlparse(url)

    prefix = url[: scheme_idx + 3]
    rest = url[scheme_idx + 3 :]

    authority_end = len(rest)
    for separator in "/?#":
        idx = rest.find(separator)
        if idx != -1:
            authority_end = min(authority_end, idx)

    authority = rest[:authority_end]
    if "@" not in authority:
        return urlparse(url)

    userinfo, hostinfo = authority.rsplit("@", 1)
    sanitized_userinfo = userinfo.replace("[", "%5B").replace("]", "%5D")
    sanitized_url = f"{prefix}{sanitized_userinfo}@{hostinfo}{rest[authority_end:]}"
    return urlparse(sanitized_url)


def _ora_number_type(precision, scale) -> pa.DataType:
    if scale is not None and scale > 0:
        p = min(int(precision), 38) if precision else 38
        s = int(scale)
        return pa.decimal128(p, s)
    if precision is not None and precision > 0:
        if precision <= 9:
            return pa.int32()
        if precision <= 18:
            return pa.int64()
        return pa.decimal128(min(int(precision), 38), 0)
    return pa.int64()


def _get_ora_type_map() -> dict:
    return {
        oracledb.DB_TYPE_CHAR: pa.string(),
        oracledb.DB_TYPE_NCHAR: pa.string(),
        oracledb.DB_TYPE_VARCHAR: pa.string(),
        oracledb.DB_TYPE_NVARCHAR: pa.string(),
        oracledb.DB_TYPE_LONG: pa.large_string(),
        oracledb.DB_TYPE_DATE: pa.timestamp("us"),
        oracledb.DB_TYPE_TIMESTAMP: pa.timestamp("us"),
        oracledb.DB_TYPE_TIMESTAMP_TZ: pa.timestamp("us", tz="UTC"),
        oracledb.DB_TYPE_TIMESTAMP_LTZ: pa.timestamp("us", tz="UTC"),
        oracledb.DB_TYPE_CLOB: pa.large_string(),
        oracledb.DB_TYPE_NCLOB: pa.large_string(),
        oracledb.DB_TYPE_BLOB: pa.large_binary(),
        oracledb.DB_TYPE_RAW: pa.large_binary(),
        oracledb.DB_TYPE_LONG_RAW: pa.large_binary(),
        oracledb.DB_TYPE_BINARY_FLOAT: pa.float32(),
        oracledb.DB_TYPE_BINARY_DOUBLE: pa.float64(),
        oracledb.DB_TYPE_ROWID: pa.string(),
        oracledb.DB_TYPE_UROWID: pa.string(),
    }


def _build_ora_column(values: list, arrow_type: pa.DataType) -> pa.Array:
    coerced = []
    for v in values:
        if v is None:
            coerced.append(None)
        elif hasattr(v, "read"):
            coerced.append(v.read())
        elif isinstance(v, memoryview):
            coerced.append(bytes(v))
        elif pa.types.is_decimal(arrow_type) and isinstance(v, float):
            coerced.append(PyDecimal(str(v)))
        elif arrow_type in (pa.float64(), pa.float32()) and isinstance(v, int | float):
            coerced.append(float(v))
        else:
            coerced.append(v)
    return pa.array(coerced, type=arrow_type)


def _build_oracle_arrow_table(cursor) -> pa.Table:
    if cursor.description is None:
        return pa.table({})
    type_map = _get_ora_type_map()
    rows = cursor.fetchall()
    n_cols = len(cursor.description)
    col_values: list[list] = [[] for _ in range(n_cols)]
    for row in rows:
        for i, val in enumerate(row):
            col_values[i].append(val)
    arrays = []
    names = []
    for i, desc in enumerate(cursor.description):
        col_name = desc[0]
        db_type = desc[1]
        precision = desc[4]
        scale = desc[5]
        if db_type == oracledb.DB_TYPE_NUMBER:
            arrow_type = _ora_number_type(precision, scale)
        else:
            arrow_type = type_map.get(db_type, pa.string())
        names.append(col_name)
        arrays.append(_build_ora_column(col_values[i], arrow_type))
    return pa.Table.from_arrays(arrays, names=names)


def _make_oracle_connection(connection_info):
    if hasattr(connection_info, "connection_url") and connection_info.connection_url:
        url = connection_info.connection_url.get_secret_value()
        parsed = _parse_oracle_connection_url(url)
        # urlparse leaves percent-encoded characters in the userinfo/path, so
        # decode them here. Credentials routinely contain reserved characters
        # (``@ / : ?``) that MUST be percent-encoded in the URL; without
        # decoding, oracledb receives the literal ``%40`` and auth fails. Use
        # ``unquote`` (not ``unquote_plus``) so a literal ``+`` in a credential
        # is preserved — ``+`` only means space in query strings, not userinfo.
        # Mirrors the mssql/mysql connectors' ``unquote`` handling.
        # (clickhouse uses ``unquote_plus``, which differs on literal ``+``.)
        return oracledb.connect(
            user=unquote(parsed.username) if parsed.username else None,
            password=unquote(parsed.password) if parsed.password else None,
            host=parsed.hostname,
            port=parsed.port or 1521,
            service_name=unquote(parsed.path.lstrip("/")),
        )
    if hasattr(connection_info, "dsn") and connection_info.dsn:
        return oracledb.connect(
            user=connection_info.user,
            password=(
                connection_info.password.get_secret_value()
                if connection_info.password
                else None
            ),
            dsn=connection_info.dsn.get_secret_value(),
        )
    return oracledb.connect(
        user=connection_info.user,
        password=(
            connection_info.password.get_secret_value()
            if connection_info.password
            else None
        ),
        host=connection_info.host,
        port=int(connection_info.port),
        service_name=connection_info.database,
    )


class OracleConnector(ConnectorABC):
    def __init__(self, connection_info):
        self.connection = _make_oracle_connection(connection_info)

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        if limit is not None:
            safe_limit = self._normalize_limit(limit)
            sql = (
                f"SELECT * FROM ({strip_trailing_semicolon(sql)}) t "
                f"WHERE ROWNUM <= {safe_limit}"
            )
        try:
            with self.connection.cursor() as cursor:
                cursor.execute(sql)
                return _build_oracle_arrow_table(cursor)
        except oracledb.DatabaseError as e:
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_EXECUTION,
                metadata={DIALECT_SQL: sql},
            ) from e

    def dry_run(self, sql: str) -> None:
        if hasattr(self.connection, "cursor"):
            try:
                with self.connection.cursor() as cursor:
                    cursor.execute(
                        f"SELECT * FROM ({strip_trailing_semicolon(sql)}) t "
                        f"WHERE ROWNUM <= 0"
                    )
            except oracledb.DatabaseError as e:
                raise WrenError(
                    ErrorCode.INVALID_SQL,
                    str(e),
                    phase=ErrorPhase.SQL_DRY_RUN,
                    metadata={DIALECT_SQL: sql},
                ) from e

    def close(self) -> None:
        if self.connection is not None:
            try:
                self.connection.close()
            except Exception:
                pass
            finally:
                self.connection = None


def create_connector(connection_info) -> OracleConnector:
    return OracleConnector(connection_info)
