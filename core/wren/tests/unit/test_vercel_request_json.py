"""Vercel _request must reject non-object JSON payloads."""
import sys
import types
from types import SimpleNamespace

import pytest

from wren.genbi.providers.base import DeployError
from wren.genbi.providers import vercel as vercel_mod


def _install_fake_requests(monkeypatch, response):
    """Inject a stub `requests` module for the duration of one test.

    `vercel._request` does a function-local `import requests`, so the only
    patch point that actually takes effect is `sys.modules["requests"]`.
    monkeypatch.setitem restores the real module afterwards.
    """
    fake = types.ModuleType("requests")
    fake.request = lambda *a, **k: response
    monkeypatch.setitem(sys.modules, "requests", fake)


def test_request_rejects_list_json(monkeypatch):
    resp = SimpleNamespace(status_code=200, text="[]", json=lambda: [])
    _install_fake_requests(monkeypatch, resp)
    with pytest.raises(DeployError, match="non-object"):
        vercel_mod._request(method="POST", url="https://example", headers={}, payload={})


def test_request_rejects_invalid_json(monkeypatch):
    def _raise():
        raise ValueError("nope")

    resp = SimpleNamespace(status_code=200, text="not-json", json=_raise)
    _install_fake_requests(monkeypatch, resp)
    with pytest.raises(DeployError, match="non-JSON"):
        vercel_mod._request(method="POST", url="https://example", headers={}, payload={})


def test_request_http_error_raised_before_json_branches(monkeypatch):
    """HTTP >= 400 must raise the existing 'Vercel API error' before the
    non-JSON / non-object guards are reached, pinning branch ordering."""
    resp = SimpleNamespace(status_code=500, text="boom", json=lambda: [])
    _install_fake_requests(monkeypatch, resp)
    with pytest.raises(DeployError, match="Vercel API error 500"):
        vercel_mod._request(method="POST", url="https://example", headers={}, payload={})
