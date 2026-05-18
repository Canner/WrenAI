"""Generic ibis-backed connectors with data-source-specific error handling."""

import pyarrow as pa

from wren.connector.base import IbisConnector
from wren.model.data_source import DataSource
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError

try:
    import clickhouse_connect

    _ClickHouseDbError = clickhouse_connect.driver.exceptions.DatabaseError
except ImportError:

    class _ClickHouseDbError(Exception):
        pass


class ClickHouseConnector(IbisConnector):
    def __init__(self, connection_info):
        super().__init__(DataSource.clickhouse, connection_info)

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        try:
            return super().query(sql, limit)
        except _ClickHouseDbError as e:
            if "TIMEOUT_EXCEEDED" not in str(e):
                raise WrenError(
                    ErrorCode.INVALID_SQL,
                    str(e),
                    phase=ErrorPhase.SQL_EXECUTION,
                    metadata={DIALECT_SQL: sql},
                ) from e
            raise
        except (WrenError, TimeoutError):
            raise

    def dry_run(self, sql: str) -> None:
        try:
            super().dry_run(sql)
        except _ClickHouseDbError as e:
            if "TIMEOUT_EXCEEDED" not in str(e):
                raise WrenError(
                    ErrorCode.INVALID_SQL,
                    str(e),
                    phase=ErrorPhase.SQL_DRY_RUN,
                    metadata={DIALECT_SQL: sql},
                ) from e
            raise
        except (WrenError, TimeoutError):
            raise


_DATA_SOURCE_TO_CLASS = {
    DataSource.clickhouse: ClickHouseConnector,
}


def create_connector(data_source: DataSource, connection_info) -> IbisConnector:
    cls = _DATA_SOURCE_TO_CLASS.get(data_source, IbisConnector)
    if cls is IbisConnector:
        return IbisConnector(data_source, connection_info)
    return cls(connection_info)
