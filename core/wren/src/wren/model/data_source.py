from __future__ import annotations

import base64
import datetime as dtlib
import urllib
from enum import Enum, StrEnum, auto
from json import loads
from typing import TYPE_CHECKING, Any, Union
from urllib.parse import unquote_plus, urlparse

import ibis
from ibis import BaseBackend

try:
    import pyodbc
except ImportError:  # pragma: no cover
    pyodbc = None

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

if TYPE_CHECKING:
    import MySQLdb
    import psycopg
    from pyathena.connection import Connection as PyAthenaConnection

# get_connection() may return either an ibis BaseBackend (for connectors still
# routed through ibis) or a native driver connection for connectors that have
# dropped the ibis dependency (Athena via pyathena, MySQL/Doris via MySQLdb,
# Postgres/Canner via psycopg).
BackendOrConnection = Union[
    BaseBackend, "PyAthenaConnection", "MySQLdb.Connection", "psycopg.Connection"
]

X_WREN_DB_STATEMENT_TIMEOUT = "x-wren-db-statement_timeout"
MSSQL_DATETIMEOFFSET_TYPE_CODE = -155


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
                # MySQL / Doris use the native MySQLdb driver, not ibis.
                if self.name in {"mysql", "doris"}:
                    return getattr(self, f"get_{self.name}_connection")(info)
                if self.name == "trino":
                    # Trino uses the native DB-API client; the generic
                    # ``ibis.connect()`` path was removed when the native
                    # connector landed. Route the URL through the dedicated
                    # parser so callers still get a working connection.
                    from wren.connector.trino import (  # noqa: PLC0415
                        _build_trino_connect_kwargs,
                    )

                    trino_kwargs = _build_trino_connect_kwargs(info)
                    trino_kwargs.pop("_password", None)
                    trino_kwargs.pop("access_token", None)
                    from trino.dbapi import (  # noqa: PLC0415
                        connect as trino_connect,
                    )

                    return trino_connect(**trino_kwargs)
                kwargs = info.kwargs if info.kwargs else {}
                if self.name == "mssql":
                    return self.get_mssql_connection_from_url(
                        info.connection_url.get_secret_value(), kwargs
                    )
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
        import ibis  # noqa: PLC0415
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
    def get_canner_connection(info: CannerConnectionInfo):
        import psycopg  # noqa: PLC0415

        return psycopg.connect(
            host=info.host,
            port=int(info.port),
            dbname=info.workspace,
            user=info.user,
            password=info.pat.get_secret_value(),
            autocommit=True,
        )

    @staticmethod
    def get_clickhouse_connection(info: ClickHouseConnectionInfo):
        import clickhouse_connect  # noqa: PLC0415

        settings = dict(info.settings) if info.settings else {}
        kwargs = dict(info.kwargs) if info.kwargs else {}
        statement_timeout = kwargs.pop("statement_timeout", None)
        if statement_timeout is not None:
            settings["max_execution_time"] = int(statement_timeout)
        # Merge any user-supplied ``settings`` from kwargs into the local dict
        # *before* applying the rest, otherwise ``client_kwargs.update(kwargs)``
        # below would clobber the statement_timeout-derived max_execution_time.
        extra_settings = kwargs.pop("settings", None)
        if extra_settings:
            settings.update(extra_settings)

        client_kwargs = {
            "host": info.host,
            "port": int(info.port),
            "database": info.database,
            "username": info.user,
            "password": info.password.get_secret_value() if info.password else "",
            "secure": info.secure,
            "settings": settings,
        }
        client_kwargs.update(kwargs)
        return clickhouse_connect.get_client(**client_kwargs)

    @classmethod
    def get_mssql_connection(cls, info: MSSqlConnectionInfo):
        return cls._connect_mssql_pyodbc(
            host=info.host,
            port=info.port,
            database=info.database,
            user=info.user,
            password=info.password.get_secret_value() if info.password else None,
            driver=info.driver,
            kwargs={
                "TDS_Version": info.tds_version,
                **(info.kwargs if info.kwargs else {}),
            },
        )

    @classmethod
    def get_mssql_connection_from_url(
        cls, connection_url: str, base_kwargs: dict[str, Any] | None = None
    ):
        parsed = urlparse(connection_url)
        if parsed.scheme != "mssql":
            raise WrenError(
                ErrorCode.INVALID_CONNECTION_INFO,
                "Invalid connection URL for MSSQL",
            )

        if not parsed.hostname or not parsed.path or not parsed.username:
            raise WrenError(
                ErrorCode.INVALID_CONNECTION_INFO,
                "MSSQL connection URL must include user, host and database",
            )

        kwargs = dict(base_kwargs) if base_kwargs else {}
        # parse_qsl already URL-decodes values, but we re-apply unquote_plus
        # below only to components urlparse leaves encoded (user, path, password).
        for key, value in urllib.parse.parse_qsl(parsed.query):
            kwargs[key] = value
        driver = kwargs.pop("driver", "ODBC Driver 18 for SQL Server")

        return cls._connect_mssql_pyodbc(
            host=parsed.hostname,
            port=str(parsed.port or 1433),
            database=unquote_plus(parsed.path.lstrip("/")),
            user=unquote_plus(parsed.username),
            password=unquote_plus(parsed.password) if parsed.password else None,
            driver=driver,
            kwargs=kwargs,
        )

    @staticmethod
    def _connect_mssql_pyodbc(
        host: str,
        port: str,
        database: str,
        user: str | None,
        password: str | None,
        driver: str,
        kwargs: dict[str, Any] | None = None,
    ):
        if pyodbc is None:  # pragma: no cover
            raise WrenError(
                ErrorCode.GET_CONNECTION_ERROR, "pyodbc is required for MSSQL"
            )

        connect_kwargs = dict(kwargs) if kwargs else {}
        statement_timeout = connect_kwargs.pop("statement_timeout", None)
        # Validate statement_timeout before opening the connection so a bad
        # value can't leak the pyodbc connection we'd otherwise open first.
        if statement_timeout is not None:
            try:
                statement_timeout = int(statement_timeout)
            except (TypeError, ValueError) as exc:
                raise WrenError(
                    ErrorCode.INVALID_CONNECTION_INFO,
                    f"Invalid statement_timeout for MSSQL: {statement_timeout!r}",
                ) from exc

        connection_parts = [
            f"DRIVER={DataSourceExtension._escape_odbc_value(driver)}",
            f"SERVER={host},{port}",
            f"DATABASE={DataSourceExtension._escape_odbc_value(database)}",
        ]
        if user is None and password is None:
            connection_parts.append("Trusted_Connection=yes")
        elif user is None or password is None:
            raise WrenError(
                ErrorCode.INVALID_CONNECTION_INFO,
                "MSSQL connection requires both user and password, "
                "or neither (for Trusted_Connection)",
            )
        else:
            connection_parts.append(
                f"UID={DataSourceExtension._escape_odbc_value(user)}"
            )
            connection_parts.append(
                f"PWD={DataSourceExtension._escape_odbc_value(password)}"
            )

        for key, value in connect_kwargs.items():
            connection_parts.append(
                f"{key}={DataSourceExtension._escape_odbc_value(str(value))}"
            )

        connection = pyodbc.connect(";".join(connection_parts))
        DataSourceExtension._register_mssql_output_converters(connection)

        if statement_timeout is not None:
            connection.timeout = statement_timeout

        return connection

    @staticmethod
    def _escape_odbc_value(value: str) -> str:
        return "{" + value.replace("}", "}}") + "}"

    @staticmethod
    def _register_mssql_output_converters(connection) -> None:
        connection.add_output_converter(
            MSSQL_DATETIMEOFFSET_TYPE_CODE,
            DataSourceExtension._decode_mssql_datetimeoffset,
        )

    @staticmethod
    def _decode_mssql_datetimeoffset(value: bytes | None) -> dtlib.datetime | None:
        if value is None:
            return None
        if len(value) != 20:
            raise ValueError(
                "unexpected mssql datetimeoffset payload length: "
                f"expected 20, got {len(value)}"
            )

        year = int.from_bytes(value[0:2], "little")
        month = int.from_bytes(value[2:4], "little")
        day = int.from_bytes(value[4:6], "little")
        hour = int.from_bytes(value[6:8], "little")
        minute = int.from_bytes(value[8:10], "little")
        second = int.from_bytes(value[10:12], "little")
        nanoseconds = int.from_bytes(value[12:16], "little")
        offset_hours = int.from_bytes(value[16:18], "little", signed=True)
        offset_minutes = int.from_bytes(value[18:20], "little", signed=True)

        tzinfo = dtlib.timezone(
            dtlib.timedelta(hours=offset_hours, minutes=offset_minutes)
        )
        return dtlib.datetime(
            year=year,
            month=month,
            day=day,
            hour=hour,
            minute=minute,
            second=second,
            microsecond=nanoseconds // 1000,
            tzinfo=tzinfo,
        )

    @classmethod
    def get_mysql_connection(cls, info: MySqlConnectionInfo) -> "MySQLdb.Connection":
        import MySQLdb  # noqa: PLC0415

        from wren.connector.mysql import _build_mysql_connect_kwargs  # noqa: PLC0415

        return MySQLdb.connect(**_build_mysql_connect_kwargs(info))

    @classmethod
    def get_doris_connection(cls, info: DorisConnectionInfo) -> "MySQLdb.Connection":
        import MySQLdb  # noqa: PLC0415

        from wren.connector.mysql import _build_doris_connect_kwargs  # noqa: PLC0415

        return MySQLdb.connect(**_build_doris_connect_kwargs(info))

    @staticmethod
    def get_postgres_connection(
        info: PostgresConnectionInfo,
    ) -> "psycopg.Connection":
        """Open a native psycopg3 connection to PostgreSQL.

        Returned object is a ``psycopg.Connection`` — the postgres connector
        uses raw cursors and an OID-to-Arrow mapping to convert results.
        """
        import psycopg  # noqa: PLC0415

        kwargs: dict[str, Any] = dict(info.kwargs) if info.kwargs else {}
        return psycopg.connect(
            host=info.host,
            port=int(info.port),
            dbname=info.database,
            user=info.user,
            password=(info.password and info.password.get_secret_value()),
            **kwargs,
        )

    @staticmethod
    def get_oracle_connection(info: OracleConnectionInfo) -> BaseBackend:
        import ibis  # noqa: PLC0415

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
    def get_trino_connection(info: TrinoConnectionInfo):
        """Return a ``trino.dbapi.Connection`` (not an ibis backend).

        The wren SDK calls into ``wren.connector.trino`` for trino, which
        operates directly on the DB-API cursor. ``get_connection`` only ever
        re-routes here when something outside the v4 connector code path
        explicitly requests a trino connection.
        """
        from trino.auth import BasicAuthentication  # noqa: PLC0415
        from trino.dbapi import connect as trino_connect  # noqa: PLC0415

        kwargs = dict(info.kwargs) if info.kwargs else {}
        password = info.password.get_secret_value() if info.password else None

        connect_kwargs: dict = {
            "host": info.host,
            "port": int(info.port),
            "user": info.user,
            "catalog": info.catalog,
            "schema": info.trino_schema,
            # Pin to UTC so timestamp-with-tz casts are deterministic.
            "timezone": "UTC",
        }
        if info.user and password:
            connect_kwargs["auth"] = BasicAuthentication(info.user, password)
            connect_kwargs["http_scheme"] = "https"
        connect_kwargs.update(kwargs)
        return trino_connect(**connect_kwargs)

    @staticmethod
    def get_databricks_connection(info: DatabricksTokenConnectionInfo) -> BaseBackend:
        import ibis  # noqa: PLC0415

        return ibis.databricks.connect(
            server_hostname=info.server_hostname,
            http_path=info.http_path,
            access_token=info.access_token.get_secret_value(),
        )
