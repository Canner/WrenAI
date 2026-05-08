"""Profile management — load, save, list, switch, add, remove profiles.

Profiles may contain ``${VAR}`` references; those are resolved at
connection time (never at save time) by :func:`expand_profile_secrets`.
The stored YAML keeps the placeholders so ``wren profile debug`` never
prints an actual secret.
"""

from __future__ import annotations

import os
import re
import string
import tempfile
from pathlib import Path
from typing import Any

import yaml

_WREN_HOME = Path(os.environ.get("WREN_HOME", Path.home() / ".wren"))
_PROFILES_FILE = _WREN_HOME / "profiles.yml"

# ``${VAR}`` references in profile values are resolved from the environment.
# We restrict variable names to UPPER_SNAKE_CASE so a literal "${foo}" in a
# real password (or any other lowercase curly-brace sequence) is left alone.
# ``string.Template`` already supports ``$$`` → ``$`` as an escape.


class _SecretTemplate(string.Template):
    # Disable IGNORECASE (Template's default) so ``${foo}`` does NOT match —
    # that lets us leave lowercase curly-brace sequences alone (they may
    # appear in URLs, query strings, or real passwords).
    flags = re.VERBOSE
    idpattern = r"[_A-Z][_A-Z0-9]*"


class MissingSecretError(ValueError):
    """Raised when a profile references an env var that isn't set."""


_env_loaded = False


def _ensure_env_loaded() -> None:
    """Merge ``.env`` files into ``os.environ`` exactly once per process.

    Order (first match wins per key; existing env vars are never overwritten):

    1. ``$CWD/.env`` — the typical agent flow drops the file here
    2. Walk up from ``$CWD`` to find the project root (``wren_project.yml``),
       load its ``.env`` if different from CWD
    3. ``~/.wren/.env`` — user-global fallback for operators with many
       projects sharing the same secret bundle

    ``python-dotenv`` handles CRLF / LF portably so the same file works on
    Windows, macOS, and Linux.  We call ``load_dotenv`` with ``override=False``
    so values a user exported in their shell still win.
    """
    global _env_loaded
    if _env_loaded:
        return
    _env_loaded = True

    try:
        from dotenv import load_dotenv  # noqa: PLC0415
    except ImportError:
        # python-dotenv ships with core wren-engine; this branch is defensive
        # for broken installs.  Profiles without ${VAR} still work fine.
        return

    candidates: list[Path] = []
    cwd = Path.cwd().resolve()
    if (cwd / ".env").exists():
        candidates.append(cwd / ".env")

    # Find project root by looking for wren_project.yml; if different from
    # cwd, consider its .env as well.
    for parent in [cwd, *cwd.parents]:
        if (parent / "wren_project.yml").exists():
            project_env = parent / ".env"
            if project_env.exists() and project_env not in candidates:
                candidates.append(project_env)
            break

    user_env = _WREN_HOME / ".env"
    if user_env.exists():
        candidates.append(user_env)

    for dotenv_path in candidates:
        load_dotenv(dotenv_path, override=False)


def _reset_env_loaded_for_tests() -> None:
    """Clear the cached ``_env_loaded`` flag so tests can exercise discovery."""
    global _env_loaded
    _env_loaded = False


def _expand_string(value: str, env: dict[str, str]) -> str:
    """Resolve ``${VAR}`` references in a single string.

    Raises :class:`MissingSecretError` with a useful message when any
    referenced variable is not set.
    """
    try:
        return _SecretTemplate(value).substitute(env)
    except KeyError as exc:
        name = exc.args[0]
        raise MissingSecretError(
            f"Profile references ${{{name}}} but it is not set in the "
            "environment or any discovered .env file."
        ) from exc
    except ValueError as exc:
        # Template raised on a malformed $-sequence; surface the same
        # KeyError-style message so callers get one exception type.
        raise MissingSecretError(
            f"Malformed reference in profile value {value!r}: {exc}"
        ) from exc


def expand_profile_secrets(profile: Any) -> Any:
    """Recursively resolve ``${VAR}`` references in a profile dict.

    Only string values are substituted; integers, booleans, lists, and
    nested dicts are preserved (lists and dicts are walked recursively so
    ``kwargs: {password: ${PG_PW}}`` works).  Use at connection time;
    never when writing profiles back to disk or printing debug output.
    """
    _ensure_env_loaded()
    return _expand_obj(profile, os.environ)


def _expand_obj(obj: Any, env: dict[str, str]) -> Any:
    if isinstance(obj, str):
        return _expand_string(obj, env)
    if isinstance(obj, dict):
        return {k: _expand_obj(v, env) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_expand_obj(v, env) for v in obj]
    return obj


def _load_raw() -> dict:
    """Load profiles.yml, returning empty structure if missing.

    Raises ValueError on malformed content so callers get a deterministic error
    instead of an AttributeError deep inside library code.
    """
    if not _PROFILES_FILE.exists():
        return {"active": None, "profiles": {}}
    try:
        data = yaml.safe_load(_PROFILES_FILE.read_text())
    except yaml.YAMLError as exc:
        raise ValueError(
            f"profiles.yml is not valid YAML: {exc}\n"
            f"Fix or remove {_PROFILES_FILE} and try again."
        ) from exc
    if data is None:
        return {"active": None, "profiles": {}}
    if not isinstance(data, dict):
        raise ValueError(
            f"profiles.yml must contain a YAML mapping; got {type(data).__name__}.\n"
            f"Fix or remove {_PROFILES_FILE} and try again."
        )
    profiles = data.get("profiles", {})
    if not isinstance(profiles, dict):
        raise ValueError(
            f"profiles.yml: 'profiles' must be a mapping; got {type(profiles).__name__}.\n"
            f"Fix or remove {_PROFILES_FILE} and try again."
        )
    active = data.get("active")
    if active is not None and not isinstance(active, str):
        raise ValueError(
            f"profiles.yml: 'active' must be a string or null; got {type(active).__name__}.\n"
            f"Fix or remove {_PROFILES_FILE} and try again."
        )
    return data


def _save_raw(data: dict) -> None:
    """Write profiles.yml atomically with 0600 permissions."""
    _WREN_HOME.mkdir(parents=True, exist_ok=True)
    payload = yaml.dump(data, default_flow_style=False, sort_keys=False)
    # Write to a temp file in the same directory then atomically replace
    fd, tmp_path = tempfile.mkstemp(dir=_WREN_HOME, suffix=".yml.tmp")
    try:
        os.chmod(tmp_path, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(tmp_path, _PROFILES_FILE)
    except Exception:
        os.unlink(tmp_path)
        raise
    os.chmod(_PROFILES_FILE, 0o600)


def list_profiles() -> dict[str, dict]:
    """Return {name: profile_dict} for all profiles."""
    return _load_raw().get("profiles", {})


def get_active_name() -> str | None:
    """Return the name of the currently active profile, or None."""
    return _load_raw().get("active")


def get_active_profile() -> tuple[str | None, dict]:
    """Return (name, profile_dict) for the active profile. ({} if none set)."""
    data = _load_raw()
    name = data.get("active")
    if name is None:
        return None, {}
    profiles = data.get("profiles", {})
    return name, dict(profiles.get(name, {}))


def resolve_profile_for_project(project_path: Path) -> tuple[str | None, dict]:
    """Resolve the connection profile for a given project.

    Resolution order:
      1. ``profile:`` field in ``<project>/wren_project.yml`` (if non-empty)
      2. Global active profile in ``~/.wren/profiles.yml``

    Returns ``(name, profile_dict)``. Returns ``(None, {})`` if neither a
    project pin nor a global active profile is set.

    Raises ``SystemExit`` when the project pins a profile name that does not
    exist in profiles.yml — fail loudly because the user explicitly bound
    a profile that's no longer there.
    """
    project_yml = project_path / "wren_project.yml"
    pinned_name: str | None = None
    if project_yml.exists():
        try:
            config = yaml.safe_load(project_yml.read_text()) or {}
        except yaml.YAMLError as exc:
            # Fail loudly: a malformed project file shouldn't silently fall
            # back to the global active profile — that risks running against
            # the wrong database.
            raise SystemExit(
                f"Error: invalid YAML in {project_yml}: {exc}\n"
                "  Fix the file or run `wren context init --force` to "
                "rescaffold."
            ) from exc
        if isinstance(config, dict):
            value = config.get("profile")
            if isinstance(value, str) and value.strip():
                pinned_name = value.strip()

    if pinned_name is None:
        return get_active_profile()

    data = _load_raw()
    profiles = data.get("profiles", {})
    if pinned_name not in profiles:
        available = ", ".join(sorted(profiles)) or "(none)"
        raise SystemExit(
            f"Error: project pins profile '{pinned_name}' but it doesn't exist "
            f"in {_PROFILES_FILE}.\n"
            f"Available profiles: {available}.\n"
            "Run `wren context set-profile <name>` to rebind, or "
            f"`wren profile add {pinned_name}` to recreate the missing profile."
        )
    return pinned_name, dict(profiles[pinned_name])


def add_profile(name: str, profile: dict, *, activate: bool = False) -> None:
    """Add or overwrite a named profile."""
    data = _load_raw()
    data.setdefault("profiles", {})[name] = profile
    if activate or data.get("active") is None:
        data["active"] = name
    _save_raw(data)


def remove_profile(name: str) -> bool:
    """Remove a profile. Returns True if found. Clears active if it was this profile."""
    data = _load_raw()
    profiles = data.get("profiles", {})
    if name not in profiles:
        return False
    del profiles[name]
    if data.get("active") == name:
        data["active"] = next(iter(profiles), None)
    _save_raw(data)
    return True


def switch_profile(name: str) -> bool:
    """Set the active profile. Returns False if name not found."""
    data = _load_raw()
    if name not in data.get("profiles", {}):
        return False
    data["active"] = name
    _save_raw(data)
    return True


def resolve_connection(
    explicit_datasource: str | None,
    explicit_conn_info: str | None,
    explicit_conn_file: str | None,
) -> tuple[str | None, dict]:
    """Resolve datasource + connection_info from explicit flags or active profile.

    Priority: explicit flags > active profile.
    Legacy ~/.wren/connection_info.json fallback is handled separately by
    cli._load_conn() and is not performed here.
    Returns (datasource_str_or_None, connection_dict).
    """
    if explicit_datasource or explicit_conn_info or explicit_conn_file:
        return explicit_datasource, {}

    name, profile = get_active_profile()
    if profile:
        ds = profile.pop("datasource", None)
        return ds, profile

    return None, {}


def debug_profile(name: str | None = None) -> dict[str, Any]:
    """Return diagnostic info for a profile (or the active one).

    Masks sensitive fields (password, credentials, secret, token).
    """
    if name is None:
        name = get_active_name()
    if name is None:
        return {"error": "no active profile"}
    data = _load_raw()
    profile = data.get("profiles", {}).get(name)
    if profile is None:
        return {"error": f"profile '{name}' not found"}

    _SENSITIVE = {
        "password",
        "credentials",
        "secret",
        "token",
        "private_key",
        "access_key",
        "key_id",
        "client_id",
        "bucket",
        "endpoint",
        "staging_dir",
        "hostname",
        "http_path",
        "role_arn",
    }
    masked = {}
    for k, v in profile.items():
        if k.lower() in _SENSITIVE or any(s in k.lower() for s in _SENSITIVE):
            masked[k] = "***"
        else:
            masked[k] = v
    return {"name": name, "active": data.get("active") == name, "config": masked}
