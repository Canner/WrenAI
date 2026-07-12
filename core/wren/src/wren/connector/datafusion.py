from __future__ import annotations

import io
import re
from pathlib import Path

import pyarrow as pa
import pyarrow.ipc as ipc
from loguru import logger

from wren.connector.base import ConnectorABC
from wren.model import DataFusionConnectionInfo
from wren.model.error import ErrorCode, WrenError

_TRAILING_SEMICOLONS_RE = re.compile(r"[;\s]+\Z")


def _strip_trailing_semicolon(sql: str) -> str:
    """Strip the terminating run of ``;`` characters and surrounding whitespace.

    Wrapping user SQL as ``SELECT * FROM ({sql}) AS _q LIMIT N`` breaks when
    ``sql`` ends in a semicolon — DataFusion rejects ``SELECT 1;`` inside a
    subquery (``sql parser error: Expected: an expression, found: ;``). Only
    the *terminating* run of semicolons/whitespace is stripped, so semicolons
    inside string literals (e.g. ``SELECT 'a;b' FROM t``) are preserved.
    Mirrors the postgres/redshift/duckdb connectors, which already strip
    before subquery-wrapping.
    """
    return _TRAILING_SEMICOLONS_RE.sub("", sql)


class DataFusionConnector(ConnectorABC):
    """DataFusion-native connector for local file analysis.

    Uses wren-core-py's LocalRuntime mode to execute SQL directly
    via DataFusion, without unparsing to SQL or routing through
    ibis-server.
    """

    def __init__(self, connection_info: DataFusionConnectionInfo):
        from wren_core import SessionContext  # noqa: PLC0415

        self.ctx = SessionContext()
        self.source = Path(connection_info.source).resolve()
        self.format = connection_info.format
        self._register_tables()

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        if limit is not None:
            sql = (
                f"SELECT * FROM ({_strip_trailing_semicolon(sql)}) "
                f"AS _q LIMIT {int(limit)}"
            )
        else:
            sql = _strip_trailing_semicolon(sql)
        ipc_bytes = self.ctx.query(sql)
        reader = ipc.open_stream(io.BytesIO(bytes(ipc_bytes)))
        return reader.read_all()

    def dry_run(self, sql: str) -> None:
        self.ctx.dry_run(_strip_trailing_semicolon(sql))

    def close(self) -> None:
        pass

    _SUPPORTED_FORMATS = {"parquet", "csv"}

    def _register_tables(self) -> None:
        """Auto-discover and register files from source directory."""
        if self.format not in self._SUPPORTED_FORMATS:
            raise WrenError(
                ErrorCode.GENERIC_USER_ERROR,
                f"Unsupported format '{self.format}'. "
                f"Supported: {', '.join(sorted(self._SUPPORTED_FORMATS))}",
            )
        if not self.source.is_dir():
            raise WrenError(
                ErrorCode.GENERIC_USER_ERROR,
                f"Source directory not found: {self.source}",
            )

        glob_pattern = f"*.{self.format}"
        registered = []
        for file_path in sorted(self.source.glob(glob_pattern)):
            table_name = file_path.stem
            try:
                if self.format == "parquet":
                    self.ctx.register_parquet(table_name, str(file_path))
                else:
                    self.ctx.register_csv(table_name, str(file_path))
                registered.append(table_name)
            except Exception as e:
                raise WrenError(
                    ErrorCode.GENERIC_USER_ERROR,
                    f"Failed to register {file_path.name}: {e!s}",
                ) from e

        if not registered:
            raise WrenError(
                ErrorCode.GENERIC_USER_ERROR,
                f"No .{self.format} files found in {self.source}",
            )

        logger.info(
            f"Registered {len(registered)} tables from {self.source}: {registered}"
        )


def create_connector(connection_info) -> DataFusionConnector:
    return DataFusionConnector(connection_info)
