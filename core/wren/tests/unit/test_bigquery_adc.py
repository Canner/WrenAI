"""BigQuery connector: Application Default Credentials fallback.

Stubs ``google.cloud.bigquery``, ``google.oauth2.service_account`` and
``google.auth`` before importing the connector under test, same pattern as
``test_athena_connector.py`` uses for ``pyathena``/``boto3``. The real
``google-*`` packages are only installed under the optional ``bigquery``
extra, which CI's unit-test job does not install.
"""

from __future__ import annotations

import base64
import sys
import types
from unittest.mock import MagicMock

import pytest

pytestmark = pytest.mark.unit

# ---------------------------------------------------------------------------
# stub google.cloud.bigquery / google.oauth2.service_account / google.auth
# ---------------------------------------------------------------------------

_client_calls: list[dict] = []
_service_account_calls: list[dict] = []
_default_calls: list[dict] = []

_service_account_credentials = MagicMock(name="service_account_credentials")
_service_account_credentials.with_scopes.return_value = (
    "scoped-service-account-credentials"
)
_adc_credentials = MagicMock(name="adc_credentials")


class _FakeQueryJobConfig:
    def __init__(self, dry_run=False, use_query_cache=True):
        self.dry_run = dry_run
        self.use_query_cache = use_query_cache
        self.job_timeout_ms = None


class _FakeClient:
    def __init__(self, **kwargs):
        _client_calls.append(kwargs)
        self.default_query_job_config = None

    def close(self):
        pass


def _fake_from_service_account_info(credits_json):
    _service_account_calls.append(credits_json)
    return _service_account_credentials


def _fake_default(scopes=None):
    _default_calls.append({"scopes": scopes})
    return _adc_credentials, "detected-project"


_google_mod = types.ModuleType("google")
_google_cloud_mod = types.ModuleType("google.cloud")
_google_cloud_bigquery_mod = types.ModuleType("google.cloud.bigquery")
_google_cloud_bigquery_mod.Client = _FakeClient
_google_cloud_bigquery_mod.QueryJobConfig = _FakeQueryJobConfig
_google_oauth2_mod = types.ModuleType("google.oauth2")
_google_oauth2_service_account_mod = types.ModuleType("google.oauth2.service_account")
_google_oauth2_service_account_mod.Credentials = types.SimpleNamespace(
    from_service_account_info=_fake_from_service_account_info
)
_google_auth_mod = types.ModuleType("google.auth")
_google_auth_mod.default = _fake_default

# `import google.auth` resolves `.auth` as an attribute of "google", so each
# submodule also needs wiring onto its parent, not just onto sys.modules.
_google_mod.cloud = _google_cloud_mod
_google_cloud_mod.bigquery = _google_cloud_bigquery_mod
_google_mod.oauth2 = _google_oauth2_mod
_google_oauth2_mod.service_account = _google_oauth2_service_account_mod
_google_mod.auth = _google_auth_mod

sys.modules.setdefault("google", _google_mod)
sys.modules.setdefault("google.cloud", _google_cloud_mod)
sys.modules.setdefault("google.cloud.bigquery", _google_cloud_bigquery_mod)
sys.modules.setdefault("google.oauth2", _google_oauth2_mod)
sys.modules.setdefault(
    "google.oauth2.service_account", _google_oauth2_service_account_mod
)
sys.modules.setdefault("google.auth", _google_auth_mod)

from wren.connector.bigquery import BigQueryConnector  # noqa: E402
from wren.model import BigQueryDatasetConnectionInfo  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_calls():
    _client_calls.clear()
    _service_account_calls.clear()
    _default_calls.clear()
    _service_account_credentials.reset_mock(return_value=True, side_effect=True)
    _service_account_credentials.with_scopes.return_value = (
        "scoped-service-account-credentials"
    )
    yield


def test_connection_info_allows_missing_credentials() -> None:
    """The model must not require a service-account credentials field.

    On unmodified main, ``credentials`` has no default and this raises a
    pydantic ValidationError: a user relying on ADC cannot even construct
    the connection info, before a connector is ever built.
    """
    info = BigQueryDatasetConnectionInfo(
        project_id="my-project", dataset_id="my_dataset"
    )
    assert info.credentials is None


def test_connector_uses_service_account_when_credentials_present() -> None:
    creds_json = base64.b64encode(b'{"type": "service_account"}').decode("ascii")
    info = BigQueryDatasetConnectionInfo(
        project_id="my-project", dataset_id="my_dataset", credentials=creds_json
    )
    BigQueryConnector(info)
    assert len(_service_account_calls) == 1
    assert _service_account_calls[0] == {"type": "service_account"}
    assert not _default_calls
    assert _client_calls[0]["credentials"] == "scoped-service-account-credentials"
    assert _client_calls[0]["project"] == "my-project"


def test_connector_falls_back_to_adc_when_credentials_absent() -> None:
    """Root cause: BigQueryConnector.__init__ never called google.auth.default(),
    so omitting credentials (now possible per the model fix above) previously
    left ``connection_info.credentials.get_secret_value()`` to crash on
    ``None``. It must instead use Application Default Credentials.
    """
    info = BigQueryDatasetConnectionInfo(
        project_id="my-project", dataset_id="my_dataset"
    )
    BigQueryConnector(info)
    assert not _service_account_calls
    assert len(_default_calls) == 1
    assert _default_calls[0]["scopes"] == [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/cloud-platform",
    ]
    assert _client_calls[0]["credentials"] is _adc_credentials
    assert _client_calls[0]["project"] == "my-project"
