"""Vercel _request must reject non-object JSON payments."""
from types import SimpleNamespace

import pytest

from wren.genbi.providers.base import DeployError
from wren.genbi.providers import vercel as vercel_mod


def test_request_rejects_list_json(monkeypatch):
    def fake_request(*args, **kwargs):
        return SimpleNamespace(
            status_code=200,
            text="[]",
            json=lambda: [],
        )
    monkeypatch.setattr(vercel_mod, "requests", SimpleNamespace(request=fake_request), raising=False)
    # patch inside function local import - need to patch requests module
    import sys, types
    fake = types.ModuleType("requests")
    fake.request = fake_request
    monkeypatch.setitem(sys.modules, "requests", fake)
    with pytest.raises(DeployError, match="non-object"):
        vercel_mod._request(method="POST", url="https://example", headers={}, payload={})


def test_request_rejects_invalid_json(monkeypatch):
    import sys, types
    def fake_request(*args, **kwargs):
        def j():
            raise ValueError("nope")
        return SimpleNamespace(status_code=200, text="not-json", json=j)
    fake = types.ModuleType("requests")
    fake.request = fake_request
    monkeypatch.setitem(sys.modules, "requests", fake)
    with pytest.raises(DeployError, match="non-JSON"):
        vercel_mod._request(method="POST", url="https://example", headers={}, payload={})
