"""BigQuery trailing-semicolon + LIMIT pushdown helpers (mocked client)."""

from unittest.mock import MagicMock

import pyarrow as pa

from wren.connector.bigquery import (
    BigQueryConnector,
    _apply_limit,
    _strip_trailing_semicolon,
)


def _make_mock_connector() -> tuple[BigQueryConnector, MagicMock]:
    connector = BigQueryConnector.__new__(BigQueryConnector)
    client = MagicMock()
    job = MagicMock()
    result = MagicMock()
    result.to_arrow.return_value = pa.table({"x": [1]})
    job.result.return_value = result
    client.query.return_value = job
    connector.connection = client
    return connector, client


def test_query_pushes_limit_and_strips_semicolon() -> None:
    connector, client = _make_mock_connector()
    connector.query("SELECT 1;", limit=5)
    (sent,), _ = client.query.call_args
    assert sent == "SELECT 1\nLIMIT 5"
    assert ";)" not in sent and not sent.rstrip().endswith(";")


def test_query_without_limit_still_strips_only_when_composing_none() -> None:
    connector, client = _make_mock_connector()
    connector.query("SELECT 1")
    (sent,), _ = client.query.call_args
    assert sent == "SELECT 1"


def test_dry_run_strips_trailing_semicolon() -> None:
    connector, client = _make_mock_connector()
    import sys
    import types
    from unittest.mock import patch
    fake_mod = types.ModuleType("google.cloud.bigquery")
    class QueryJobConfig:
        def __init__(self, dry_run=False, use_query_cache=True):
            self.dry_run = dry_run
            self.use_query_cache = use_query_cache
    fake_mod.QueryJobConfig = QueryJobConfig
    with patch.dict(sys.modules, {
        "google": types.ModuleType("google"),
        "google.cloud": types.ModuleType("google.cloud"),
        "google.cloud.bigquery": fake_mod,
        "google.oauth2": types.ModuleType("google.oauth2"),
        "google.oauth2.service_account": types.ModuleType("google.oauth2.service_account"),
    }):
        connector.dry_run("SELECT 1;  \n")
    (sent,), kwargs = client.query.call_args
    assert sent == "SELECT 1"
    assert kwargs["job_config"].dry_run is True
    assert kwargs["job_config"].use_query_cache is False


def test_helper_preserves_literal_semicolon() -> None:
    assert _strip_trailing_semicolon("SELECT ';' AS x") == "SELECT ';' AS x"
    assert _apply_limit("SELECT 1;", 3) == "SELECT 1\nLIMIT 3"
