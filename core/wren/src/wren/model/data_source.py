from __future__ import annotations

import base64
import ssl
import urllib
from enum import Enum, StrEnum, auto
from json import loads
from typing import TYPE_CHECKING, Any, Union
from urllib.parse import unquote_plus

import ibis
from ibis import BaseBackend

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
    SSLMode,
    TrinoConnectionInfo,
)
from wren.model.error import ErrorCode, WrenError

if TYPE_CHECKING:
    from pyathena.connection import Connection as PyAthenaConnection

# get_connection() may return either an ibis BaseBackend (for connectors
# still routed through ibis) or a native driver connection (for connectors
# that have dropped the ibis dependency, e.g. Athena via pyathena).
BackendOrConnection = Union[BaseBackend, "PyAthenaConnection"]

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

    def get_connection(self, info: ConnectionInfo) -> BackendOrConnection:
        try:
            return DataSourceExtension[self].get_connection(info)
        except KeyError:
            raise NotImplementedError(f"Unsupported data source: {self}")

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
        if not parsed.scheme or parsed.scheme != "clickhouse":
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
        kwargs["kwargs"] = parsed_kwargs
        return ClickHouseConnectionInfo(**kwargs)

    def _safe_strtobool(self, val: str) -> bool:
        return val.lower() in {"1", "true", "yes", "y"}


class DataSourceExtension(Enum):
    athena = "athena"
    bigquery = "bigquery"
    canner = "canner"
    clickhouse = "clickhouse"
    datafusion = "datafusion"
    mssql = "mssql"
    mysql = "mysql"
    doris = "doris"
    oracle = "oracle"
    postgres = "postgres"
    redshift = "redshift"
    snowflake = "snowflake"
    trino = "trino"
    local_file = "local_file"
    duckdb = "duckdb"
    s3_file = "s3_file"
    minio_file = "minio_file"
    gcs_file = "gcs_file"
    databricks = "databricks"
    spark = "spark"

    def get_connection(self, info: ConnectionInfo) -> BackendOrConnection:
        try:
            if hasattr(info, "connection_url"):
                kwargs = info.kwargs if info.kwargs else {}
                return ibis.connect(info.connection_url.get_secret_value(), **kwargs)
            if self.name in {"local_file", "redshift", "spark", "duckdb", "datafusion"}:
                raise NotImplementedError(
                    f"{self.name} connection is not implemented to get ibis backend"
                )
            return getattr(self, f"get_{self.name}_connection")(info)
        except KeyError:
            raise NotImplementedError(f"Unsupported data source: {self}")
        except WrenError:
            raise
        except Exception as e:
            raise WrenError(ErrorCode.GET_CONNECTION_ERROR, f"{e!s}") from e

    @staticmethod
    def get_athena_connection(info: AthenaConnectionInfo) -> PyAthenaConnection:
        """Open a pyathena DB-API connection.

        Delegates connection-kwargs construction to
        :func:`wren.connector.athena._build_connect_kwargs` so the legacy
        ``data_source`` path and the native :class:`AthenaConnector` stay in
        lockstep on credential resolution, ``schema_name`` propagation,
        ``kill_on_interrupt``, and user ``kwargs`` merge semantics.
        """
        from pyathena import connect  # noqa: PLC0415

        from wren.connector.athena import _build_connect_kwargs  # noqa: PLC0415

        return connect(**_build_connect_kwargs(info))

    @staticmethod
    def get_bigquery_connection(info: BigQueryDatasetConnectionInfo) -> BaseBackend:
        from google.cloud import bigquery  # noqa: PLC0415
        from google.oauth2 import service_account  # noqa: PLC0415

        credits_json = loads(
            base64.b64decode(info.credentials.get_secret_value()).decode("utf-8")
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
        bq_client = bigquery.Client(project=info.project_id, credentials=credentials)
        job_config = bigquery.QueryJobConfig()
        job_config.job_timeout_ms = info.job_timeout_ms
        bq_client.default_query_job_config = job_config
        return ibis.bigquery.connect(client=bq_client, credentials=credentials)

    @staticmethod
    def get_canner_connection(info: CannerConnectionInfo) -> BaseBackend:
        return ibis.postgres.connect(
            host=info.host,
            port=int(info.port),
            database=info.workspace,
            user=info.user,
            password=info.pat.get_secret_value(),
        )

    @staticmethod
    def get_clickhouse_connection(info: ClickHouseConnectionInfo) -> BaseBackend:
        return ibis.clickhouse.connect(
            host=info.host,
            port=int(info.port),
            database=info.database,
            user=info.user,
            password=(info.password and info.password.get_secret_value()),
            settings=info.settings if info.settings else {},
            **info.kwargs if info.kwargs else {},
        )

    @classmethod
    def get_mssql_connection(cls, info: MSSqlConnectionInfo) -> BaseBackend:
        return ibis.mssql.connect(
            host=info.host,
            port=info.port,
            database=info.database,
            user=info.user,
            password=info.password.get_secret_value(),
            driver=info.driver,
            TDS_Version=info.tds_version,
            **info.kwargs if info.kwargs else {},
        )

    @classmethod
    def get_mysql_connection(cls, info: MySqlConnectionInfo) -> BaseBackend:
        ssl_context = cls._create_ssl_context(info)
        kwargs = {"ssl": ssl_context} if ssl_context else {}
        kwargs.setdefault("charset", "utf8mb4")
        if info.kwargs:
            kwargs.update(info.kwargs)
        return ibis.mysql.connect(
            host=info.host,
            port=int(info.port),
            database=info.database,
            user=info.user,
            password=info.password.get_secret_value() if info.password else "",
            **kwargs,
        )

    @classmethod
    def get_doris_connection(cls, info: DorisConnectionInfo) -> BaseBackend:
        kwargs: dict = {}
        kwargs.setdefault("charset", "utf8mb4")
        if info.kwargs:
            kwargs.update(info.kwargs)
        connection = ibis.mysql.connect(
            host=info.host,
            port=int(info.port),
            database=info.database,
            user=info.user,
            password=info.password.get_secret_value() if info.password else "",
            **kwargs,
        )
        connection.con.get_autocommit = lambda: True
        return connection

    @staticmethod
    def get_postgres_connection(info: PostgresConnectionInfo) -> BaseBackend:
        return ibis.postgres.connect(
            host=info.host,
            port=int(info.port),
            database=info.database,
            user=info.user,
            password=(info.password and info.password.get_secret_value()),
            **info.kwargs if info.kwargs else {},
        )

    @staticmethod
    def get_oracle_connection(info: OracleConnectionInfo) -> BaseBackend:
        if hasattr(info, "dsn") and info.dsn:
            return ibis.oracle.connect(
                dsn=info.dsn.get_secret_value(),
                user=info.user,
                password=(info.password and info.password.get_secret_value()),
            )
        return ibis.oracle.connect(
            host=info.host,
            port=int(info.port),
            database=info.database,
            user=info.user,
            password=(info.password and info.password.get_secret_value()),
        )

    @staticmethod
    def get_snowflake_connection(info: SnowflakeConnectionInfo):
        from wren.connector.snowflake import make_snowflake_connection  # noqa: PLC0415

        return make_snowflake_connection(info)

    @staticmethod
    def get_trino_connection(info: TrinoConnectionInfo) -> BaseBackend:
        return ibis.trino.connect(
            host=info.host,
            port=int(info.port),
            database=info.catalog,
            schema=info.trino_schema,
            user=info.user,
            password=(info.password and info.password.get_secret_value()),
            **info.kwargs if info.kwargs else {},
        )

    @staticmethod
    def get_databricks_connection(info: DatabricksTokenConnectionInfo) -> BaseBackend:
        return ibis.databricks.connect(
            server_hostname=info.server_hostname,
            http_path=info.http_path,
            access_token=info.access_token.get_secret_value(),
        )

    @staticmethod
    def _create_ssl_context(info: ConnectionInfo) -> ssl.SSLContext | None:
        ssl_mode = (
            info.ssl_mode if hasattr(info, "ssl_mode") and info.ssl_mode else None
        )

        if ssl_mode == SSLMode.VERIFY_CA and not info.ssl_ca:
            raise WrenError(
                ErrorCode.INVALID_CONNECTION_INFO,
                "SSL CA must be provided when SSL mode is VERIFY CA",
            )

        if not ssl_mode or ssl_mode == SSLMode.DISABLED:
            return None

        ctx = ssl.create_default_context()
        ctx.check_hostname = False

        if ssl_mode == SSLMode.ENABLED:
            ctx.verify_mode = ssl.CERT_NONE
        elif ssl_mode == SSLMode.VERIFY_CA:
            ctx.verify_mode = ssl.CERT_REQUIRED
            ctx.load_verify_locations(
                cadata=base64.b64decode(info.ssl_ca.get_secret_value()).decode("utf-8")
                if info.ssl_ca
                else None
            )

        return ctx
