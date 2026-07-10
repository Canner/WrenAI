"""The DeployProvider protocol — vercel/cloudflare today, wren SaaS later."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass
class Deployment:
    """Result of a provider upload — non-secret link state only."""

    url: str
    environment: str  # "preview" | "production"
    project_id: str | None = None
    org_id: str | None = None
    account_id: str | None = None


class DeployError(RuntimeError):
    """Raised by adapters with a user-actionable message."""


class DeployProvider(Protocol):
    name: str
    env_token_var: str

    def deploy(
        self,
        build_dir: Path,
        *,
        app_name: str,
        token: str,
        prod: bool,
        link: dict | None,
    ) -> Deployment:
        """Upload ``build_dir`` and return the deployment. ``link`` is the
        previously persisted provider state (project/account ids), if any."""
        ...
