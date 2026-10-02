#!/usr/bin/env python3
"""Fetch and verify the pinned synthetic Driftwood base fixture.

The release asset is immutable input for ordinary eval preparation. Updating
it is an explicit refresh operation: publish a new asset/tag, then update the
committed lock. A missing asset or checksum mismatch always fails; this helper
never falls back to the expensive generator.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import BinaryIO
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
DEFAULT_LOCK = HERE / "fixture.lock.json"
CHUNK_SIZE = 1024 * 1024
HTTP_TIMEOUT_SECONDS = 120


class FixtureError(RuntimeError):
    pass


def load_lock(path: Path) -> dict:
    try:
        lock = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise FixtureError(f"cannot read fixture lock {path}: {exc}") from exc

    required = {
        "format_version",
        "id",
        "repository",
        "release_tag",
        "asset_name",
        "sha256",
        "size_bytes",
        "generator",
        "expectations",
    }
    missing = required - set(lock)
    if missing:
        raise FixtureError(f"fixture lock is missing fields: {sorted(missing)}")
    if lock["format_version"] != 1:
        raise FixtureError(f"unsupported fixture lock version: {lock['format_version']}")
    if len(lock["sha256"]) != 64:
        raise FixtureError("fixture lock sha256 must contain 64 hexadecimal characters")
    try:
        int(lock["sha256"], 16)
    except ValueError as exc:
        raise FixtureError("fixture lock sha256 is not hexadecimal") from exc
    return lock


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(path: Path, lock: dict) -> None:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise FixtureError(f"fixture is unavailable at {path}: {exc}") from exc
    if size != lock["size_bytes"]:
        raise FixtureError(
            f"fixture size mismatch for {path}: expected {lock['size_bytes']}, found {size}"
        )
    actual = sha256_file(path)
    if actual != lock["sha256"]:
        raise FixtureError(
            f"fixture checksum mismatch for {path}: expected {lock['sha256']}, found {actual}"
        )


def default_cache_root() -> Path:
    explicit = os.environ.get("WARBLE_EVAL_FIXTURE_CACHE")
    if explicit:
        return Path(explicit).expanduser()
    xdg = os.environ.get("XDG_CACHE_HOME")
    base = Path(xdg).expanduser() if xdg else Path.home() / ".cache"
    return base / "warble" / "eval-fixtures"


def _auth_token() -> str | None:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        return token
    if shutil.which("gh") is None:
        return None
    result = subprocess.run(
        ["gh", "auth", "token"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    token = result.stdout.strip()
    return token or None


def _request(url: str, token: str | None, accept: str) -> urllib.request.Request:
    headers = {
        "Accept": accept,
        "User-Agent": "warble-eval-fixture/1",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return urllib.request.Request(url, headers=headers)


def _copy_response(response: BinaryIO, destination: Path) -> None:
    with destination.open("wb") as output:
        while True:
            chunk = response.read(CHUNK_SIZE)
            if not chunk:
                break
            output.write(chunk)


def _download_release_asset(lock: dict, destination: Path) -> None:
    token = _auth_token()
    release_url = (
        f"https://api.github.com/repos/{lock['repository']}/releases/tags/"
        f"{lock['release_tag']}"
    )
    try:
        with urllib.request.urlopen(
            _request(release_url, token, "application/vnd.github+json"),
            timeout=HTTP_TIMEOUT_SECONDS,
        ) as response:
            release = json.load(response)
        asset = next(
            (item for item in release.get("assets", []) if item.get("name") == lock["asset_name"]),
            None,
        )
        if asset is None:
            raise FixtureError(
                f"release {lock['repository']}@{lock['release_tag']} has no asset "
                f"named {lock['asset_name']}"
            )
        with urllib.request.urlopen(
            _request(asset["url"], token, "application/octet-stream"),
            timeout=HTTP_TIMEOUT_SECONDS,
        ) as response:
            _copy_response(response, destination)
    except urllib.error.HTTPError as exc:
        raise FixtureError(
            f"fixture download failed with HTTP {exc.code}; verify release/tag access"
        ) from exc
    except urllib.error.URLError as exc:
        raise FixtureError(f"fixture download failed: {exc.reason}") from exc


def cached_path(lock: dict, cache_root: Path) -> Path:
    cache_key = f"{lock['id']}-{lock['sha256']}"
    return cache_root / cache_key / lock["asset_name"]


def fetch(lock: dict, cache_root: Path) -> tuple[Path, bool]:
    target = cached_path(lock, cache_root)
    if target.is_file():
        try:
            verify_file(target, lock)
            return target, True
        except FixtureError:
            # A fresh verified download atomically replaces the corrupt entry.
            pass

    target.parent.mkdir(parents=True, exist_ok=True)
    # Keep the temporary download on the cache filesystem so os.replace is
    # atomic even when the system temp directory is a different mount.
    with tempfile.TemporaryDirectory(prefix=".download-", dir=target.parent) as temp_dir:
        downloaded = Path(temp_dir) / lock["asset_name"]
        _download_release_asset(lock, downloaded)
        verify_file(downloaded, lock)
        os.replace(downloaded, target)
    return target, False


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch_parser = subparsers.add_parser("fetch", help="download once, verify, and reuse the cache")
    fetch_parser.add_argument("--cache-dir", type=Path, default=None)
    fetch_parser.add_argument("--output", type=Path, default=None)

    verify_parser = subparsers.add_parser("verify", help="verify a local file against the lock")
    verify_parser.add_argument("path", type=Path)

    subparsers.add_parser("describe", help="print the committed fixture identity")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        lock = load_lock(args.lock)
        if args.command == "verify":
            verify_file(args.path, lock)
            print(args.path)
            return 0
        if args.command == "describe":
            print(json.dumps(lock, indent=2, sort_keys=True))
            return 0

        cache_root = args.cache_dir or default_cache_root()
        path, hit = fetch(lock, cache_root)
        print(f"fixture cache {'hit' if hit else 'miss'}: {path}", file=sys.stderr)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, args.output)
            print(args.output)
        else:
            print(path)
        return 0
    except FixtureError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
