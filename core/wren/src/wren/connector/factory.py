import importlib

from wren.model.data_source import DataSource
from wren.model.error import ErrorCode, WrenError

_REGISTRY: dict[DataSource, str] = {
    DataSource.postgres: "wren.connector.postgres",
    DataSource.mysql: "wren.connector.mysql",
    DataSource.doris: "wren.connector.mysql",
    DataSource.mssql: "wren.connector.mssql",
    DataSource.canner: "wren.connector.canner",
    DataSource.bigquery: "wren.connector.bigquery",
    DataSource.datafusion: "wren.connector.datafusion",
    DataSource.local_file: "wren.connector.duckdb",
    DataSource.s3_file: "wren.connector.duckdb",
    DataSource.minio_file: "wren.connector.duckdb",
    DataSource.gcs_file: "wren.connector.duckdb",
    DataSource.duckdb: "wren.connector.duckdb",
    DataSource.redshift: "wren.connector.redshift",
    DataSource.spark: "wren.connector.spark",
    DataSource.databricks: "wren.connector.databricks",
    DataSource.trino: "wren.connector.trino",
    DataSource.clickhouse: "wren.connector.clickhouse",
    DataSource.oracle: "wren.connector.oracle",
    DataSource.snowflake: "wren.connector.snowflake",
    DataSource.athena: "wren.connector.athena",
}

# Map data sources to the correct pip extra when they share a connector module
_INSTALL_EXTRA: dict[DataSource, str] = {
    DataSource.doris: "mysql",
    DataSource.canner: "postgres",
    DataSource.local_file: "duckdb",
    DataSource.s3_file: "duckdb",
    DataSource.minio_file: "duckdb",
    DataSource.gcs_file: "duckdb",
}

_NEEDS_DATA_SOURCE = {
    DataSource.mysql,
    DataSource.doris,
    DataSource.trino,
}


def get_connector(data_source: DataSource, connection_info):
    module_path = _REGISTRY.get(data_source)
    if module_path is None:
        raise WrenError(
            ErrorCode.NOT_IMPLEMENTED,
            f"Unsupported data source: {data_source}",
        )

    try:
        module = importlib.import_module(module_path)
    except ImportError as e:
        extra = _INSTALL_EXTRA.get(data_source, data_source.value)
        raise WrenError(
            ErrorCode.NOT_IMPLEMENTED,
            f"Connector '{data_source.value}' requires additional dependencies: {e}. "
            f"Install with: pip install wren[{extra}]",
        ) from e

    if data_source in _NEEDS_DATA_SOURCE:
        return module.create_connector(data_source, connection_info)
    return module.create_connector(connection_info)
