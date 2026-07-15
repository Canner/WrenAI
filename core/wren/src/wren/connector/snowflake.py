"""Native snowflake-connector-python connector — bypasses ibis snowflake backend."""

from __future__ import annotations

import pyarrow as pa

from wren.connector.base import ConnectorABC, strip_trailing_semicolon
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError


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


def _programming_error():
    import snowflake.connector  # noqa: PLC0415

    return snowflake.connector.errors.ProgrammingError


class SnowflakeConnector(ConnectorABC):
    def __init__(self, connection_info):
        self.connection = make_snowflake_connection(connection_info)

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        # Push LIMIT into Snowflake when requested so we do not download a
        # full result set only to slice it in Python. Wrap as a subquery so a
        # trailing semicolon in the user SQL cannot break composition, and so
        # statements that already contain an ORDER BY keep their ordering
        # under the outer LIMIT.
        executed = sql
        if limit is not None:
            # Place the user SQL on its own line so a trailing line comment
            # (`-- ...`) cannot swallow the closing paren, alias, or LIMIT.
            executed = (
                "SELECT * FROM (\n"
                f"{strip_trailing_semicolon(sql)}\n"
                f") AS _wren_sub LIMIT {int(limit)}"
            )
        try:
            with self.connection.cursor() as cursor:
                cursor.execute(executed)
                arrow_table = cursor.fetch_arrow_all()
        except _programming_error() as e:
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_EXECUTION,
                metadata={DIALECT_SQL: executed},
            ) from e

        if arrow_table is None:
            return pa.table({})
        return arrow_table

    def dry_run(self, sql: str) -> None:
        # cursor.describe is sensitive to a trailing terminator on many
        # client-generated statements; strip only the total-line tail.
        cleaned = strip_trailing_semicolon(sql)
        try:
            with self.connection.cursor() as cursor:
                cursor.describe(cleaned)
        except _programming_error() as e:
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
