from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

import pyarrow as pa
from loguru import logger

from wren.model.data_source import DataSource

if TYPE_CHECKING:
    from ibis.expr.types import Table


class ConnectorABC(ABC):
    @abstractmethod
    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        pass

    @abstractmethod
    def dry_run(self, sql: str) -> None:
        pass

    @abstractmethod
    def close(self) -> None:
        pass


class IbisConnector(ConnectorABC):
    def __init__(self, data_source: DataSource, connection_info):
        self.data_source = data_source
        self.connection = self.data_source.get_connection(connection_info)
        self._closed = False

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        ibis_table = self.connection.sql(sql)
        if limit is not None:
            ibis_table = ibis_table.limit(limit)
        ibis_table = self._handle_pyarrow_unsupported_type(ibis_table)
        return ibis_table.to_pyarrow()

    def _handle_pyarrow_unsupported_type(self, ibis_table: Table, **kwargs) -> Table:
        from ibis.expr.datatypes import Decimal  # noqa: PLC0415
        from ibis.expr.datatypes.core import UUID  # noqa: PLC0415

        result_table = ibis_table
        for name, dtype in ibis_table.schema().items():
            if isinstance(dtype, Decimal):
                result_table = self._round_decimal_columns(
                    result_table=result_table, col_name=name, **kwargs
                )
            elif isinstance(dtype, UUID):
                result_table = self._cast_uuid_columns(
                    result_table=result_table, col_name=name
                )
        return result_table

    def _cast_uuid_columns(self, result_table: Table, col_name: str) -> Table:
        return result_table.mutate(**{col_name: result_table[col_name].cast("string")})

    def _round_decimal_columns(
        self, result_table: Table, col_name: str, scale: int = 9
    ) -> Table:
        from ibis.expr.datatypes import Decimal  # noqa: PLC0415

        col = result_table[col_name]
        decimal_type = Decimal(precision=38, scale=scale)
        rounded_col = col.cast(decimal_type).round(scale)
        return result_table.mutate(**{col_name: rounded_col})

    def dry_run(self, sql: str) -> None:
        self.connection.sql(sql)

    def close(self) -> None:
        if self._closed or not hasattr(self, "connection") or self.connection is None:
            return
        try:
            if hasattr(self.connection, "con"):
                if hasattr(self.connection.con, "close"):
                    self.connection.con.close()
            elif hasattr(self.connection, "close"):
                self.connection.close()
            elif hasattr(self.connection, "disconnect"):
                self.connection.disconnect()
            else:
                logger.warning(
                    f"Closing connection for {self.data_source.value} is not implemented."
                )
        except Exception as e:
            logger.warning(
                f"Error closing connection for {self.data_source.value}: {e}"
            )
        finally:
            self._closed = True
            self.connection = None
