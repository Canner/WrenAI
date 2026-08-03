import re

import pyarrow as pa

from wren.connector.base import ConnectorABC, strip_trailing_semicolon
from wren.model import SparkConnectionInfo

# Statements that are not legal as a subquery on Spark. When a limit is
# supplied for these, fall back to the DataFrame client-side slice so MCP
# `run_sql` (which always passes a default limit) keeps working as on main.
_NON_SUBQUERYABLE = re.compile(
    r"^\s*(SHOW|DESCRIBE|DESC|EXPLAIN|USE|SET|RESET|CACHE|UNCACHE|CLEAR|REFRESH|"
    r"MSCK|ANALYZE|LIST|ADD|REMOVE|GET|PUT|DFS|CREATE|DROP|ALTER|TRUNCATE|INSERT|"
    r"UPDATE|DELETE|MERGE|LOAD|WITH\s+.*\bINSERT\b)\b",
    re.IGNORECASE | re.DOTALL,
)


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
        # Push LIMIT into Spark SQL so the engine does not materialize the full
        # result only for a client-side slice. Strip trailing ``;`` first so the
        # outer form stays valid.
        cleaned = strip_trailing_semicolon(sql)
        coerced = _coerce_limit(limit)
        if coerced is not None and not _NON_SUBQUERYABLE.match(cleaned):
            # Place the user SQL on its own line so a trailing line comment
            # (`-- ...`) cannot swallow the closing paren, alias, or LIMIT.
            # Mirrors snowflake.py.
            executed = f"SELECT * FROM (\n{cleaned}\n) AS _q LIMIT {coerced}"
            df = self.connection.sql(executed).toPandas()
        else:
            # Unlimited path, or non-subqueryable statements (SHOW/DESCRIBE/…).
            # Preserve main behaviour: DataFrame API + optional client slice.
            frame = self.connection.sql(cleaned)
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
        # Validate via the DataFrame API so statements that are not legal as a
        # subquery (SHOW TABLES, DESCRIBE, ...) are still accepted, exactly as
        # before. Only strip a trailing ``;`` so it cannot break Spark SQL.
        cleaned = strip_trailing_semicolon(sql)
        self.connection.sql(cleaned).limit(0).count()

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
