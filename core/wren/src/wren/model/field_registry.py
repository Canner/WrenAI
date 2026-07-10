"""Shared field registry derived from Pydantic connection info models.

Provides a single source of truth for datasource field definitions used by:
- wren CLI interactive prompts (profile_cli.py)
- MCP web UI forms (mcp-server/app/web.py)
- Documentation generation (docs.py)
"""

from __future__ import annotations

import typing
from dataclasses import dataclass

from pydantic import SecretStr

from wren.model import (
    AthenaConnectionInfo,
    BaseConnectionInfo,
    BigQueryDatasetConnectionInfo,
    BigQueryProjectConnectionInfo,
    CannerConnectionInfo,
    ClickHouseConnectionInfo,
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

# Canonical datasource → ConnectionInfo model(s) mapping.
# Sources with discriminated unions list all variants in display order.
DATASOURCE_MODELS: dict[str, list[type[BaseConnectionInfo]]] = {
    "athena": [AthenaConnectionInfo],
    "bigquery": [BigQueryDatasetConnectionInfo, BigQueryProjectConnectionInfo],
    "canner": [CannerConnectionInfo],
    "clickhouse": [ClickHouseConnectionInfo],
    "datafusion": [DataFusionConnectionInfo],
    "databricks": [
        DatabricksTokenConnectionInfo,
        DatabricksServicePrincipalConnectionInfo,
    ],
    "doris": [DorisConnectionInfo],
    "duckdb": [LocalFileConnectionInfo],
    "gcs_file": [GcsFileConnectionInfo],
    "local_file": [LocalFileConnectionInfo],
    "minio_file": [MinioFileConnectionInfo],
    "mssql": [MSSqlConnectionInfo],
    "mysql": [MySqlConnectionInfo],
    "oracle": [OracleConnectionInfo],
    "postgres": [PostgresConnectionInfo],
    "redshift": [RedshiftConnectionInfo, RedshiftIAMConnectionInfo],
    "s3_file": [S3FileConnectionInfo],
    "snowflake": [SnowflakeConnectionInfo],
    "spark": [SparkConnectionInfo],
    "trino": [TrinoConnectionInfo],
    "connection_url": [ConnectionUrl],
}


@dataclass(frozen=True)
class FieldDef:
    """A single connection field with both Pydantic metadata and UI hints."""

    name: str  # Pydantic field name (e.g. "project_id")
    label: str  # Human-readable label (e.g. "Project ID")
    input_type: str  # "text" | "password" | "hidden" | "file_base64"
    placeholder: str  # Hint text for empty input (e.g. "localhost")
    hint: str | None  # Extra help text
    required: bool  # From Pydantic is_required()
    default: str | None  # Display-friendly default value
    sensitive: bool  # True if SecretStr
    alias: str | None  # Pydantic alias (e.g. "schema" for sf_schema)
    examples: list[str]  # From Pydantic field examples
    accept: str | None  # File accept filter (e.g. ".json") — only for file_base64


# Model-level UI overrides: model_class_name → field_name → override dict.
# Only covers cases where auto-derivation produces wrong results.
_MODEL_UI_OVERRIDES: dict[str, dict[str, dict]] = {
    "BigQueryDatasetConnectionInfo": {
        "credentials": {
            "input_type": "file_base64",
            "accept": ".json",
            "hint": "Upload your GCP service account credentials.json file. It will be base64-encoded automatically.",
        },
    },
    "BigQueryProjectConnectionInfo": {
        "credentials": {
            "input_type": "file_base64",
            "accept": ".json",
            "hint": "Upload your GCP service account credentials.json file. It will be base64-encoded automatically.",
        },
    },
    "SnowflakeConnectionInfo": {
        "sf_schema": {"label": "Schema"},
        "private_key": {"label": "Private Key"},
    },
    "TrinoConnectionInfo": {
        "trino_schema": {"label": "Schema"},
    },
    "DatabricksTokenConnectionInfo": {
        "server_hostname": {"label": "Server Hostname"},
        "http_path": {"label": "HTTP Path"},
        "access_token": {"label": "Access Token"},
    },
    "DatabricksServicePrincipalConnectionInfo": {
        "server_hostname": {"label": "Server Hostname"},
        "http_path": {"label": "HTTP Path"},
        "client_id": {"label": "Client ID"},
        "client_secret": {"label": "Client Secret"},
        "azure_tenant_id": {"label": "Azure Tenant ID"},
    },
    "AthenaConnectionInfo": {
        "s3_staging_dir": {"label": "S3 Staging Dir"},
        "aws_access_key_id": {"label": "Access Key ID"},
        "aws_secret_access_key": {"label": "Secret Access Key"},
        "aws_session_token": {"label": "Session Token"},
        "web_identity_token": {"label": "Web Identity Token"},
        "role_arn": {"label": "Role ARN"},
        "role_session_name": {"label": "Role Session Name"},
        "region_name": {"label": "Region"},
        "schema_name": {"label": "Schema"},
    },
    "CannerConnectionInfo": {
        "pat": {"label": "Personal Access Token"},
        "enable_ssl": {"label": "Enable SSL", "input_type": "text"},
    },
    "MSSqlConnectionInfo": {
        "tds_version": {"label": "TDS Version"},
    },
    "MySqlConnectionInfo": {
        "ssl_mode": {"label": "SSL Mode", "input_type": "text"},
        "ssl_ca": {"label": "SSL CA"},
    },
    "RedshiftIAMConnectionInfo": {
        "cluster_identifier": {"label": "Cluster Identifier"},
        "access_key_id": {"label": "Access Key ID"},
        "access_key_secret": {"label": "Secret Access Key"},
    },
    "S3FileConnectionInfo": {
        "access_key": {"label": "Access Key ID"},
        "secret_key": {"label": "Secret Access Key"},
    },
    "MinioFileConnectionInfo": {
        "access_key": {"label": "Access Key ID"},
        "secret_key": {"label": "Secret Access Key"},
        "ssl_enabled": {"label": "SSL Enabled", "input_type": "text"},
    },
    "GcsFileConnectionInfo": {
        "key_id": {"label": "Key ID"},
        "secret_key": {"label": "Secret Key"},
        "credentials": {
            "label": "Credentials (Base64)",
            "input_type": "password",
            "placeholder": "eyJ...",
        },
    },
    "ConnectionUrl": {
        "connection_url": {"label": "Connection URL"},
    },
    "OracleConnectionInfo": {
        "dsn": {"label": "DSN (optional — overrides host/port/database)"},
    },
}

# Datasource-level overrides: datasource_name → field_name → override dict.
# Takes priority over model-level overrides.
_DATASOURCE_UI_OVERRIDES: dict[str, dict[str, dict]] = {
    "datafusion": {
        "source": {"label": "Data Directory", "examples": ["./data"]},
        "format": {"label": "File Format", "placeholder": "parquet"},
    },
    "duckdb": {
        "url": {
            "label": "Directory Path",
            "placeholder": "/data",
            "hint": "Path to a directory containing .duckdb files, not the .duckdb file itself.",
        },
        "format": {"input_type": "hidden", "default": "duckdb"},
    },
    "local_file": {
        "url": {"label": "Root Path", "placeholder": "/data"},
    },
}


def _union_args(annotation) -> tuple | None:
    """Return type args if annotation is Union/UnionType, else None."""
    import types  # noqa: PLC0415
    from typing import Union  # noqa: PLC0415

    if isinstance(annotation, types.UnionType):
        return annotation.__args__
    origin = getattr(annotation, "__origin__", None)
    if origin is Union:
        return annotation.__args__
    return None


def _is_sensitive(field_info) -> bool:
    """Check if field uses SecretStr."""
    annotation = field_info.annotation
    args = _union_args(annotation)
    if args:
        return any(a is SecretStr for a in args)
    return annotation is SecretStr


def _is_literal(annotation) -> bool:
    """Check if annotation is a Literal type."""
    return getattr(annotation, "__origin__", None) is typing.Literal


def _is_dict_type(annotation) -> bool:
    """Check if annotation is or wraps a dict type (not useful in UI forms)."""
    if getattr(annotation, "__origin__", None) is dict:
        return True
    args = _union_args(annotation)
    if args:
        return any(getattr(a, "__origin__", None) is dict for a in args)
    return False


def _field_default(field_info) -> str | None:
    """Return display-friendly string for the field's default, or None if required."""
    if field_info.is_required():
        return None
    default = field_info.default
    if default is None:
        return None
    if isinstance(default, SecretStr):
        return default.get_secret_value()
    if isinstance(default, bool):
        return str(default).lower()
    if isinstance(default, str):
        return default
    return str(default)


def _label_from_name(name: str) -> str:
    """Convert snake_case field name to Title Case label."""
    return name.replace("_", " ").title()


def _auto_derive_field(
    field_name: str,
    field_info,
    model_overrides: dict[str, dict],
    datasource_overrides: dict[str, dict],
) -> FieldDef:
    """Derive a FieldDef from Pydantic field_info + UI overrides."""
    annotation = field_info.annotation

    # Determine base input type and default
    if _is_literal(annotation):
        # Discriminator fields (e.g. bigquery_type: Literal["dataset"] = "dataset")
        base_input_type = "hidden"
        base_default = str(annotation.__args__[0])
    elif _is_sensitive(field_info):
        base_input_type = "password"
        base_default = _field_default(field_info)
    else:
        args = _union_args(annotation)
        if args:
            non_none = [a for a in args if a is not type(None)]
            if len(non_none) == 1 and _is_literal(non_none[0]):
                base_input_type = "hidden"
                base_default = str(non_none[0].__args__[0])
            else:
                base_input_type = "text"
                base_default = _field_default(field_info)
        else:
            base_input_type = "text"
            base_default = _field_default(field_info)

    examples = field_info.examples or []
    base_placeholder = str(examples[0]) if examples else ""
    base_alias = (
        field_info.alias
        if field_info.alias and field_info.alias != field_name
        else None
    )

    # Merge model-level overrides then datasource-level (higher priority)
    m_ov = model_overrides.get(field_name, {})
    d_ov = datasource_overrides.get(field_name, {})
    overrides = {**m_ov, **d_ov}

    return FieldDef(
        name=field_name,
        label=overrides.get("label", _label_from_name(field_name)),
        input_type=overrides.get("input_type", base_input_type),
        placeholder=overrides.get("placeholder", base_placeholder),
        hint=overrides.get("hint", None),
        required=field_info.is_required(),
        default=overrides.get("default", base_default),
        sensitive=_is_sensitive(field_info),
        alias=base_alias,
        examples=[str(e) for e in examples],
        accept=overrides.get("accept", None),
    )


def _get_variant_name(model_cls: type[BaseConnectionInfo]) -> str | None:
    """Extract discriminator variant value from a model's Literal field, if any."""
    for _, field_info in model_cls.model_fields.items():
        annotation = field_info.annotation
        if _is_literal(annotation):
            return str(annotation.__args__[0])
    return None


def get_variants(datasource: str) -> list[str] | None:
    """Return variant names if datasource has subtypes, else None.

    Example:
        get_variants("bigquery") → ["dataset", "project"]
        get_variants("postgres") → None
    """
    key = datasource.lower()
    models = DATASOURCE_MODELS.get(key)
    if not models or len(models) == 1:
        return None
    variants = [v for m in models if (v := _get_variant_name(m)) is not None]
    return variants if variants else None


def get_fields(datasource: str, *, variant: str | None = None) -> list[FieldDef]:
    """Return ordered FieldDef list for a datasource.

    Args:
        datasource: DataSource name (e.g. "bigquery").
        variant: For multi-variant datasources, the variant name
            (e.g. "dataset" or "project" for bigquery).
            If None, defaults to the first variant.

    Returns:
        List of FieldDef in model declaration order, excluding complex
        dict-type fields that are not suitable for form/prompt display.

    Raises:
        ValueError: If datasource is not recognized.
    """
    key = datasource.lower()
    models = DATASOURCE_MODELS.get(key)
    if not models:
        available = ", ".join(sorted(DATASOURCE_MODELS))
        raise ValueError(f"Unknown datasource: {datasource!r}. Available: {available}")

    if len(models) == 1:
        model_cls = models[0]
    elif variant is None:
        model_cls = models[0]
    else:
        model_cls = next(
            (m for m in models if _get_variant_name(m) == variant),
            None,
        )
        if model_cls is None:
            available = ", ".join(
                _get_variant_name(m) for m in models if _get_variant_name(m)
            )
            raise ValueError(
                f"Unknown variant: {variant!r} for datasource {datasource!r}. "
                f"Available: {available}"
            )

    model_overrides = _MODEL_UI_OVERRIDES.get(model_cls.__name__, {})
    datasource_overrides = _DATASOURCE_UI_OVERRIDES.get(key, {})

    return [
        _auto_derive_field(name, fi, model_overrides, datasource_overrides)
        for name, fi in model_cls.model_fields.items()
        if not _is_dict_type(fi.annotation)
    ]


def get_datasource_options() -> list[str]:
    """Return sorted list of all available datasource names."""
    return sorted(DATASOURCE_MODELS.keys())
