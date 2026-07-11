from contextlib import closing

import pyarrow as pa
from loguru import logger

from wren.connector.base import ConnectorABC, strip_trailing_semicolon
from wren.model import (
    DatabricksConnectionUnion,
    DatabricksServicePrincipalConnectionInfo,
    DatabricksTokenConnectionInfo,
)


def _connection_kwargs(connection_info: DatabricksConnectionUnion) -> dict[str, str]:
    kwargs = {
        "server_hostname": connection_info.server_hostname,
        "http_path": connection_info.http_path,
    }
    if connection_info.catalog:
        kwargs["catalog"] = connection_info.catalog
    return kwargs


class DatabricksConnector(ConnectorABC):
    def __init__(self, connection_info: DatabricksConnectionUnion):
        from databricks import sql as dbsql  # noqa: PLC0415
        from databricks.sdk.core import Config as DbConfig  # noqa: PLC0415
        from databricks.sdk.core import oauth_service_principal  # noqa: PLC0415

        if isinstance(connection_info, DatabricksTokenConnectionInfo):
            self.connection = dbsql.connect(
                **_connection_kwargs(connection_info),
                access_token=connection_info.access_token.get_secret_value(),
            )
        elif isinstance(connection_info, DatabricksServicePrincipalConnectionInfo):
            kwargs = {
                "host": connection_info.server_hostname,
                "client_id": connection_info.client_id.get_secret_value(),
                "client_secret": connection_info.client_secret.get_secret_value(),
            }
            if connection_info.azure_tenant_id is not None:
                kwargs["azure_tenant_id"] = connection_info.azure_tenant_id

            def credential_provider():
                return oauth_service_principal(DbConfig(**kwargs))

            self.connection = dbsql.connect(
                **_connection_kwargs(connection_info),
                credentials_provider=credential_provider,
            )

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        # Strip terminating ;/whitespace before execute (matches dry_run).
        sql = _strip_trailing_semicolon(sql)
        with closing(self.connection.cursor()) as cursor:
            cursor.execute(sql)
            if limit is not None:
                return cursor.fetchmany_arrow(limit)
            return cursor.fetchall_arrow()

    def dry_run(self, sql: str) -> None:
        with closing(self.connection.cursor()) as cursor:
            cursor.execute(
                f"SELECT * FROM ({strip_trailing_semicolon(sql)}) AS sub LIMIT 0"
            )

    def close(self) -> None:
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing Databricks connection: {e}")


def create_connector(connection_info) -> DatabricksConnector:
    return DatabricksConnector(connection_info)
