import base64
import re
from json import loads

import pyarrow as pa
from loguru import logger

from wren.connector.base import ConnectorABC

_TRAILING_SEMICOLONS_RE = re.compile(r"[;\s]+\Z")


def _strip_trailing_semicolon(sql: str) -> str:
    """Strip trailing ``;`` / whitespace for BigQuery jobs.

    BigQuery job submission is more lenient than engines that subquery-wrap,
    but a trailing semicolon still breaks when SQL is later composed, and
    multi-statement batches with a terminal ``;`` are not the interface we
    expose for single-statement GenBI queries. Only the terminating run is
    stripped so ``SELECT ';'`` literals remain.
    """
    return _TRAILING_SEMICOLONS_RE.sub("", sql)


def _apply_limit(sql: str, limit: int) -> str:
    """Push LIMIT into SQL via outer subquery wrap.

    ``max_results`` only caps the page size of job results-reading; it does
    not rewrite the query plan. Wrapping as ``SELECT * FROM (sql) LIMIT n``
    (after stripping a trailing semicolon) short-circuits the engine and
    correctly enforces the caller's limit even when *sql* already contains an
    inner ``LIMIT`` (the outer limit always wins / can only reduce rows).
    Avoids comment-sensitive outer-LIMIT detection heuristics.
    """
    cleaned = _strip_trailing_semicolon(sql)
    return f"SELECT * FROM ({cleaned}) AS _sub LIMIT {int(limit)}"


class BigQueryConnector(ConnectorABC):
    def __init__(self, connection_info):
        from google.cloud import bigquery  # noqa: PLC0415
        from google.oauth2 import service_account  # noqa: PLC0415

        self.connection_info = connection_info
        credits_json = loads(
            base64.b64decode(connection_info.credentials.get_secret_value()).decode(
                "utf-8"
            )
        )
        credentials = service_account.Credentials.from_service_account_info(
            credits_json
        )
        credentials = credentials.with_scopes(
            [
                "https://www.googleapis.com/auth/drive",
                "https://www.googleapis.com/auth/cloud-platform",
            ]
        )
        client = bigquery.Client(
            credentials=credentials,
            project=connection_info.get_billing_project_id(),
        )
        job_config = bigquery.QueryJobConfig()
        job_config.job_timeout_ms = connection_info.job_timeout_ms
        client.default_query_job_config = job_config
        self.connection = client

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        if limit is not None:
            sql = _apply_limit(sql, limit)
        else:
            sql = _strip_trailing_semicolon(sql)
        return self.connection.query(sql).result().to_arrow()

    def dry_run(self, sql: str) -> None:
        from google.cloud import bigquery  # noqa: PLC0415

        self.connection.query(
            _strip_trailing_semicolon(sql),
            job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False),
        )

    def close(self) -> None:
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing BigQuery connection: {e}")


def create_connector(connection_info) -> BigQueryConnector:
    return BigQueryConnector(connection_info)
