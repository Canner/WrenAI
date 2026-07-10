import re

import pyarrow as pa

from wren.connector.base import ConnectorABC
from wren.model import SparkConnectionInfo

_TRAILING_SEMICOLONS_RE = re.compile(r"[;\s]+\Z")


def _strip_trailing_semicolon(sql: str) -> str:
    """Strip trailing ``;`` / whitespace so Spark Connect does not treat input as multi-statement.

    ``SparkSession.sql`` / connect clients commonly reject or mishandle a trailing
    semicolon when composing limits or dry-runs. Only the terminating run is
    removed so ``SELECT ';'`` literals stay intact — same pattern as postgres /
    redshift / duckdb connectors.
    """
    return _TRAILING_SEMICOLONS_RE.sub("", sql)


class SparkConnector(ConnectorABC):
    def __init__(self, connection_info: SparkConnectionInfo):
        self.connection_info = connection_info
        self.connection = self._create_session()
        self._closed = False

    def _create_session(self):
        from pyspark.sql import SparkSession  # noqa: PLC0415

        host = self.connection_info.host
        port = self.connection_info.port
        return (
            SparkSession.builder.remote(f"sc://{host}:{port}")
            .appName("wren")
            .getOrCreate()
        )

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        df = self.connection.sql(_strip_trailing_semicolon(sql)).toPandas()
        if hasattr(df, "attrs") and df.attrs:
            df.attrs = {
                k: v
                for k, v in df.attrs.items()
                if k not in ("metrics", "observed_metrics")
            }
        arrow_table = pa.Table.from_pandas(df)
        if limit is not None:
            arrow_table = arrow_table.slice(0, limit)
        return arrow_table

    def dry_run(self, sql: str) -> None:
        self.connection.sql(_strip_trailing_semicolon(sql)).limit(0).count()

    def close(self) -> None:
        if self._closed:
            return
        try:
            self.connection.stop()
        except Exception:
            pass
        finally:
            self._closed = True


def create_connector(connection_info) -> SparkConnector:
    return SparkConnector(connection_info)
