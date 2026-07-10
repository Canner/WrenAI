"""Connection providers resolve a Wren profile to (datasource, connection_info).

Layer order (highest priority first):
  1. ``explicit_profile=`` kwarg passed to ``WrenToolkit.from_project``
  2. ``profile:`` field in the project's ``wren_project.yml``
  3. The user's globally active profile (``wren profile switch ...``)

Secrets in profile values (``${ENV_VAR}``) are expanded via Core's
``expand_profile_secrets`` before the connection is exposed.
"""

from pathlib import Path
from typing import Any

from wren.context import load_project_config
from wren.profile import (  # noqa: F401  re-exported for monkeypatching in tests
    expand_profile_secrets,
    get_active_profile,
    list_profiles,
)

from wren_langchain.exceptions import WrenToolkitInitError


class ProfileConnectionProvider:
    """Resolves a profile via the 3-layer fallback and exposes connection info."""

    def __init__(
        self,
        *,
        project_path: Path,
        explicit_profile: str | None = None,
    ):
        self._project_path = project_path
        profile_dict = self._resolve_profile(explicit_profile)
        profile_dict = expand_profile_secrets(profile_dict)
        # ``datasource`` is part of the profile dict but logically separate.
        self._datasource = profile_dict.pop("datasource", None)
        self._connection_info = profile_dict

    def _resolve_profile(self, explicit: str | None) -> dict[str, Any]:
        # Layer 1: explicit kwarg. Use `is not None` so a misconfigured caller
        # passing `profile=""` raises a clear "profile not found" error instead
        # of silently falling through to the project-config / active layers.
        if explicit is not None:
            return self._lookup_named_profile(explicit)

        # Layer 2: profile name from wren_project.yml
        project_profile_name = self._project_config_profile()
        if project_profile_name:
            return self._lookup_named_profile(project_profile_name)

        # Layer 3: globally active profile
        _, active = get_active_profile()
        if not active:
            raise WrenToolkitInitError(
                "no active Wren profile found. "
                "Run `wren profile add` and `wren profile switch` first."
            )
        return dict(active)

    def _lookup_named_profile(self, name: str) -> dict[str, Any]:
        profiles = list_profiles()
        if name not in profiles:
            raise WrenToolkitInitError(
                f"profile {name!r} not found in ~/.wren/profiles.yml. "
                f"Available: {sorted(profiles)}"
            )
        return dict(profiles[name])

    def _project_config_profile(self) -> str | None:
        config = load_project_config(self._project_path)
        value = config.get("profile")
        return str(value) if value else None

    def datasource(self) -> str | None:
        return self._datasource

    def connection_info(self) -> dict[str, Any]:
        return dict(self._connection_info)
