"""Vercel _request must reject non-object JSON payloads."""
import sys
import types
from types import SimpleNamespace

import pytest

from wren.genbi.providers import vercel as vercel_mod
from wren.genbi.providers.base import DeployError


def _install_fake_requests(monkeypatch, response):
    """Inject a stub `requests` module for the duration of one test.

    `vercel._request` does a function-local `import requests`, so the only
    patch point that actually takes effect is `sys.modules["requests"]`.
    monkeypatch.setitem restores the real module afterwards. The stub
    records the call so tests can assert transport args (method, url,
    headers, json, timeout) instead of silently discarding them.
    """
    calls = []

    def _fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return response

    fake = types.ModuleType("requests")
    fake.request = _fake_request
    monkeypatch.setitem(sys.modules, "requests", fake)
    return calls


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


def test_request_returns_dict_unchanged(monkeypatch):
    """Success path: a dict body is returned verbatim (the branch the one
    production caller reads url/projectId/ownerId from), and the transport
    is called with the args the caller passed — pinning that a dropped
    timeout or json= payload would be caught."""
    resp = SimpleNamespace(
        status_code=200, text='{}', json=lambda: {"url": "x.vercel.app"}
    )
    calls = _install_fake_requests(monkeypatch, resp)
    out = vercel_mod._request(
        method="POST",
        url="https://example",
        headers={"h": "1"},
        payload={"p": "2"},
    )
    assert out == {"url": "x.vercel.app"}
    assert len(calls) == 1
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://example"
    assert calls[0]["headers"] == {"h": "1"}
    assert calls[0]["json"] == {"p": "2"}
    assert calls[0]["timeout"] == 120
