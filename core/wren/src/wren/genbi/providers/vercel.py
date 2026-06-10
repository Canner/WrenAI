"""Vercel adapter — deploys a static app folder via the REST API.

Uses the v13 deployments endpoint with inline base64 files: a single call
creates (or reuses) the project and uploads the app. No vercel CLI needed.
The token travels ONLY in the Authorization header — never argv.
"""

from __future__ import annotations

import base64
from pathlib import Path

from wren.genbi.providers.base import DeployError, Deployment

_API_URL = "https://api.vercel.com/v13/deployments"


def _request(*, method: str, url: str, headers: dict, payload: dict) -> dict:
    """Thin transport wrapper — monkeypatched in tests."""
    import requests  # noqa: PLC0415

    resp = requests.request(method, url, headers=headers, json=payload, timeout=120)
    if resp.status_code >= 400:
        raise DeployError(f"Vercel API error {resp.status_code}: {resp.text[:500]}")
    return resp.json()


def _collect_files(build_dir: Path) -> list[dict]:
    # Skip symlinks and anything resolving outside build_dir — the app folder
    # ships to a public host, so a stray symlink must never exfiltrate files
    # from elsewhere on disk.
    build_root = build_dir.resolve()
    files = []
    for path in sorted(build_dir.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        if not path.resolve().is_relative_to(build_root):
            continue
        # Never ship a .env* file to a public host, even if verify's scan
        # found no recognizable secret pattern in it.
        if path.name.startswith(".env"):
            continue
        files.append(
            {
                "file": str(path.relative_to(build_dir)),
                "data": base64.b64encode(path.read_bytes()).decode(),
                "encoding": "base64",
            }
        )
    return files


class VercelProvider:
    name = "vercel"
    env_token_var = "VERCEL_TOKEN"

    def deploy(
        self,
        build_dir: Path,
        *,
        app_name: str,
        token: str,
        prod: bool,
        link: dict | None,
    ) -> Deployment:
        payload: dict = {
            "name": app_name,
            "files": _collect_files(build_dir),
            "projectSettings": {"framework": None},
        }
        if prod:
            payload["target"] = "production"

        headers = {"Authorization": f"Bearer {token}"}
        url = _API_URL
        if link and link.get("org_id"):
            url = f"{_API_URL}?teamId={link['org_id']}"

        data = _request(method="POST", url=url, headers=headers, payload=payload)

        raw_url = data.get("url")
        if not raw_url:
            raise DeployError(
                "Vercel API response did not include a deployment URL; "
                "cannot confirm where the app was deployed."
            )
        return Deployment(
            url=raw_url if raw_url.startswith("http") else f"https://{raw_url}",
            environment="production" if prod else "preview",
            project_id=data.get("projectId"),
            org_id=data.get("ownerId") or (link or {}).get("org_id"),
        )
