from __future__ import annotations

import datetime as dtlib
import json
import urllib.parse
import uuid
from contextlib import closing
from decimal import Decimal as PyDecimal
from typing import Any
from urllib.parse import unquote, urlparse

import pyarrow as pa
import sqlglot.expressions as sge
from loguru import logger
from sqlglot import exp, parse_one

try:
    import pyodbc
except ImportError:  # pragma: no cover
    pyodbc = None

from wren.connector.base import ConnectorABC
from wren.model import MSSqlConnectionInfo
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError

# Custom SQL Server type code for DATETIMEOFFSET — exposed by pyodbc on
# cursor.description so we can register an output converter that decodes the
# raw 20-byte payload into a timezone-aware datetime.
MSSQL_DATETIMEOFFSET_TYPE_CODE = -155


class MSSqlConnector(ConnectorABC):
    """Native pyodbc-backed MSSQL connector.

    Uses a raw pyodbc cursor for execution, builds Arrow schema from
    ``cursor.description`` plus value sampling, and rewrites pagination via
    sqlglot (tsql dialect) so that ``LIMIT n`` becomes
    ``OFFSET 0 ROWS FETCH NEXT n ROWS ONLY``.
    """

    def __init__(self, connection_info):
        self.connection = _build_mssql_connection(connection_info)
        self._closed = False

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        sql = self._flatten_pagination_limit(sql)
        with closing(self.connection.cursor()) as cursor:
            cursor.execute(self._raw_cursor_sql(sql, limit))
            if cursor.description is None:
                return pa.table({})

            rows = cursor.fetchmany(limit) if limit is not None else cursor.fetchall()
            arrow_schema = self._build_mssql_arrow_schema(cursor.description, rows)
            arrays = [
                self._build_mssql_column(
                    [row[index] for row in rows], arrow_schema.field(index).type
                )
                for index in range(len(cursor.description))
            ]
            # ``dict(zip(...))`` collapses duplicate column names — build the
            # table from arrays + schema so projections like ``SELECT a, a``
            # are preserved.
            return pa.Table.from_arrays(arrays, schema=arrow_schema)

    def dry_run(self, sql: str) -> None:
        sql = self._flatten_pagination_limit(sql)
        try:
            with closing(self.connection.cursor()) as cursor:
                cursor.execute(self._raw_cursor_sql(sql, 0))
        except Exception as e:
            error_message = self._describe_sql_for_error_message(sql)
            if error_message != "Unknown reason":
                raise WrenError(
                    error_code=ErrorCode.INVALID_SQL,
                    message=f"The sql dry run failed. {error_message}.",
                    phase=ErrorPhase.SQL_DRY_RUN,
                    metadata={DIALECT_SQL: sql},
                ) from e
            raise

    def close(self) -> None:
        if self._closed or not hasattr(self, "connection") or self.connection is None:
            return
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing MSSQL connection: {e}")
        finally:
            self._closed = True
            self.connection = None

    # ------------------------------------------------------------------
    # SQL rewriting
    # ------------------------------------------------------------------

    @staticmethod
    def _raw_cursor_sql(
        sql: str, limit: int | None, input_dialect: str = "tsql"
    ) -> str:
        """Inject a ``LIMIT n`` into a Select so sqlglot emits the tsql
        ``OFFSET 0 ROWS FETCH NEXT n ROWS ONLY`` clause."""
        if limit is None:
            return sql

        try:
            parsed = parse_one(sql, dialect=input_dialect)
        except Exception:
            return sql

        if isinstance(parsed, exp.Select) and not parsed.args.get("limit"):
            parsed.set("limit", exp.Limit(expression=exp.Literal.number(limit)))
            return parsed.sql(dialect="tsql")

        return sql

    def _flatten_pagination_limit(
        self, sql_query: str, input_dialect: str = "tsql"
    ) -> str:
        """Collapse an outer ``LIMIT`` wrapped around a single subquery into
        the inner Select's ``LIMIT`` — undoes the v4 paginate-wrap pattern."""
        try:
            parsed = parse_one(sql_query, dialect=input_dialect)
            if not isinstance(parsed, exp.Select) or not parsed.args.get("limit"):
                return sql_query

            from_clause = parsed.find(exp.From)
            if not from_clause:
                return sql_query

            subqueries = []
            if isinstance(from_clause.this, exp.Subquery):
                subqueries.append(from_clause.this)
            for join in parsed.args.get("joins") or []:
                if isinstance(join, exp.Join):
                    if isinstance(join.this, exp.Subquery):
                        subqueries.append(join.this)
                    if join.expression and isinstance(join.expression, exp.Subquery):
                        subqueries.append(join.expression)

            if len(subqueries) != 1:
                return sql_query

            inner = subqueries[0].this
            if not isinstance(inner, exp.Select):
                return sql_query

            inner.set("limit", exp.Limit(expression=parsed.args["limit"].expression))
            return inner.sql(dialect="tsql")
        except Exception:
            return sql_query

    def _describe_sql_for_error_message(self, sql: str) -> str:
        """Surface a precise error string by asking SQL Server to describe
        the first result set of the failing query."""
        try:
            tsql = sge.convert(sql).sql("mssql")
            describe_sql = (
                "SELECT error_message FROM "
                f"sys.dm_exec_describe_first_result_set({tsql}, NULL, 0)"
            )
            with closing(self.connection.cursor()) as cur:
                cur.execute(describe_sql)
                rows = cur.fetchall()
                if not rows:
                    return "Unknown reason"
                return rows[0][0]
        except Exception:
            return "Unknown reason"

    # ------------------------------------------------------------------
    # Arrow schema inference + column build
    # ------------------------------------------------------------------

    @staticmethod
    def _build_mssql_arrow_schema(description, rows: list[tuple]) -> pa.Schema:
        fields = []
        for index, column in enumerate(description):
            values = [row[index] for row in rows]
            fields.append(
                pa.field(
                    column[0],
                    MSSqlConnector._mssql_arrow_type(column, values),
                    nullable=True,
                )
            )
        return pa.schema(fields)

    @staticmethod
    def _mssql_arrow_type(column, values: list) -> pa.DataType:
        type_code = column[1] if len(column) > 1 else None
        internal_size = column[3] if len(column) > 3 else None
        precision = column[4] if len(column) > 4 else None
        sample = next((value for value in values if value is not None), None)

        if isinstance(sample, bool) or type_code is bool:
            return pa.bool_()
        if isinstance(sample, bytes | bytearray | memoryview) or type_code in {
            bytes,
            bytearray,
            memoryview,
        }:
            return pa.binary()
        if isinstance(sample, dtlib.datetime) or type_code is dtlib.datetime:
            tz = MSSqlConnector._mssql_timezone_name(sample)
            return pa.timestamp("ns", tz=tz)
        if isinstance(sample, dtlib.date) or type_code is dtlib.date:
            return pa.date32()
        if isinstance(sample, dtlib.time) or type_code is dtlib.time:
            return pa.time64("ns")
        if isinstance(sample, float) or type_code is float:
            return pa.float32() if internal_size == 4 else pa.float64()
        if isinstance(sample, int) or type_code is int:
            return MSSqlConnector._mssql_integer_arrow_type(
                internal_size, precision, values
            )
        if isinstance(sample, PyDecimal) or type_code is PyDecimal:
            return pa.string()
        if isinstance(sample, uuid.UUID) or type_code is uuid.UUID:
            return pa.string()

        return pa.string()

    @staticmethod
    def _mssql_timezone_name(value: dtlib.datetime | None) -> str | None:
        if value is None or value.tzinfo is None:
            return None
        offset = value.utcoffset()
        if offset is None:
            return None
        if offset.total_seconds() == 0:
            return "UTC"
        total_minutes = int(offset.total_seconds() // 60)
        sign = "+" if total_minutes >= 0 else "-"
        hours, minutes = divmod(abs(total_minutes), 60)
        return f"{sign}{hours:02d}:{minutes:02d}"

    @staticmethod
    def _mssql_integer_arrow_type(
        internal_size: int | None, precision: int | None, values: list
    ) -> pa.DataType:
        non_negative = all(value is None or int(value) >= 0 for value in values)

        # SQL Server TINYINT is unconditionally unsigned (0..255), so map by
        # the declared internal_size rather than sampling for sign.
        if internal_size == 1:
            return pa.uint8()
        if internal_size == 2:
            return pa.int16()
        if internal_size == 4:
            return pa.int32()
        if internal_size == 8:
            return pa.int64()

        if precision is not None:
            if precision <= 3 and non_negative:
                return pa.uint8()
            if precision <= 5:
                return pa.int16()
            if precision <= 10:
                return pa.int32()
        return pa.int64()

    @staticmethod
    def _build_mssql_column(values: list, arrow_type: pa.DataType) -> pa.Array:
        if pa.types.is_integer(arrow_type):
            processed = [None if value is None else int(value) for value in values]
            return pa.array(processed, type=arrow_type, from_pandas=True)

        if pa.types.is_floating(arrow_type):
            processed = [None if value is None else float(value) for value in values]
            return pa.array(processed, type=arrow_type, from_pandas=True)

        if pa.types.is_boolean(arrow_type):
            processed = [None if value is None else bool(value) for value in values]
            return pa.array(processed, type=arrow_type, from_pandas=True)

        if pa.types.is_decimal(arrow_type):
            processed = [
                None
                if value is None
                else value
                if isinstance(value, PyDecimal)
                else PyDecimal(str(value))
                for value in values
            ]
            return pa.array(processed, type=arrow_type, from_pandas=True)

        if pa.types.is_string(arrow_type):
            processed = []
            for value in values:
                if value is None:
                    processed.append(None)
                elif isinstance(value, dict | list):
                    processed.append(json.dumps(value, default=str))
                elif isinstance(value, str):
                    processed.append(value)
                else:
                    processed.append(str(value))
            return pa.array(processed, type=arrow_type, from_pandas=True)

        return pa.array(values, type=arrow_type, from_pandas=True)


def create_connector(connection_info) -> MSSqlConnector:
    return MSSqlConnector(connection_info)


# ---------------------------------------------------------------------------
# Connection construction
# ---------------------------------------------------------------------------


def _build_mssql_connection(connection_info):
    """Open a pyodbc connection from either a ``ConnectionUrl`` or a typed
    :class:`MSSqlConnectionInfo`.

    Centralises the URL vs. typed branching so :class:`MSSqlConnector` only
    has to call this helper from its ``__init__``.
    """
    if hasattr(connection_info, "connection_url") and connection_info.connection_url:
        return _connect_mssql_from_url(
            connection_info.connection_url.get_secret_value(),
            dict(connection_info.kwargs) if connection_info.kwargs else None,
        )
    info: MSSqlConnectionInfo = connection_info
    return _connect_mssql_pyodbc(
        host=info.host,
        port=info.port,
        database=info.database,
        user=info.user,
        password=info.password.get_secret_value() if info.password else None,
        driver=info.driver,
        kwargs={
            "TDS_Version": info.tds_version,
            **(info.kwargs if info.kwargs else {}),
        },
    )


def _connect_mssql_from_url(
    connection_url: str, base_kwargs: dict[str, Any] | None = None
):
    """Parse a ``mssql://user:pass@host:port/database`` URL and open a
    pyodbc connection using the same code path as the typed-info builder."""
    parsed = urlparse(connection_url)
    if parsed.scheme != "mssql":
        raise WrenError(
            ErrorCode.INVALID_CONNECTION_INFO,
            "Invalid connection URL for MSSQL",
        )

    if not parsed.hostname or not parsed.path:
        raise WrenError(
            ErrorCode.INVALID_CONNECTION_INFO,
            "MSSQL connection URL must include host and database",
        )

    kwargs = dict(base_kwargs) if base_kwargs else {}
    # parse_qsl already URL-decodes values, but we re-apply unquote below only
    # to components urlparse leaves encoded (user, path, password). We use
    # ``unquote`` (not ``unquote_plus``) so a literal ``+`` in a credential —
    # e.g. ``svc+etl`` — is preserved instead of being turned into a space:
    # ``+`` only has form-encoded semantics in query strings, not in userinfo
    # or the path.
    for key, value in urllib.parse.parse_qsl(parsed.query):
        kwargs[key] = value
    driver = kwargs.pop("driver", "ODBC Driver 18 for SQL Server")

    # No username → integrated auth (Trusted_Connection=yes). The shared
    # _connect_mssql_pyodbc validator owns the user/password symmetry check.
    return _connect_mssql_pyodbc(
        host=parsed.hostname,
        port=str(parsed.port or 1433),
        database=unquote(parsed.path.lstrip("/")),
        user=unquote(parsed.username) if parsed.username else None,
        password=unquote(parsed.password) if parsed.password else None,
        driver=driver,
        kwargs=kwargs,
    )


def _connect_mssql_pyodbc(
    host: str,
    port: str,
    database: str,
    user: str | None,
    password: str | None,
    driver: str,
    kwargs: dict[str, Any] | None = None,
):
    if pyodbc is None:  # pragma: no cover
        raise WrenError(ErrorCode.GET_CONNECTION_ERROR, "pyodbc is required for MSSQL")

    connect_kwargs = dict(kwargs) if kwargs else {}
    statement_timeout = connect_kwargs.pop("statement_timeout", None)
    # Validate statement_timeout before opening the connection so a bad
    # value can't leak the pyodbc connection we'd otherwise open first.
    if statement_timeout is not None:
        try:
            statement_timeout = int(statement_timeout)
        except (TypeError, ValueError) as exc:
            raise WrenError(
                ErrorCode.INVALID_CONNECTION_INFO,
                f"Invalid statement_timeout for MSSQL: {statement_timeout!r}",
            ) from exc

    connection_parts = [
        f"DRIVER={_escape_odbc_value(driver)}",
        f"SERVER={host},{port}",
        f"DATABASE={_escape_odbc_value(database)}",
    ]
    if user is None and password is None:
        connection_parts.append("Trusted_Connection=yes")
    elif user is None or password is None:
        raise WrenError(
            ErrorCode.INVALID_CONNECTION_INFO,
            "MSSQL connection requires both user and password, "
            "or neither (for Trusted_Connection)",
        )
    else:
        connection_parts.append(f"UID={_escape_odbc_value(user)}")
        connection_parts.append(f"PWD={_escape_odbc_value(password)}")

    for key, value in connect_kwargs.items():
        connection_parts.append(f"{key}={_escape_odbc_value(str(value))}")

    connection = pyodbc.connect(";".join(connection_parts))
    _register_mssql_output_converters(connection)

    if statement_timeout is not None:
        connection.timeout = statement_timeout

    return connection


def _escape_odbc_value(value: str) -> str:
    return "{" + value.replace("}", "}}") + "}"


def _register_mssql_output_converters(connection) -> None:
    connection.add_output_converter(
        MSSQL_DATETIMEOFFSET_TYPE_CODE,
        _decode_mssql_datetimeoffset,
    )


def _decode_mssql_datetimeoffset(value: bytes | None) -> dtlib.datetime | None:
    if value is None:
        return None
    if len(value) != 20:
        raise ValueError(
            "unexpected mssql datetimeoffset payload length: "
            f"expected 20, got {len(value)}"
        )

    year = int.from_bytes(value[0:2], "little")
    month = int.from_bytes(value[2:4], "little")
    day = int.from_bytes(value[4:6], "little")
    hour = int.from_bytes(value[6:8], "little")
    minute = int.from_bytes(value[8:10], "little")
    second = int.from_bytes(value[10:12], "little")
    nanoseconds = int.from_bytes(value[12:16], "little")
    offset_hours = int.from_bytes(value[16:18], "little", signed=True)
    offset_minutes = int.from_bytes(value[18:20], "little", signed=True)

    tzinfo = dtlib.timezone(dtlib.timedelta(hours=offset_hours, minutes=offset_minutes))
    return dtlib.datetime(
        year=year,
        month=month,
        day=day,
        hour=hour,
        minute=minute,
        second=second,
        microsecond=nanoseconds // 1000,
        tzinfo=tzinfo,
    )
