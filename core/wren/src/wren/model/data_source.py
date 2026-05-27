from __future__ import annotations

import urllib
from enum import StrEnum, auto
from typing import Any
from urllib.parse import unquote_plus

from wren.model import (
    AthenaConnectionInfo,
    BaseConnectionInfo,
    BigQueryDatasetConnectionInfo,
    BigQueryProjectConnectionInfo,
    CannerConnectionInfo,
    ClickHouseConnectionInfo,
    ConnectionInfo,
    ConnectionUrl,
    DatabricksServicePrincipalConnectionInfo,
    DatabricksTokenConnectionInfo,
    DataFusionConnectionInfo,
    DorisConnectionInfo,
    GcsFileConnectionInfo,
    LocalFileConnectionInfo,
    MinioFileConnectionInfo,
    MSSqlConnectionInfo,
    MySqlConnectionInfo,
    OracleConnectionInfo,
    PostgresConnectionInfo,
    RedshiftConnectionInfo,
    RedshiftIAMConnectionInfo,
    S3FileConnectionInfo,
    SnowflakeConnectionInfo,
    SparkConnectionInfo,
    TrinoConnectionInfo,
)
from wren.model.error import ErrorCode, WrenError

X_WREN_DB_STATEMENT_TIMEOUT = "x-wren-db-statement_timeout"


class DataSource(StrEnum):
    athena = auto()
    bigquery = auto()
    canner = auto()
    clickhouse = auto()
    datafusion = auto()
    mssql = auto()
    mysql = auto()
    doris = auto()
    oracle = auto()
    postgres = auto()
    redshift = auto()
    snowflake = auto()
    trino = auto()
    local_file = auto()
    s3_file = auto()
    minio_file = auto()
    gcs_file = auto()
    duckdb = auto()
    spark = auto()
    databricks = auto()

    def get_connection_info(
        self,
        data: dict[str, Any] | ConnectionInfo,
        headers: dict[str, str] | None = None,
    ) -> ConnectionInfo:
        headers = headers or {}
        if isinstance(data, BaseConnectionInfo):
            info = data
        else:
            info = self._build_connection_info(data)
        match self:
            case DataSource.postgres:
                kwargs = info.kwargs if info.kwargs else {}
                if "connect_timeout" not in kwargs:
                    kwargs["connect_timeout"] = 120
                options = kwargs.get("options", "")
                if "statement_timeout" not in options:
                    if options:
                        options += " "
                    options += f"-c statement_timeout={headers.get(X_WREN_DB_STATEMENT_TIMEOUT, 180)}s"
                    kwargs["options"] = options
                info.kwargs = kwargs
            case DataSource.clickhouse:
                session_timeout = headers.get(X_WREN_DB_STATEMENT_TIMEOUT, 180)
                if info.settings is None:
                    info.settings = {}
                if "max_execution_time" not in info.settings:
                    info.settings["max_execution_time"] = int(session_timeout)
            case DataSource.trino:
                session_timeout = headers.get(X_WREN_DB_STATEMENT_TIMEOUT, 180)
                if info.kwargs is None:
                    info.kwargs = {}
                session_properties = info.kwargs.get("session_properties", {})
                if "query_max_execution_time" not in session_properties:
                    session_properties["query_max_execution_time"] = (
                        f"{session_timeout}s"
                    )
                info.kwargs["session_properties"] = session_properties
            case DataSource.bigquery:
                session_timeout = headers.get(X_WREN_DB_STATEMENT_TIMEOUT, 180)
                if not hasattr(info, "job_timeout_ms") or info.job_timeout_ms is None:
                    info.job_timeout_ms = int(session_timeout) * 1000
        return info

    def _build_connection_info(self, data: dict) -> ConnectionInfo:
        if "connectionUrl" in data or "connection_url" in data:
            if self == DataSource.clickhouse:
                return self._handle_clickhouse_url(
                    urllib.parse.urlparse(
                        data.get("connectionUrl", data.get("connection_url"))
                    )
                )
            return ConnectionUrl.model_validate(data)

        match self:
            case DataSource.athena:
                return AthenaConnectionInfo.model_validate(data)
            case DataSource.bigquery:
                if "bigquery_type" in data and data["bigquery_type"] == "project":
                    return BigQueryProjectConnectionInfo.model_validate(data)
                return BigQueryDatasetConnectionInfo.model_validate(data)
            case DataSource.canner:
                return CannerConnectionInfo.model_validate(data)
            case DataSource.clickhouse:
                return ClickHouseConnectionInfo.model_validate(data)
            case DataSource.mssql:
                return MSSqlConnectionInfo.model_validate(data)
            case DataSource.mysql:
                return MySqlConnectionInfo.model_validate(data)
            case DataSource.doris:
                return DorisConnectionInfo.model_validate(data)
            case DataSource.oracle:
                return OracleConnectionInfo.model_validate(data)
            case DataSource.postgres:
                return PostgresConnectionInfo.model_validate(data)
            case DataSource.redshift:
                if "redshift_type" in data and data["redshift_type"] == "redshift_iam":
                    return RedshiftIAMConnectionInfo.model_validate(data)
                return RedshiftConnectionInfo.model_validate(data)
            case DataSource.snowflake:
                return SnowflakeConnectionInfo.model_validate(data)
            case DataSource.trino:
                return TrinoConnectionInfo.model_validate(data)
            case DataSource.datafusion:
                return DataFusionConnectionInfo.model_validate(data)
            case DataSource.duckdb | DataSource.local_file:
                return LocalFileConnectionInfo.model_validate(data)
            case DataSource.s3_file:
                return S3FileConnectionInfo.model_validate(data)
            case DataSource.minio_file:
                return MinioFileConnectionInfo.model_validate(data)
            case DataSource.gcs_file:
                return GcsFileConnectionInfo.model_validate(data)
            case DataSource.spark:
                return SparkConnectionInfo.model_validate(data)
            case DataSource.databricks:
                if (
                    "databricks_type" in data
                    and data["databricks_type"] == "service_principal"
                ):
                    return DatabricksServicePrincipalConnectionInfo.model_validate(data)
                return DatabricksTokenConnectionInfo.model_validate(data)
            case _:
                raise NotImplementedError(f"Unsupported data source: {self}")

    def _handle_clickhouse_url(
        self, parsed: urllib.parse.ParseResult
    ) -> ClickHouseConnectionInfo:
        allowed_schemes = {"clickhouse", "clickhouse+http", "clickhouse+https"}
        if not parsed.scheme or parsed.scheme not in allowed_schemes:
            raise WrenError(
                ErrorCode.INVALID_CONNECTION_INFO,
                "Invalid connection URL for ClickHouse",
            )
        kwargs = {}
        if parsed.username:
            kwargs["user"] = parsed.username
        if parsed.password:
            kwargs["password"] = unquote_plus(parsed.password)
        if parsed.hostname:
            kwargs["host"] = parsed.hostname
        if parsed.port:
            kwargs["port"] = str(parsed.port)
        if database := parsed.path[1:]:
            kwargs["database"] = database
        parsed_kwargs = dict(urllib.parse.parse_qsl(parsed.query))
        if "secure" in parsed_kwargs:
            kwargs["secure"] = self._safe_strtobool(parsed_kwargs["secure"])
            parsed_kwargs.pop("secure")
        elif parsed.scheme == "clickhouse+https":
            kwargs["secure"] = True
        kwargs["kwargs"] = parsed_kwargs
        return ClickHouseConnectionInfo(**kwargs)

    def _safe_strtobool(self, val: str) -> bool:
        return val.lower() in {"1", "true", "yes", "y"}
