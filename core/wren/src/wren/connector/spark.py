import pyarrow as pa

from wren.connector.base import ConnectorABC, strip_trailing_semicolon
from wren.model import SparkConnectionInfo


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
        # Push LIMIT into Spark SQL so the engine does not materialize the full
        # result only for a client-side slice. Strip trailing ``;`` first so the
        # outer subscript form stays valid.
        cleaned = strip_trailing_semicolon(sql)
        if limit is not None:
            cleaned = f"SELECT * FROM ({cleaned}) AS _q LIMIT {int(limit)}"
        df = self.connection.sql(cleaned).toPandas()
        if hasattr(df, "attrs") and df.attrs:
            df.attrs = {
                k: v
                for k, v in df.attrs.items()
                if k not in ("metrics", "observed_metrics")
            }
        return pa.Table.from_pandas(df)

    def dry_run(self, sql: str) -> None:
        # Prefer a LIMIT 0 subquery wrapper (like other connectors) so EXPLAIN
        # is unnecessary and a trailing semicolon cannot break Spark SQL.
        cleaned = strip_trailing_semicolon(sql)
        self.connection.sql(f"SELECT * FROM ({cleaned}) AS _q LIMIT 0").count()

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
