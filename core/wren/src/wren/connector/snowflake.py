"""Native snowflake-connector-python connector — bypasses ibis snowflake backend."""

from __future__ import annotations

import pyarrow as pa
import snowflake.connector

from wren.connector.base import ConnectorABC
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
    return snowflake.connector.connect(**_build_connection_params(connection_info))


class SnowflakeConnector(ConnectorABC):
    def __init__(self, connection_info):
        self.connection = make_snowflake_connection(connection_info)

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        try:
            with self.connection.cursor() as cursor:
                cursor.execute(sql)
                arrow_table = cursor.fetch_arrow_all()
        except snowflake.connector.errors.ProgrammingError as e:
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_EXECUTION,
                metadata={DIALECT_SQL: sql},
            ) from e

        if arrow_table is None:
            return pa.table({})
        if limit is not None:
            return arrow_table.slice(0, limit)
        return arrow_table

    def dry_run(self, sql: str) -> None:
        try:
            with self.connection.cursor() as cursor:
                cursor.describe(sql)
        except snowflake.connector.errors.ProgrammingError as e:
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_DRY_RUN,
                metadata={DIALECT_SQL: sql},
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
