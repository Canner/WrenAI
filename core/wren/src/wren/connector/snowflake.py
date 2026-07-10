"""Native snowflake-connector-python connector — bypasses ibis snowflake backend."""

from __future__ import annotations

import re

import pyarrow as pa

from wren.connector.base import ConnectorABC
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError

_TRAILING_SEMICOLONS_RE = re.compile(r"[;\s]+\Z")


def _strip_trailing_semicolon(sql: str) -> str:
    """Strip terminating ``;`` / whitespace for Snowflake execute/describe.

    Snowflake accepts ``SELECT 1;`` as a single statement in some clients, but
    other engines we subprocess-mirror reject trailing terminal semicolons, and
    describe() paths are safer with a cleaned statement. Only the terminal run
    is removed so ``SELECT ';'`` stays intact.
    """
    return _TRAILING_SEMICOLONS_RE.sub("", sql)


def _has_outer_limit(sql: str) -> bool:
    """True when *sql* already ends with a top-level LIMIT or FETCH.

    Only the outer tail is inspected so a subquery ``LIMIT`` inside parentheses
    or a string literal does not suppress pushdown. Rough but safe: after
    stripping a trailing semicolon, look for LIMIT/FETCH as the last clause.
    """
    cleaned = _strip_trailing_semicolon(sql).rstrip()
    # Drop a trailing closers? Keep simple — music box MySQL still appends; we
    # only skip when the outermost statement clearly already limits rows.
    tail = cleaned.split("\n")[-1].strip()
    return bool(re.match(r"(?i)^(LIMIT|FETCH)\b", tail)) or bool(
        re.search(r"(?i)\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*\Z", cleaned)
        or re.search(r"(?i)\bFETCH\s+(FIRST|NEXT)\b.*\bROWS?\b\s*\Z", cleaned)
    )


def _apply_limit(sql: str, limit: int) -> str:
    """Push LIMIT into the Snowflake SQL text.

    Client-side Arrow slicing still downloads a full result stage. Append
    ``LIMIT n`` after stripping a trailing semicolon so the warehouse can
    short-circuit, matching Athena/MySQL append style.

    If the outer statement already has a LIMIT/FETCH, leave it unchanged to
    avoid ``... LIMIT 10\\nLIMIT 5`` (CodeRabbit #2466).
    """
    cleaned = _strip_trailing_semicolon(sql)
    if _has_outer_limit(cleaned):
        return cleaned
    return f"{cleaned}\nLIMIT {int(limit)}"


def _build_connection_params(connection_info) -> dict:
    params: dict = {
        "user": connection_info.user,
        "account": connection_info.account,
        "database": connection_info.database,
        "schema": connection_info.sf_schema,
    }
    if (
        hasattr(connection_info, "private_key")
        and connection_info.private_key is not None
    ):
        params["private_key"] = connection_info.private_key.get_secret_value()
    elif connection_info.password is not None:
        params["password"] = connection_info.password.get_secret_value()

    if hasattr(connection_info, "warehouse") and connection_info.warehouse:
        params["warehouse"] = connection_info.warehouse

    if connection_info.kwargs:
        extra_kwargs = dict(connection_info.kwargs)
        statement_timeout = extra_kwargs.pop("statement_timeout", None)
        params.update(extra_kwargs)
        if statement_timeout is not None:
            session_parameters = params.setdefault("session_parameters", {})
            session_parameters.setdefault(
                "STATEMENT_TIMEOUT_IN_SECONDS", int(statement_timeout)
            )
    return params


def make_snowflake_connection(connection_info):
    import snowflake.connector  # noqa: PLC0415

    return snowflake.connector.connect(**_build_connection_params(connection_info))


class SnowflakeConnector(ConnectorABC):
    def __init__(self, connection_info):
        self.connection = make_snowflake_connection(connection_info)

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        exec_sql = _apply_limit(sql, limit) if limit is not None else sql
        try:
            with self.connection.cursor() as cursor:
                cursor.execute(exec_sql)
                arrow_table = cursor.fetch_arrow_all()
        except Exception as e:
            # Map Snowflake ProgrammingError when the driver is installed; any
            # other exception is re-raised so infrastructure failures stay loud.
            try:
                import snowflake.connector  # noqa: PLC0415

                if not isinstance(e, snowflake.connector.errors.ProgrammingError):
                    raise
            except ImportError:
                raise
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_EXECUTION,
                metadata={DIALECT_SQL: exec_sql},
            ) from e

        if arrow_table is None:
            return pa.table({})
        return arrow_table

    def dry_run(self, sql: str) -> None:
        cleaned = _strip_trailing_semicolon(sql)
        try:
            with self.connection.cursor() as cursor:
                cursor.describe(cleaned)
        except Exception as e:
            try:
                import snowflake.connector  # noqa: PLC0415

                if not isinstance(e, snowflake.connector.errors.ProgrammingError):
                    raise
            except ImportError:
                raise
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_DRY_RUN,
                metadata={DIALECT_SQL: cleaned},
            ) from e

    def close(self) -> None:
        if self.connection is None:
            return
        try:
            self.connection.close()
        except Exception:
            pass
        finally:
            self.connection = None


def create_connector(connection_info) -> SnowflakeConnector:
    return SnowflakeConnector(connection_info)
