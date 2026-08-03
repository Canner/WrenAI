import pyarrow as pa

from wren.connector.base import ConnectorABC, strip_trailing_semicolon
from wren.model import SparkConnectionInfo


def _coerce_limit(limit: int | None) -> int | None:
    """Validate and coerce a user-supplied ``limit`` to a non-negative ``int``."""
    if limit is None:
        return None
    coerced = int(limit)
    if coerced < 0:
        raise ValueError(f"limit must be non-negative, got {coerced}")
    return coerced


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
        # Apply limit via DataFrame.limit before toPandas so Spark pushes a
        # CollectLimit into the plan (server-side). Avoid post-Arrow slice and
        # SQL subquery wraps — both unnecessary on the DataFrame API and the
        # latter breaks SHOW/DESCRIBE-style statements.
        coerced = _coerce_limit(limit)
        frame = self.connection.sql(strip_trailing_semicolon(sql))
        if coerced is not None:
            frame = frame.limit(coerced)
        df = frame.toPandas()
        if hasattr(df, "attrs") and df.attrs:
            df.attrs = {
                k: v
                for k, v in df.attrs.items()
                if k not in ("metrics", "observed_metrics")
            }
        return pa.Table.from_pandas(df)

    def dry_run(self, sql: str) -> None:
        self.connection.sql(strip_trailing_semicolon(sql)).limit(0).count()

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
