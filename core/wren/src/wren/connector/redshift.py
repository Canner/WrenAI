from contextlib import closing

import pandas as pd
import pyarrow as pa
from loguru import logger

from wren.connector.base import ConnectorABC, strip_trailing_semicolon
from wren.model import (
    RedshiftConnectionInfo,
    RedshiftConnectionUnion,
    RedshiftIAMConnectionInfo,
)
from wren.model.error import ErrorCode, WrenError



class RedshiftConnector(ConnectorABC):
    def __init__(self, connection_info: RedshiftConnectionUnion):
        import redshift_connector  # noqa: PLC0415

        if isinstance(connection_info, RedshiftIAMConnectionInfo):
            self.connection = redshift_connector.connect(
                iam=True,
                cluster_identifier=connection_info.cluster_identifier,
                database=connection_info.database,
                db_user=connection_info.user,
                access_key_id=connection_info.access_key_id.get_secret_value(),
                secret_access_key=connection_info.access_key_secret.get_secret_value(),
                region=connection_info.region,
            )
        elif isinstance(connection_info, RedshiftConnectionInfo):
            self.connection = redshift_connector.connect(
                host=connection_info.host,
                port=int(connection_info.port),
                database=connection_info.database,
                user=connection_info.user,
                password=connection_info.password.get_secret_value(),
            )
        else:
            raise WrenError(
                ErrorCode.GENERIC_INTERNAL_ERROR,
                "Invalid Redshift connection_info type",
            )

        self.connection.autocommit = True

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        if limit is not None:
            sql = (
                f"SELECT * FROM ({strip_trailing_semicolon(sql)}) "
                f"AS _q LIMIT {int(limit)}"
            )
        with closing(self.connection.cursor()) as cursor:
            cursor.execute(sql)
            cols = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            df = pd.DataFrame(rows, columns=cols)
            return pa.Table.from_pandas(df)

    def dry_run(self, sql: str) -> None:
        with closing(self.connection.cursor()) as cursor:
            cursor.execute(
                f"SELECT * FROM ({strip_trailing_semicolon(sql)}) AS sub LIMIT 0"
            )

    def close(self) -> None:
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing Redshift connection: {e}")


def create_connector(connection_info) -> RedshiftConnector:
    return RedshiftConnector(connection_info)
