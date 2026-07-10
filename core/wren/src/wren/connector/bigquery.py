import base64
from json import loads

import pyarrow as pa
from loguru import logger

from wren.connector.base import ConnectorABC


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
        return self.connection.query(sql).result(max_results=limit).to_arrow()

    def dry_run(self, sql: str) -> None:
        from google.cloud import bigquery  # noqa: PLC0415

        self.connection.query(
            sql, job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
        )

    def close(self) -> None:
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing BigQuery connection: {e}")


def create_connector(connection_info) -> BigQueryConnector:
    return BigQueryConnector(connection_info)
