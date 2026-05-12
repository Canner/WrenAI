"""Connection info models and DTOs for the wren package."""

from __future__ import annotations

import json
from enum import Enum
from typing import Annotated, Literal, Union

from pydantic import BaseModel, BeforeValidator, Field, SecretStr

from wren.model.error import ErrorCode, WrenError

StrPort = Annotated[
    str,
    BeforeValidator(
        lambda v: str(v) if isinstance(v, int) and not isinstance(v, bool) else v
    ),
]


class BaseConnectionInfo(BaseModel):
    model_config = {"populate_by_name": True}

    def to_key_string(self) -> str:
        def _normalize(value):
            if isinstance(value, SecretStr):
                return value.get_secret_value()
            if isinstance(value, dict):
                return {k: _normalize(v) for k, v in sorted(value.items())}
            return value

        return json.dumps(
            {name: _normalize(value) for name, value in self},
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )


class BigQueryConnectionInfo(BaseConnectionInfo):
    credentials: SecretStr = Field(
        description="Base64 encode `credentials.json`", examples=["eyJ..."]
    )
    job_timeout_ms: int | None = Field(default=None)

    def get_billing_project_id(self) -> str | None:
        raise WrenError(
            ErrorCode.NOT_IMPLEMENTED,
            "get_billing_project_id not implemented by base class",
        )


class BigQueryDatasetConnectionInfo(BigQueryConnectionInfo):
    bigquery_type: Literal["dataset"] = "dataset"
    project_id: str = Field(examples=["my-project"])
    dataset_id: str = Field(examples=["my_dataset"])

    def get_billing_project_id(self):
        return self.project_id

    def __hash__(self):
        return hash((self.project_id, self.dataset_id, self.credentials))


class BigQueryProjectConnectionInfo(BigQueryConnectionInfo):
    bigquery_type: Literal["project"] = "project"
    region: str = Field(examples=["US"])
    billing_project_id: str = Field(examples=["billing-project-1"])

    def get_billing_project_id(self):
        return self.billing_project_id

    def __hash__(self):
        return hash((self.region, self.billing_project_id, self.credentials))


BigQueryConnectionUnion = Annotated[
    Union[BigQueryDatasetConnectionInfo, BigQueryProjectConnectionInfo],
    Field(discriminator="bigquery_type", default="dataset"),
]


class AthenaConnectionInfo(BaseConnectionInfo):
    s3_staging_dir: SecretStr = Field(examples=["s3://my-bucket/athena-staging/"])
    aws_access_key_id: SecretStr | None = Field(default=None)
    aws_secret_access_key: SecretStr | None = Field(default=None)
    aws_session_token: SecretStr | None = Field(default=None)
    web_identity_token: SecretStr | None = Field(default=None)
    role_arn: SecretStr | None = Field(default=None)
    role_session_name: str | None = Field(default=None)
    region_name: str | None = Field(examples=["us-west-2"], default=None)
    schema_name: str | None = Field(alias="schema_name", default="default")


class CannerConnectionInfo(BaseConnectionInfo):
    host: str = Field(examples=["localhost"])
    port: StrPort = Field(examples=["8080"])
    user: str = Field(examples=["admin"])
    pat: SecretStr = Field(examples=["eyJ..."])
    workspace: str = Field(examples=["default"])
    enable_ssl: bool = Field(default=False, alias="enableSSL")


class ClickHouseConnectionInfo(BaseConnectionInfo):
    host: str = Field(examples=["localhost"])
    port: StrPort = Field(examples=["8123"])
    database: str = Field(examples=["default"])
    user: str = Field(examples=["default"])
    password: SecretStr | None = Field(default=None)
    secure: bool = Field(default=False)
    settings: dict[str, str] | None = Field(default=None)
    kwargs: dict[str, str] | None = Field(default=None)


class YTsaurusConnectionInfo(BaseConnectionInfo):
    """Connection info for a YTsaurus cluster via its CHYT clique.

    ``proxy`` is the YT HTTP proxy host (e.g. ``yt-proxy.example.com``).
    ``clique`` is the CHYT clique alias including the leading ``*``
    (e.g. ``*ch_public``). ``token`` is the YT OAuth token; if omitted the
    connector reads ``YT_TOKEN`` from the environment.
    """

    proxy: str = Field(examples=["yt-proxy.example.com"])
    clique: str = Field(examples=["*ch_public"])
    token: SecretStr | None = Field(
        default=None,
        description="YT OAuth token. Falls back to YT_TOKEN env var if unset.",
    )
    secure: bool = Field(default=True)
    port: StrPort | None = Field(
        default=None,
        description="Override the proxy port. Defaults to 443 (secure) or 80.",
    )
    query_path: str = Field(
        default="/query",
        description=(
            "URL path on the YT HTTP proxy that exposes the CHYT endpoint. "
            "The Nebius and open-source YT default is '/query'. Override only "
            "if your proxy mounts CHYT elsewhere."
        ),
    )
    settings: dict[str, str] | None = Field(default=None)
    kwargs: dict[str, str] | None = Field(default=None)


class MSSqlConnectionInfo(BaseConnectionInfo):
    host: str = Field(examples=["localhost"])
    port: StrPort = Field(examples=["1433"])
    database: str = Field(examples=["master"])
    user: str = Field(examples=["sa"])
    password: SecretStr | None = Field(default=None)
    driver: str = Field(default="ODBC Driver 18 for SQL Server")
    tds_version: str = Field(default="8.0", alias="TDS_Version")
    kwargs: dict[str, str] | None = Field(default=None)


class MySqlConnectionInfo(BaseConnectionInfo):
    host: str = Field(examples=["localhost"])
    port: StrPort = Field(examples=["3306"])
    database: str = Field(examples=["default"])
    user: str = Field(examples=["root"])
    password: SecretStr | None = Field(default=None)
    ssl_mode: str | None = Field(alias="sslMode", default="ENABLED")
    ssl_ca: SecretStr | None = Field(alias="sslCA", default=None)
    kwargs: dict[str, str] | None = Field(default=None)


class DorisConnectionInfo(BaseConnectionInfo):
    host: str = Field(examples=["localhost"])
    port: StrPort = Field(examples=["9030"])
    database: str = Field(examples=["default"])
    user: str = Field(examples=["root"])
    password: SecretStr | None = Field(default=None)
    kwargs: dict[str, str] | None = Field(default=None)


class PostgresConnectionInfo(BaseConnectionInfo):
    host: str = Field(examples=["localhost"])
    port: StrPort = Field(examples=["5432"])
    database: str = Field(examples=["postgres"])
    user: str = Field(examples=["postgres"])
    password: SecretStr | None = Field(default=None)
    kwargs: dict[str, str] | None = Field(default=None)


class OracleConnectionInfo(BaseConnectionInfo):
    host: str = Field(default="localhost", examples=["localhost"])
    port: StrPort = Field(default="1521", examples=[1521])
    database: str = Field(default="orcl", examples=["orcl"])
    user: str = Field(examples=["admin"])
    password: SecretStr | None = Field(default=None)
    dsn: SecretStr | None = Field(default=None)


class RedshiftConnectionInfo(BaseConnectionInfo):
    redshift_type: Literal["redshift"] = "redshift"
    host: str = Field(examples=["localhost"])
    port: StrPort = Field(examples=["5439"])
    database: str = Field(examples=["dev"])
    user: str = Field(examples=["awsuser"])
    password: SecretStr = Field(examples=["password"])


class RedshiftIAMConnectionInfo(BaseConnectionInfo):
    redshift_type: Literal["redshift_iam"] = "redshift_iam"
    cluster_identifier: str = Field(examples=["my-redshift-cluster"])
    database: str = Field(examples=["dev"])
    user: str = Field(examples=["awsuser"])
    region: str = Field(examples=["us-west-2"])
    access_key_id: SecretStr = Field(examples=["AKIA..."])
    access_key_secret: SecretStr = Field(examples=["my-secret-key"])


RedshiftConnectionUnion = Annotated[
    Union[RedshiftConnectionInfo, RedshiftIAMConnectionInfo],
    Field(discriminator="redshift_type"),
]


class SnowflakeConnectionInfo(BaseConnectionInfo):
    user: str = Field(examples=["admin"])
    password: SecretStr | None = Field(default=None)
    account: str = Field(examples=["myaccount"])
    database: str = Field(examples=["mydb"])
    sf_schema: str = Field(alias="schema", examples=["myschema"])
    warehouse: str | None = Field(default=None)
    private_key: SecretStr | None = Field(default=None)
    kwargs: dict[str, str] | None = Field(default=None)


class SparkConnectionInfo(BaseConnectionInfo):
    host: str = Field(examples=["localhost"])
    port: StrPort = Field(examples=["15002"])


class DatabricksTokenConnectionInfo(BaseConnectionInfo):
    databricks_type: Literal["token"] = "token"
    server_hostname: str = Field(
        alias="serverHostname", examples=["dbc-xxx.cloud.databricks.com"]
    )
    http_path: str = Field(alias="httpPath", examples=["/sql/1.0/warehouses/xxx"])
    access_token: SecretStr = Field(alias="accessToken", examples=["dapi..."])


class DatabricksServicePrincipalConnectionInfo(BaseConnectionInfo):
    databricks_type: Literal["service_principal"] = "service_principal"
    server_hostname: str = Field(alias="serverHostname")
    http_path: str = Field(alias="httpPath")
    client_id: SecretStr = Field(alias="clientId")
    client_secret: SecretStr = Field(alias="clientSecret")
    azure_tenant_id: str | None = Field(alias="azureTenantId", default=None)


DatabricksConnectionUnion = Annotated[
    Union[DatabricksTokenConnectionInfo, DatabricksServicePrincipalConnectionInfo],
    Field(discriminator="databricks_type"),
]


class TrinoConnectionInfo(BaseConnectionInfo):
    host: str = Field(examples=["localhost"])
    port: StrPort = Field(default="8080")
    catalog: str = Field(examples=["hive"])
    trino_schema: str = Field(alias="schema", examples=["default"])
    user: str | None = Field(default=None)
    password: SecretStr | None = Field(default=None)
    kwargs: dict[str, str] | None = Field(default=None)


class DataFusionConnectionInfo(BaseConnectionInfo):
    source: str = Field(
        description="Root path for data files",
        examples=["./data", "/absolute/path/data"],
    )
    format: Literal["parquet", "csv"] = Field(
        default="parquet",
        description="Default file format to scan",
    )


class LocalFileConnectionInfo(BaseConnectionInfo):
    url: str = Field(default="/", examples=["/data"])
    format: str = Field(default="csv", examples=["csv", "parquet", "json", "duckdb"])


class S3FileConnectionInfo(BaseConnectionInfo):
    url: str = Field(default="/", examples=["/data"])
    format: str = Field(default="csv")
    bucket: str = Field(examples=["my-bucket"])
    region: str = Field(examples=["us-west-2"])
    access_key: SecretStr = Field(examples=["my-access-key"])
    secret_key: SecretStr = Field(examples=["my-secret-key"])


class MinioFileConnectionInfo(BaseConnectionInfo):
    url: str = Field(default="/", examples=["/data"])
    format: str = Field(default="csv")
    ssl_enabled: bool = Field(default=False)
    endpoint: str = Field(examples=["localhost:9000"])
    bucket: str = Field(examples=["my-bucket"])
    access_key: SecretStr = Field(examples=["my-account"])
    secret_key: SecretStr = Field(examples=["my-password"])


class GcsFileConnectionInfo(BaseConnectionInfo):
    url: str = Field(default="/", examples=["/data"])
    format: str = Field(default="csv")
    bucket: str = Field(examples=["my-bucket"])
    key_id: SecretStr = Field(examples=["my-key-id"])
    secret_key: SecretStr = Field(examples=["my-secret-key"])
    credentials: SecretStr | None = Field(default=None, examples=["eyJ..."])


class ConnectionUrl(BaseConnectionInfo):
    connection_url: SecretStr = Field(alias="connectionUrl")
    kwargs: dict[str, str] | None = Field(default=None)


ConnectionInfo = (
    AthenaConnectionInfo
    | BigQueryDatasetConnectionInfo
    | BigQueryProjectConnectionInfo
    | CannerConnectionInfo
    | ClickHouseConnectionInfo
    | ConnectionUrl
    | DataFusionConnectionInfo
    | MSSqlConnectionInfo
    | MySqlConnectionInfo
    | DorisConnectionInfo
    | OracleConnectionInfo
    | PostgresConnectionInfo
    | RedshiftConnectionInfo
    | RedshiftIAMConnectionInfo
    | SnowflakeConnectionInfo
    | SparkConnectionInfo
    | DatabricksTokenConnectionInfo
    | DatabricksServicePrincipalConnectionInfo
    | TrinoConnectionInfo
    | LocalFileConnectionInfo
    | S3FileConnectionInfo
    | MinioFileConnectionInfo
    | GcsFileConnectionInfo
    | YTsaurusConnectionInfo
)


class SSLMode(str, Enum):
    DISABLED = "disabled"
    ENABLED = "enabled"
    VERIFY_CA = "verify_ca"
