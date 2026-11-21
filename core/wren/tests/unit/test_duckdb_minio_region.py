"""Regression test: the MinIO secret is signed for the configured region."""

from unittest.mock import MagicMock

from wren.connector.duckdb import _init_duckdb_minio
from wren.model.data_source import DataSource


def _minio_info(**overrides):
    data = {
        "endpoint": "127.0.0.1:9000",
        "bucket": "my-bucket",
        "access_key": "my-account",
        "secret_key": "my-password",
        **overrides,
    }
    return DataSource.minio_file.get_connection_info(data)


def _secret_sql(info):
    connection = MagicMock()
    _init_duckdb_minio(connection, info)
    return connection.execute.call_args_list[0].args[0]


def test_minio_secret_uses_configured_region():
    # SigV4 signatures embed the region, so an S3-compatible endpoint set to
    # any other region rejects every request signed for a hardcoded one.
    sql = _secret_sql(_minio_info(region="us-east-1"))

    assert "REGION 'us-east-1'" in sql
    assert "ap-northeast-1" not in sql


def test_minio_secret_region_defaults_to_previous_value():
    # Profiles saved without a region keep signing exactly as before.
    assert "REGION 'ap-northeast-1'" in _secret_sql(_minio_info())


def test_minio_secret_region_is_escaped():
    sql = _secret_sql(_minio_info(region="us-east-1'x"))

    assert "REGION 'us-east-1''x'" in sql
