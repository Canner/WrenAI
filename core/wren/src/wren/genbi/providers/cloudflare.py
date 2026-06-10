"""Cloudflare Pages adapter — deploys via the official ``wrangler`` CLI.

Cloudflare Pages has no single inline-upload REST endpoint (unlike Vercel);
Direct Upload is a multi-step protocol (manifest → upload token → multipart
asset upload → completion token → create deployment) that is only partially
documented and drifts over time. Cloudflare's own guidance is to use
``wrangler pages deploy``, so this adapter shells out to it.

Requires the ``wrangler`` CLI (or ``npx wrangler``), CLOUDFLARE_API_TOKEN
(scope must include Pages:Edit) and CLOUDFLARE_ACCOUNT_ID. The token travels
ONLY via the subprocess environment — never argv.
"""

from __future__ import annotations

import re
from pathlib import Path

from wren.genbi.providers.base import DeployError, Deployment

# Matches the per-deployment / project URL wrangler prints on success.
_PAGES_URL_RE = re.compile(r"https://[A-Za-z0-9.-]+\.pages\.dev\S*")


def _wrangler_cmd() -> list[str] | None:
    """Return the base argv for invoking wrangler, or None if unavailable."""
    import shutil  # noqa: PLC0415

    if shutil.which("wrangler"):
        return ["wrangler"]
    if shutil.which("npx"):
        return ["npx", "wrangler"]
    return None


def _run(cmd: list[str], *, env: dict, cwd: str | None = None):
    """Run a subprocess and return the CompletedProcess. Patched in tests."""
    import subprocess  # noqa: PLC0415

    return subprocess.run(
        cmd, env=env, cwd=cwd, capture_output=True, text=True, timeout=600
    )


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

        base = _wrangler_cmd()
        if base is None:
            raise DeployError(
                "Cloudflare Pages deploys require the `wrangler` CLI, which "
                "isn't on PATH. Install it (`npm install -g wrangler`) or make "
                "`npx` available, then retry."
            )

        # Token + account id travel via the environment, never argv.
        env = {
            **os.environ,
            "CLOUDFLARE_API_TOKEN": token,
            "CLOUDFLARE_ACCOUNT_ID": account_id,
        }

        # Ensure the Pages project exists; tolerate "already exists".
        created = _run(
            base
            + ["pages", "project", "create", app_name, "--production-branch", "main"],
            env=env,
        )
        if created.returncode != 0:
            combined = f"{created.stdout}\n{created.stderr}".lower()
            if "already exists" not in combined:
                raise DeployError(
                    "could not create Cloudflare Pages project: "
                    f"{(created.stderr or created.stdout).strip()[:500]}"
                )

        # Deploy the prebuilt folder. Run with cwd=build_dir (deploying ".") so
        # wrangler can't pick up an unrelated wrangler.toml from the project
        # root. Production = the project's production branch ("main"); any other
        # branch is a preview deployment.
        branch = "main" if prod else "preview"
        result = _run(
            base
            + [
                "pages",
                "deploy",
                ".",
                "--project-name",
                app_name,
                "--branch",
                branch,
            ],
            env=env,
            cwd=str(build_dir),
        )
        if result.returncode != 0:
            raise DeployError(
                "wrangler pages deploy failed: "
                f"{(result.stderr or result.stdout).strip()[:500]}"
            )

        match = _PAGES_URL_RE.search(f"{result.stdout}\n{result.stderr}")
        if not match:
            raise DeployError(
                "could not determine the deployment URL from wrangler output; "
                "cannot confirm where the app was deployed."
            )
        return Deployment(
            url=match.group(0),
            environment="production" if prod else "preview",
            account_id=account_id,
        )
