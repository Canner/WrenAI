"""Generic ibis-backed connectors with data-source-specific error handling."""

import pyarrow as pa

from wren.connector.base import IbisConnector
from wren.model.data_source import DataSource
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError


class TrinoConnector(IbisConnector):
    def __init__(self, connection_info):
        super().__init__(DataSource.trino, connection_info)

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        import trino  # noqa: PLC0415

        try:
            return super().query(sql, limit)
        except trino.exceptions.TrinoQueryError as e:
            if not e.error_name == "EXCEEDED_TIME_LIMIT":
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
        import trino  # noqa: PLC0415

        try:
            super().dry_run(sql)
        except trino.exceptions.TrinoQueryError as e:
            if not e.error_name == "EXCEEDED_TIME_LIMIT":
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
    DataSource.trino: TrinoConnector,
}


def create_connector(data_source: DataSource, connection_info) -> IbisConnector:
    cls = _DATA_SOURCE_TO_CLASS.get(data_source, IbisConnector)
    if cls is IbisConnector:
        return IbisConnector(data_source, connection_info)
    return cls(connection_info)
