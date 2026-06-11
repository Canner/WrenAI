"""Deploy providers — interchangeable adapters behind the DeployProvider protocol."""

from __future__ import annotations

from wren.genbi.providers.base import DeployProvider


def get_provider(name: str) -> DeployProvider:
    """Return the adapter for ``name`` or raise KeyError with the known set."""
    from wren.genbi.providers.cloudflare import CloudflareProvider  # noqa: PLC0415
    from wren.genbi.providers.vercel import VercelProvider  # noqa: PLC0415

    registry: dict[str, type] = {
        "vercel": VercelProvider,
        "cloudflare": CloudflareProvider,
    }
    if name not in registry:
        raise KeyError(
            f"unknown provider {name!r}; expected one of: {', '.join(registry)}"
        )
    return registry[name]()
