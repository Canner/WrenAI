# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb", "pyyaml", "pytest"]
# ///
"""Tests for the pinned Driftwood fixture lock and local cache helper."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import pytest

HERE = Path(__file__).resolve().parent


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


fixture = load_module("driftwood_fixture", HERE / "fixture.py")
generate = load_module("driftwood_generate", HERE / "generate.py")


def test_committed_lock_matches_base_identity():
    lock = fixture.load_lock(HERE / "fixture.lock.json")
    assert lock["id"] == generate.BASE_FIXTURE_ID
    assert lock["generator"]["base_fixture_version"] == generate.BASE_FIXTURE_VERSION
    assert lock["generator"]["seed"] == generate.SEED
    assert lock["generator"]["reference_date"] == generate.TODAY.isoformat()
    assert lock["expectations"]["subscription_snapshots_max_date"] == generate.TODAY.isoformat()


def fake_lock(payload: bytes) -> dict:
    return {
        "format_version": 1,
        "id": "test-fixture-v1",
        "repository": "example/test",
        "release_tag": "fixtures-v1",
        "asset_name": "fixture.bin",
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size_bytes": len(payload),
        "generator": {},
        "expectations": {},
    }


def test_fetch_downloads_once_then_reuses_content_addressed_cache(tmp_path, monkeypatch):
    payload = b"deterministic fixture payload"
    lock = fake_lock(payload)
    calls = []

    def download(_lock, destination):
        calls.append(destination)
        destination.write_bytes(payload)

    monkeypatch.setattr(fixture, "_download_release_asset", download)
    first, first_hit = fixture.fetch(lock, tmp_path)
    second, second_hit = fixture.fetch(lock, tmp_path)

    assert first == second
    assert first.read_bytes() == payload
    assert first_hit is False
    assert second_hit is True
    assert len(calls) == 1


def test_corrupt_cache_is_replaced_and_never_accepted(tmp_path, monkeypatch):
    payload = b"correct"
    lock = fake_lock(payload)
    target = fixture.cached_path(lock, tmp_path)
    target.parent.mkdir(parents=True)
    target.write_bytes(b"corrupt")

    monkeypatch.setattr(
        fixture,
        "_download_release_asset",
        lambda _lock, destination: destination.write_bytes(payload),
    )
    path, hit = fixture.fetch(lock, tmp_path)

    assert hit is False
    assert path.read_bytes() == payload
    fixture.verify_file(path, lock)


def test_bad_lock_and_bad_file_fail_loudly(tmp_path):
    bad_lock = tmp_path / "bad.json"
    bad_lock.write_text(json.dumps({"format_version": 1}))
    with pytest.raises(fixture.FixtureError, match="missing fields"):
        fixture.load_lock(bad_lock)

    payload = b"expected"
    lock = fake_lock(payload)
    wrong = tmp_path / "wrong.bin"
    wrong.write_bytes(b"wrong")
    with pytest.raises(fixture.FixtureError, match="size mismatch"):
        fixture.verify_file(wrong, lock)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"] + sys.argv[1:]))
