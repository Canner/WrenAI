from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pytest
from pydantic import SecretStr

from wren.connector.databricks import DatabricksConnector
from wren.model import (
    DatabricksServicePrincipalConnectionInfo,
    DatabricksTokenConnectionInfo,
)

pytestmark = pytest.mark.unit


@pytest.fixture
def databricks_connect_calls(monkeypatch):
    calls = []

    def connect(**kwargs):
        calls.append(kwargs)
        return MagicMock()

    databricks_module = types.ModuleType("databricks")
    sql_module = types.ModuleType("databricks.sql")
    sql_module.connect = connect
    databricks_module.sql = sql_module

    sdk_module = types.ModuleType("databricks.sdk")
    core_module = types.ModuleType("databricks.sdk.core")

    class Config:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    def oauth_service_principal(config):
        return ("oauth", config.kwargs)

    core_module.Config = Config
    core_module.oauth_service_principal = oauth_service_principal
    sdk_module.core = core_module

    monkeypatch.setitem(sys.modules, "databricks", databricks_module)
    monkeypatch.setitem(sys.modules, "databricks.sql", sql_module)
    monkeypatch.setitem(sys.modules, "databricks.sdk", sdk_module)
    monkeypatch.setitem(sys.modules, "databricks.sdk.core", core_module)

    return calls


def test_token_connection_passes_catalog(databricks_connect_calls):
    info = DatabricksTokenConnectionInfo(
        server_hostname="dbc.example.cloud.databricks.com",
        http_path="/sql/1.0/warehouses/abc",
        catalog="main",
        access_token=SecretStr("dapi-token"),
    )

    DatabricksConnector(info)

    assert databricks_connect_calls[-1] == {
        "server_hostname": "dbc.example.cloud.databricks.com",
        "http_path": "/sql/1.0/warehouses/abc",
        "catalog": "main",
        "access_token": "dapi-token",
    }


def test_token_connection_omits_empty_catalog(databricks_connect_calls):
    info = DatabricksTokenConnectionInfo(
        server_hostname="dbc.example.cloud.databricks.com",
        http_path="/sql/1.0/warehouses/abc",
        catalog="",
        access_token=SecretStr("dapi-token"),
    )

    DatabricksConnector(info)

    assert "catalog" not in databricks_connect_calls[-1]


def test_service_principal_connection_passes_catalog(databricks_connect_calls):
    info = DatabricksServicePrincipalConnectionInfo(
        server_hostname="dbc.example.cloud.databricks.com",
        http_path="/sql/1.0/warehouses/abc",
        catalog="analytics",
        client_id=SecretStr("client-id"),
        client_secret=SecretStr("client-secret"),
        azure_tenant_id="tenant-id",
    )

    DatabricksConnector(info)

    call = databricks_connect_calls[-1]
    assert call["server_hostname"] == "dbc.example.cloud.databricks.com"
    assert call["http_path"] == "/sql/1.0/warehouses/abc"
    assert call["catalog"] == "analytics"

    credentials = call["credentials_provider"]()
    assert credentials == (
        "oauth",
        {
            "host": "dbc.example.cloud.databricks.com",
            "client_id": "client-id",
            "client_secret": "client-secret",
            "azure_tenant_id": "tenant-id",
        },
    )
