"""Cloudflare Pages adapter — Direct Upload via the REST API.

Requires CLOUDFLARE_API_TOKEN (scope must include Pages:Edit) and
CLOUDFLARE_ACCOUNT_ID. The token travels ONLY in the Authorization
header — never argv.
"""

from __future__ import annotations

import base64
from pathlib import Path

from wren.genbi.providers.base import DeployError, Deployment

_API_BASE = "https://api.cloudflare.com/client/v4"


def _request(*, method: str, url: str, headers: dict, payload: dict) -> dict:
    """Thin transport wrapper — monkeypatched in tests."""
    import requests  # noqa: PLC0415

    resp = requests.request(method, url, headers=headers, json=payload, timeout=120)
    if resp.status_code == 403:
        raise DeployError(
            "Cloudflare API 403 — check that the API token's scope includes Pages:Edit."
        )
    if resp.status_code >= 400:
        raise DeployError(f"Cloudflare API error {resp.status_code}: {resp.text[:500]}")
    return resp.json()


def _collect_files(build_dir: Path) -> dict[str, str]:
    """Relative path → base64 content for every file in the app folder.

    Skips symlinks and anything resolving outside ``build_dir`` — the app
    folder ships to a public host, so a stray symlink must never exfiltrate
    files from elsewhere on disk.
    """
    build_root = build_dir.resolve()
    return {
        str(p.relative_to(build_dir)): base64.b64encode(p.read_bytes()).decode()
        for p in sorted(build_dir.rglob("*"))
        if p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(build_root)
    }


class CloudflareProvider:
    name = "cloudflare"
    env_token_var = "CLOUDFLARE_API_TOKEN"

    def deploy(
        self,
        build_dir: Path,
        *,
        app_name: str,
        token: str,
        prod: bool,
        link: dict | None,
    ) -> Deployment:
        import os  # noqa: PLC0415

        # account_id: previously persisted link state, else environment
        # (the token resolver already merged .env files into os.environ).
        account_id = (link or {}).get("account_id") or os.environ.get(
            "CLOUDFLARE_ACCOUNT_ID"
        )
        if not account_id:
            raise DeployError(
                "no CLOUDFLARE_ACCOUNT_ID found — export it or add it to your "
                "project's .env (Cloudflare Pages deploys are account-scoped)."
            )

        headers = {"Authorization": f"Bearer {token}"}
        project_url = f"{_API_BASE}/accounts/{account_id}/pages/projects"

        # Ensure the Pages project exists; tolerate "already exists" responses.
        try:
            _request(
                method="POST",
                url=project_url,
                headers=headers,
                payload={"name": app_name, "production_branch": "main"},
            )
        except DeployError as e:
            if "already exists" not in str(e).lower():
                raise

        data = _request(
            method="POST",
            url=f"{project_url}/{app_name}/deployments",
            headers=headers,
            payload={
                "branch": "main" if prod else "preview",
                "files": _collect_files(build_dir),
            },
        )

        result = data.get("result") or {}
        url = result.get("url")
        if not url:
            raise DeployError(
                "Cloudflare API response did not include a deployment URL; "
                "cannot confirm where the app was deployed."
            )
        return Deployment(
            url=url,
            environment="production" if prod else "preview",
            account_id=account_id,
        )
